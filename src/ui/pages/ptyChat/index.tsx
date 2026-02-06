import {useState, useRef, useEffect, useCallback} from "react";
import {useParams, useOutletContext} from "react-router-dom";
import {Terminal} from "@xterm/xterm";
import {FitAddon} from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import PageHeader from "../../components/commons/pageHeader";
import QuestionCard from "../../components/chat/questionCard";
import {useSessionQuery} from "../../hooks/apis/queries/session";
import {useSubmitQuestionAnswer} from "../../hooks/apis/queries/message";
import {useTranslation} from "../../contexts/language";
import type {QuestionData, QuestionAnswer} from "../../types";

/**
 * PTY Chat Page
 *
 * xterm.js를 사용하여 PTY 기반 Claude CLI 프로세스와 실시간 통신하는 페이지입니다.
 * - SSE로 TUI 출력 스트리밍 (/api/pty/stream/:sessionId)
 * - SSE로 ask_user_question 이벤트 수신 (/api/sse/:sessionId)
 * - REST로 사용자 입력 전달 (/api/pty/input/:sessionId)
 */
const PtyChatPage = () => {
    const {sessionId} = useParams<{sessionId: string}>();
    const {onMenuClick} = useOutletContext<{onMenuClick: () => void}>();
    const {t} = useTranslation();

    // 세션 정보 조회
    const {data: session} = useSessionQuery(sessionId);
    const sessionName = session?.name || `PTY Session`;

    // 상태
    const [, setIsConnected] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);
    const [questionData, setQuestionData] = useState<QuestionData | null>(null);
    const [questionSubmitted, setQuestionSubmitted] = useState(false);

    // Refs
    const terminalRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const eventSourceRef = useRef<EventSource | null>(null);
    const hooksEventSourceRef = useRef<EventSource | null>(null);

    // 답변 제출
    const {submitAnswer, isSubmitting} = useSubmitQuestionAnswer();

    // 입력 전송
    const sendInput = useCallback(async (input: string) => {
        if (!sessionId) return;

        try {
            const response = await fetch(`/api/pty/input/${sessionId}`, {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({input})
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
        } catch (err) {
            console.error("[PTY] Send error:", err);
            throw err;
        }
    }, [sessionId]);

    // xterm.js 및 SSE 초기화
    useEffect(() => {
        if (!terminalRef.current || !sessionId) return;

        setIsLoading(true);
        setError(null);

        // xterm.js 초기화
        const terminal = new Terminal({
            cursorBlink: true,
            fontSize: 14,
            fontFamily: "'Fira Code', 'Cascadia Code', 'JetBrains Mono', Consolas, monospace",
            theme: {
                background: "#1a1a1a",
                foreground: "#e0e0e0",
                cursor: "#e0e0e0",
                cursorAccent: "#1a1a1a",
                selectionBackground: "#404040",
                black: "#000000",
                red: "#d75f5f",
                green: "#87af87",
                yellow: "#d7af5f",
                blue: "#5f87af",
                magenta: "#af5faf",
                cyan: "#5fafaf",
                white: "#d0d0d0",
                brightBlack: "#808080",
                brightRed: "#ff8787",
                brightGreen: "#afd7af",
                brightYellow: "#ffd787",
                brightBlue: "#87afd7",
                brightMagenta: "#d787d7",
                brightCyan: "#87d7d7",
                brightWhite: "#ffffff"
            },
            convertEol: true,
            scrollback: 5000,
            allowProposedApi: true
        });

        const fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);
        terminal.open(terminalRef.current);

        // 크기 맞추기
        setTimeout(() => {
            fitAddon.fit();
        }, 100);

        xtermRef.current = terminal;
        fitAddonRef.current = fitAddon;

        // xterm 입력 핸들러 - PTY로 전송
        terminal.onData((data) => {
            sendInput(data);
        });

        // PTY 출력 SSE 연결
        const eventSource = new EventSource(`/api/pty/stream/${sessionId}`);
        eventSourceRef.current = eventSource;

        eventSource.addEventListener("connected", () => {
            console.log("[PTY] SSE Connected");
            setIsConnected(true);
            setIsLoading(false);
        });

        eventSource.addEventListener("output", (e) => {
            try {
                const data = JSON.parse(e.data);
                terminal.write(data.data);
            } catch (err) {
                console.error("[PTY] Failed to parse output:", err);
            }
        });

        eventSource.addEventListener("exit", (e) => {
            try {
                const data = JSON.parse(e.data);
                console.log("[PTY] Process exited with code:", data.code);
                terminal.write(`\r\n\x1b[90m[Process exited with code ${data.code}]\x1b[0m\r\n`);
                setIsConnected(false);
            } catch (err) {
                console.error("[PTY] Failed to parse exit:", err);
            }
        });

        eventSource.addEventListener("error", () => {
            console.error("[PTY] SSE error");
            setIsConnected(false);
            setIsLoading(false);
        });

        eventSource.onerror = () => {
            if (eventSource.readyState === EventSource.CLOSED) {
                setError(new Error("Connection closed"));
                setIsConnected(false);
                setIsLoading(false);
            }
        };

        // Hooks SSE 연결 (AskUserQuestion 이벤트용)
        const hooksEventSource = new EventSource(`/api/sse/${sessionId}`);
        hooksEventSourceRef.current = hooksEventSource;

        hooksEventSource.addEventListener("message", (e) => {
            try {
                const data = JSON.parse(e.data);
                if (data.type === "ask_user_question") {
                    console.log("[PTY] Received ask_user_question:", data);
                    setQuestionData({
                        tool_use_id: data.toolUseId,
                        questions: data.questions
                    });
                    setQuestionSubmitted(false);
                }
            } catch (err) {
                console.error("[PTY] Failed to parse hooks event:", err);
            }
        });

        // 리사이즈 핸들러
        const handleResize = () => {
            if (fitAddonRef.current) {
                fitAddonRef.current.fit();
            }
        };

        window.addEventListener("resize", handleResize);

        // Cleanup
        return () => {
            window.removeEventListener("resize", handleResize);
            eventSource.close();
            hooksEventSource.close();
            terminal.dispose();
        };
    }, [sessionId, sendInput]);

    // 질문 답변 제출
    const handleQuestionSubmit = (answers: QuestionAnswer[]) => {
        if (!questionData || !sessionId) return;

        // 답변을 PTY stdin으로 전송 (숫자 키 입력)
        const answerText = answers.map(a => a.selectedOptions?.join(", ") || "").join("\n");
        sendInput(answerText + "\n");

        submitAnswer(sessionId, questionData.tool_use_id, answers);
        setQuestionSubmitted(true);
    };

    return (
        <div className="relative flex-1 flex flex-col overflow-hidden bg-[#1a1a1a]">
            {/* Header */}
            <PageHeader title={sessionName} onMenuClick={onMenuClick} />

            {/* 로딩 상태 */}
            {isLoading && (
                <div className="flex-1 flex items-center justify-center">
                    <div className="text-center">
                        <div className="animate-spin w-8 h-8 border-4 border-accent-primary border-t-transparent rounded-full mx-auto mb-4" />
                        <p className="text-text-secondary">{t("terminal.connecting")}</p>
                    </div>
                </div>
            )}

            {/* 에러 상태 */}
            {error && !isLoading && (
                <div className="flex-1 flex items-center justify-center">
                    <div className="text-center text-red-500">
                        <p className="font-semibold mb-2">{t("common.error")}</p>
                        <p className="text-sm">{error.message}</p>
                    </div>
                </div>
            )}

            {/* Terminal */}
            <div
                ref={terminalRef}
                className="flex-1"
                style={{
                    display: isLoading ? "none" : "block",
                    padding: "8px"
                }}
            />

            {/* AskUserQuestion 카드 */}
            {questionData && !questionSubmitted && (
                <div className="p-4 bg-bg-primary border-t border-border-default">
                    <QuestionCard
                        questionData={questionData}
                        isSubmitted={questionSubmitted}
                        isSubmitting={isSubmitting}
                        onSubmit={handleQuestionSubmit}
                    />
                </div>
            )}
        </div>
    );
};

export default PtyChatPage;
