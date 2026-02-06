/**
 * Chat Routes - PTY 기반 전환 중 (Phase 1)
 *
 * Phase 1 상태:
 * - POST /api/chat/start - PTY 세션 시작 (신규)
 * - POST /api/chat/send - PTY stdin 메시지 전송 (신규)
 * - POST /api/chat/stream - 기존 호환성 유지 (stream-json 모드)
 * - POST /api/chat/tool-result - 기존 방식 유지 (Issue #16712)
 *
 * Phase 2 계획:
 * - /api/chat/stream을 PTY + Hooks 데이터 기반으로 전환
 * - stream-json 파싱 로직 제거
 */

import { Router, type Router as RouterType } from "express";
import { randomUUID } from "crypto";
import { getRecentContext } from "../services/context.js";
import { getDatabase } from "../services/database.js";
import sessionStatusManager from "../services/sessionStatusManager.js";
import claudeProcessManager from "../services/claudeProcessManager.js";
import { callClaude } from "../services/claude.js";

const router: RouterType = Router();

// 타입 정의: POST /api/chat/tool-result
interface ToolResultRequest {
    sessionId: string;
    toolUseId: string;
    answers: QuestionAnswer[];
}

interface QuestionAnswer {
    questionIndex: number;
    question: string;
    selectedOptions: string[];
}

// 유틸리티: 사용자 답변을 자연어 프롬프트로 변환
const formatAnswersAsPrompt = (answers: QuestionAnswer[], toolUseId: string): string => {
    const formattedAnswers = answers
        .map(a => {
            const selections = a.selectedOptions.join(", ");
            return `${a.questionIndex + 1}. ${a.question}\n   답변: ${selections}`;
        })
        .join("\n\n");

    return `[Tool Result: AskUserQuestion]
Tool Use ID: ${toolUseId}

이전 질문에 대한 답변입니다:

${formattedAnswers}

이 정보를 바탕으로 작업을 계속 진행해주세요.`;
};

// 유틸리티: 문장 종료 후 줄바꿈 추가
const formatTextWithLineBreaks = (text: string): string => {
    // 마침표(.) 뒤에 공백이나 대문자로 시작하는 새 문장이 오면 \n\n 추가
    return text.replace(/\.\s+([가-힣A-Z])/g, '.\n\n$1');
};

// 유틸리티: SubagentStop 감지 패턴
const subagentStopPatterns = [
    /SubagentStop/,
    /agent.*completed/i,
    /background.*task.*finished/i,
    /"type":"subagent_stop"/
];

const isSubagentStop = (text: string): boolean => {
    return subagentStopPatterns.some(pattern => pattern.test(text));
};

// 유틸리티: SSE 메시지 전송 및 즉시 flush
const writeSSE = (res: any, data: any): void => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (typeof res.flush === 'function') {
        res.flush();
    }
};

// POST /api/chat/start - PTY 세션 시작
router.post("/start", async (req, res) => {
    try {
        const { sessionId, claudeSessionId } = req.body;
        console.log("[CHAT START] Request received:", { sessionId, claudeSessionId });

        if (!sessionId) {
            res.status(400).json({
                error: {
                    code: "MISSING_PARAMETERS",
                    message: "sessionId is required"
                }
            });
            return;
        }

        const db = getDatabase();
        const projectPath = process.cwd();

        // 세션 조회
        const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as any;

        if (!session) {
            console.log("[CHAT START] Session not found:", sessionId);
            res.status(404).json({
                error: {
                    code: "SESSION_NOT_FOUND",
                    message: "Session not found"
                }
            });
            return;
        }

        // PTY 프로세스 생성/재사용
        const cp = await claudeProcessManager.getOrCreateProcess(
            sessionId,
            claudeSessionId || session.claude_session_id,
            projectPath
        );

        console.log("[CHAT START] PTY process ready:", {
            sessionId: cp.sessionId,
            claudeSessionId: cp.claudeSessionId,
            state: cp.state
        });

        res.json({
            success: true,
            sessionId: cp.sessionId,
            claudeSessionId: cp.claudeSessionId
        });
    } catch (error) {
        console.log("[CHAT START] Error:", error);
        res.status(500).json({
            error: {
                code: "PTY_START_FAILED",
                message: error instanceof Error ? error.message : "Unknown error"
            }
        });
    }
});

// POST /api/chat/send - PTY stdin으로 메시지 전송
router.post("/send", async (req, res) => {
    try {
        const { sessionId, message, images } = req.body;
        console.log("[CHAT SEND] Request received:", { sessionId, messageLength: message?.length, hasImages: !!images });

        if (!sessionId || !message) {
            res.status(400).json({
                error: {
                    code: "MISSING_PARAMETERS",
                    message: "sessionId and message are required"
                }
            });
            return;
        }

        const db = getDatabase();

        // 메시지 파싱 (images가 있는 경우 JSON 형태일 수 있음)
        let actualMessage = message;
        let imageData = images;

        // 메시지가 JSON 형태인지 확인 (images 포함)
        if (typeof message === 'string' && message.startsWith('{')) {
            try {
                const parsed = JSON.parse(message);
                if (parsed.text) {
                    actualMessage = parsed.text;
                    imageData = parsed.images || imageData;
                }
            } catch (e) {
                // JSON 파싱 실패 시 원본 메시지 사용
                console.log("[CHAT SEND] Message is not JSON, using as-is");
            }
        }

        // 사용자 메시지 저장 (이미지 포함)
        const userMessageId = randomUUID();
        const imagesJson = imageData ? JSON.stringify(imageData) : null;
        db.prepare(
            `INSERT INTO messages (id, session_id, role, content, images, timestamp)
             VALUES (?, ?, ?, ?, ?, ?)`
        ).run(userMessageId, sessionId, "user", actualMessage, imagesJson, new Date().toISOString());

        console.log("[CHAT SEND] User message saved to database:", { messageId: userMessageId, hasImages: !!imageData });

        // PTY stdin으로 메시지 전송 (원본 message 사용)
        const success = claudeProcessManager.write(sessionId, message + '\n');

        if (success) {
            console.log("[CHAT SEND] Message sent to PTY stdin");
            res.json({ success: true, messageId: userMessageId });
        } else {
            console.log("[CHAT SEND] No active PTY process found");
            res.status(404).json({
                error: {
                    code: "NO_ACTIVE_PROCESS",
                    message: "No active PTY process for this session"
                }
            });
        }
    } catch (error) {
        console.log("[CHAT SEND] Error:", error);
        res.status(500).json({
            error: {
                code: "PTY_SEND_FAILED",
                message: error instanceof Error ? error.message : "Unknown error"
            }
        });
    }
});

// POST /api/chat/stream - SSE 스트리밍 (PTY 기반)
// 기존 호환성 유지: stream-json 파싱 대신 Hooks 데이터 사용 예정
router.post("/stream", async (req, res) => {
    try {
        const { sessionId, prompt, images } = req.body;
        console.log("[CHAT STREAM] Request received:", { sessionId, prompt: prompt?.substring(0, 50) });

        if (!sessionId || !prompt) {
            res.status(400).json({
                error: {
                    code: "MISSING_PARAMETERS",
                    message: "sessionId and prompt are required"
                }
            });
            return;
        }

        // SSE 헤더 설정
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering
        console.log("[CHAT STREAM] SSE headers set");

        // Send initial connection event and flush immediately
        writeSSE(res, { type: "connected" });

        // Set status to streaming
        sessionStatusManager.setStatus(sessionId, "streaming");

        const db = getDatabase();
        const projectPath = process.cwd();

        // 세션 조회
        const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as any;

        if (!session) {
            console.log("[CHAT STREAM] Session not found:", sessionId);
            writeSSE(res, { type: "error", error: "Session not found" });
            res.end();
            return;
        }

        console.log("[CHAT STREAM] Session found:", {
            type: session.type,
            model: session.model,
            claude_session_id: session.claude_session_id
        });

        // 사용자 메시지 저장 (이미지 포함)
        const userMessageId = randomUUID();
        const imagesJson = images ? JSON.stringify(images) : null;
        db.prepare(
            `INSERT INTO messages (id, session_id, role, content, images, timestamp)
             VALUES (?, ?, ?, ?, ?, ?)`
        ).run(userMessageId, sessionId, "user", prompt, imagesJson, new Date().toISOString());

        // 컨텍스트 주입
        const context = await getRecentContext({ projectPath, sessionId });
        const finalPrompt = context ? `${context}\n\n${prompt}` : prompt;
        console.log("[CHAT STREAM] Context prepared, final prompt length:", finalPrompt.length);

        // 응답 변수
        let assistantResponse = "";
        let claudeSessionId = session.claude_session_id;
        let questionData: any = null;

        // 청크 콜백 (stream-json 파싱 - 임시 유지, Phase 2에서 Hooks로 대체 예정)
        const onChunk = (parsed: any) => {
            // Claude Code 세션 ID 추출
            if (parsed.session_id) {
                claudeSessionId = parsed.session_id;
                console.log("[CHAT STREAM] Claude session ID extracted:", claudeSessionId);
            }

            // type: "assistant" 메시지에서 실제 텍스트 및 tool_use 추출
            if (parsed.type === "assistant" && parsed.message?.content) {
                for (const contentBlock of parsed.message.content) {
                    // 텍스트 블록 처리
                    if (contentBlock.type === "text" && contentBlock.text) {
                        const text = contentBlock.text;
                        assistantResponse += text;

                        // SubagentStop 감지
                        if (isSubagentStop(text)) {
                            console.log("[CHAT STREAM] SubagentStop detected");
                            sessionStatusManager.decrementBackgroundTasks(sessionId);
                        }

                        // 문장 종료 후 줄바꿈 추가
                        const formattedText = formatTextWithLineBreaks(text);

                        // 질문 패턴 감지: 숫자 목록 (1. 2. 3. 등)
                        const hasNumberedOptions = /^\s*\d+\.\s+.+/m.test(formattedText);

                        if (hasNumberedOptions) {
                            // 질문으로 표시
                            writeSSE(res, { type: "question", content: formattedText });
                            console.log("[CHAT STREAM] Question detected, length:", formattedText.length);
                        } else {
                            // 일반 텍스트
                            writeSSE(res, { type: "chunk", content: formattedText });
                            console.log("[CHAT STREAM] Extracted text, length:", formattedText.length);
                        }
                    }

                    // tool_use 블록 처리
                    if (contentBlock.type === "tool_use") {
                        const toolUseData = {
                            type: "tool_use",
                            tool_use_id: contentBlock.id,
                            tool_name: contentBlock.name,
                            tool_input: contentBlock.input
                        };

                        // Task tool 감지 - 백그라운드 작업 시작
                        if (contentBlock.name === "Task") {
                            console.log("[CHAT STREAM] Task tool detected, incrementing background tasks");
                            sessionStatusManager.incrementBackgroundTasks(sessionId);
                        }

                        // SSE로 tool_use 정보 전송
                        writeSSE(res, toolUseData);
                        console.log("[CHAT STREAM] tool_use detected:", {
                            id: contentBlock.id,
                            name: contentBlock.name,
                            input: contentBlock.input
                        });

                        // AskUserQuestion 데이터 저장
                        if (contentBlock.name === "AskUserQuestion") {
                            questionData = {
                                tool_use_id: contentBlock.id,
                                questions: contentBlock.input.questions
                            };
                            console.log("[CHAT STREAM] AskUserQuestion saved for DB storage");
                        }
                    }
                }
            }

            // type: "result"에서 최종 응답 추출 (fallback)
            else if (parsed.type === "result" && parsed.result && !assistantResponse) {
                assistantResponse = parsed.result;
                writeSSE(res, { type: "chunk", content: parsed.result });
                console.log("[CHAT STREAM] Extracted result text, length:", parsed.result.length);
            }
        };

        // 클라이언트 연결 종료 시 프로세스 종료
        let clientDisconnected = false;
        req.on("close", () => {
            console.log("[CHAT STREAM] Client connection closed");
            clientDisconnected = true;
            // 프로세스는 재사용을 위해 유지 (kill하지 않음)
            // 클라이언트가 끊어도 프로세스는 계속 응답을 받고, 유휴 타임아웃으로 정리됨
        });

        try {
            // 임시: stream-json 모드 계속 사용 (sendMessage 메서드)
            // TODO Phase 2: PTY 기반으로 전환 후 Hooks 데이터로 SSE 응답 구성
            console.log("[CHAT STREAM] Sending message via ClaudeProcessManager (stream-json mode)");
            const result = await claudeProcessManager.sendMessage(
                sessionId,
                finalPrompt,
                session.claude_session_id,
                projectPath,
                onChunk
            );

            // 결과 처리
            claudeSessionId = result.claudeSessionId || claudeSessionId;

            // Check current status and set to idle if not in background tasks
            const currentStatus = sessionStatusManager.getStatus(sessionId);
            if (!currentStatus || currentStatus.backgroundTasksCount === 0) {
                sessionStatusManager.setStatus(sessionId, "idle");
            }

            if (assistantResponse) {
                const assistantMessageId = randomUUID();
                const questionDataJson = questionData ? JSON.stringify(questionData) : null;

                db.prepare(
                    `INSERT INTO messages (id, session_id, role, content, timestamp, question_data)
                     VALUES (?, ?, ?, ?, ?, ?)`
                ).run(assistantMessageId, sessionId, "assistant", assistantResponse, new Date().toISOString(), questionDataJson);

                if (questionDataJson) {
                    console.log("[CHAT STREAM] Saved message with questionData to DB");
                }

                // Claude 세션 ID 업데이트
                if (claudeSessionId && claudeSessionId !== session.claude_session_id) {
                    console.log("[CHAT STREAM] Updating session with new claude_session_id:", claudeSessionId);
                    db.prepare("UPDATE sessions SET claude_session_id = ?, updated_at = ? WHERE id = ?").run(
                        claudeSessionId,
                        new Date().toISOString(),
                        sessionId
                    );
                }
            }

            if (!clientDisconnected) {
                writeSSE(res, { type: "done", code: 0 });
                res.end();
            }
        } catch (error) {
            console.log("[CHAT STREAM] Error during message processing:", error);
            sessionStatusManager.setStatus(sessionId, "idle");

            if (!clientDisconnected) {
                writeSSE(res, {
                    type: "error",
                    error: error instanceof Error ? error.message : "Unknown error"
                });
                res.end();
            }
        }
    } catch (error) {
        console.log("[CHAT STREAM] Exception caught:", error);
        writeSSE(res, {
            type: "error",
            error: error instanceof Error ? error.message : "Unknown error"
        });
        res.end();
    }
});

// POST /api/chat/tool-result - AskUserQuestion 답변 제출
// 주의: Issue #16712로 인해 기존 방식 유지 (새 프로세스 + -p 플래그)
router.post("/tool-result", async (req, res) => {
    try {
        const { sessionId, toolUseId, answers } = req.body as ToolResultRequest;
        console.log("[TOOL RESULT] Request received:", {
            sessionId,
            toolUseId,
            answersCount: answers?.length
        });

        // 1. 입력 검증
        if (!sessionId || !answers || !Array.isArray(answers) || answers.length === 0) {
            console.log("[TOOL RESULT] Invalid request:", { sessionId, answers });
            res.status(400).json({
                error: {
                    code: "INVALID_REQUEST",
                    message: "sessionId and answers are required"
                }
            });
            return;
        }

        // 2. 세션 조회
        const db = getDatabase();
        const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as any;

        if (!session) {
            console.log("[TOOL RESULT] Session not found:", sessionId);
            res.status(404).json({
                error: {
                    code: "SESSION_NOT_FOUND",
                    message: "Session not found"
                }
            });
            return;
        }

        console.log("[TOOL RESULT] Session found:", {
            type: session.type,
            model: session.model,
            claude_session_id: session.claude_session_id
        });

        // 3. 답변 포맷팅
        const answerPrompt = formatAnswersAsPrompt(answers, toolUseId);
        console.log("[TOOL RESULT] Formatted answer prompt:", answerPrompt.substring(0, 200));

        // 4. SSE 헤더 설정
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        console.log("[TOOL RESULT] SSE headers set");

        // Set status to streaming
        sessionStatusManager.setStatus(sessionId, "streaming");

        // 5. 기존 stdin 프로세스 종료 (Issue #16712 하이브리드 접근)
        // AskUserQuestion 답변은 새 프로세스로 처리해야 함
        const existingProcess = claudeProcessManager.getProcess(sessionId);
        if (existingProcess) {
            console.log("[TOOL RESULT] Terminating existing stdin process for hybrid approach");
            claudeProcessManager.terminateProcess(sessionId);
        }

        // 6. Claude CLI 호출 (--resume + -p 플래그) - 기존 방식
        const projectPath = process.cwd();
        console.log("[TOOL RESULT] Calling Claude CLI with:", {
            sessionId: session.claude_session_id,
            cwd: projectPath
        });

        const claude = callClaude({
            prompt: answerPrompt,
            sessionId: session.claude_session_id,
            cwd: projectPath
        });

        let assistantResponse = "";
        let claudeSessionId = session.claude_session_id;
        let buffer = "";

        // 7. stdout 스트리밍
        claude.stdout?.on("data", (data: Buffer) => {
            const chunk = data.toString();
            console.log("[TOOL RESULT] stdout chunk received, length:", chunk.length);

            buffer += chunk;
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
                if (!line.trim()) continue;

                try {
                    const parsed = JSON.parse(line);

                    // Claude Code 세션 ID 추출
                    if (parsed.session_id) {
                        claudeSessionId = parsed.session_id;
                        console.log("[TOOL RESULT] Claude session ID extracted:", claudeSessionId);
                    }

                    // type: "assistant" 메시지에서 실제 텍스트 및 tool_use 추출
                    if (parsed.type === "assistant" && parsed.message?.content) {
                        for (const contentBlock of parsed.message.content) {
                            // 텍스트 블록 처리
                            if (contentBlock.type === "text" && contentBlock.text) {
                                const text = contentBlock.text;
                                assistantResponse += text;

                                // SubagentStop 감지
                                if (isSubagentStop(text)) {
                                    console.log("[TOOL RESULT] SubagentStop detected");
                                    sessionStatusManager.decrementBackgroundTasks(sessionId);
                                }

                                // 문장 종료 후 줄바꿈 추가
                                const formattedText = formatTextWithLineBreaks(text);

                                // 질문 패턴 감지
                                const hasNumberedOptions = /^\s*\d+\.\s+.+/m.test(formattedText);

                                if (hasNumberedOptions) {
                                    writeSSE(res, { type: "question", content: formattedText });
                                    console.log("[TOOL RESULT] Question detected, length:", formattedText.length);
                                } else {
                                    writeSSE(res, { type: "chunk", content: formattedText });
                                    console.log("[TOOL RESULT] Extracted text, length:", formattedText.length);
                                }
                            }

                            // tool_use 블록 처리
                            if (contentBlock.type === "tool_use") {
                                const toolUseData = {
                                    type: "tool_use",
                                    tool_use_id: contentBlock.id,
                                    tool_name: contentBlock.name,
                                    tool_input: contentBlock.input
                                };

                                // Task tool 감지 - 백그라운드 작업 시작
                                if (contentBlock.name === "Task") {
                                    console.log("[TOOL RESULT] Task tool detected, incrementing background tasks");
                                    sessionStatusManager.incrementBackgroundTasks(sessionId);
                                }

                                writeSSE(res, toolUseData);
                                console.log("[TOOL RESULT] tool_use detected:", {
                                    id: contentBlock.id,
                                    name: contentBlock.name,
                                    input: contentBlock.input
                                });
                            }
                        }
                    }

                    // type: "result"에서 최종 응답 추출 (fallback)
                    else if (parsed.type === "result" && parsed.result && !assistantResponse) {
                        assistantResponse = parsed.result;
                        writeSSE(res, { type: "chunk", content: parsed.result });
                        console.log("[TOOL RESULT] Extracted result text, length:", parsed.result.length);
                    }
                } catch (e) {
                    console.log("[TOOL RESULT] Failed to parse JSON line:", line.substring(0, 100));
                }
            }
        });

        // 8. stderr 스트리밍
        claude.stderr?.on("data", (data: Buffer) => {
            const error = data.toString();
            console.log("[TOOL RESULT] stderr received:", error);
            writeSSE(res, { type: "error", content: error });
        });

        // 9. 종료 시 처리
        claude.on("close", (code) => {
            console.log("[TOOL RESULT] Claude process closed with code:", code);
            console.log("[TOOL RESULT] Response length:", assistantResponse.length);

            // Check current status and set to idle if not in background tasks
            const currentStatus = sessionStatusManager.getStatus(sessionId);
            if (!currentStatus || currentStatus.backgroundTasksCount === 0) {
                sessionStatusManager.setStatus(sessionId, "idle");
            }

            if (code === 0 && assistantResponse) {
                const assistantMessageId = randomUUID();
                db.prepare(
                    `INSERT INTO messages (id, session_id, role, content, timestamp)
                     VALUES (?, ?, ?, ?, ?)`
                ).run(assistantMessageId, sessionId, "assistant", assistantResponse, new Date().toISOString());

                // Claude 세션 ID 업데이트
                if (claudeSessionId && claudeSessionId !== session.claude_session_id) {
                    console.log("[TOOL RESULT] Updating session with new claude_session_id:", claudeSessionId);
                    db.prepare("UPDATE sessions SET claude_session_id = ?, updated_at = ? WHERE id = ?").run(
                        claudeSessionId,
                        new Date().toISOString(),
                        sessionId
                    );
                }
            }

            writeSSE(res, { type: "done", code });
            res.end();
        });

        // 10. 에러 핸들링
        claude.on("error", (error) => {
            console.log("[TOOL RESULT] Claude process error:", error);
            writeSSE(res, { type: "error", error: error.message });
            res.end();
        });

    } catch (error) {
        console.log("[TOOL RESULT] Exception caught:", error);
        res.status(500).json({
            error: {
                code: "TOOL_RESULT_FAILED",
                message: error instanceof Error ? error.message : "Unknown error"
            }
        });
    }
});

// NOTE: This endpoint is unreachable - Express uses the first matching route above (line 146)
// Keeping for reference only. TODO: Remove in Phase 4 cleanup.
/*
// POST /api/chat/send - fallback (non-streaming)
router.post("/send", async (req, res) => {
    try {
        const { sessionId, prompt, images } = req.body;

        if (!sessionId || !prompt) {
            res.status(400).json({
                error: {
                    code: "MISSING_PARAMETERS",
                    message: "sessionId and prompt are required"
                }
            });
            return;
        }

        const db = getDatabase();
        const projectPath = process.cwd();

        // 세션 조회
        const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as any;

        if (!session) {
            res.status(404).json({
                error: {
                    code: "SESSION_NOT_FOUND",
                    message: "Session not found"
                }
            });
            return;
        }

        // 사용자 메시지 저장 (이미지 포함)
        const userMessageId = randomUUID();
        const imagesJson = images ? JSON.stringify(images) : null;
        db.prepare(
            `INSERT INTO messages (id, session_id, role, content, images, timestamp)
             VALUES (?, ?, ?, ?, ?, ?)`
        ).run(userMessageId, sessionId, "user", prompt, imagesJson, new Date().toISOString());

        // 컨텍스트 주입
        const context = await getRecentContext({ projectPath, sessionId });
        const finalPrompt = context ? `${context}\n\n${prompt}` : prompt;

        // stdin 기반 메시지 전송
        let assistantResponse = "";
        let claudeSessionId = session.claude_session_id;

        try {
            const result = await claudeProcessManager.sendMessage(
                sessionId,
                finalPrompt,
                session.claude_session_id,
                projectPath,
                (parsed) => {
                    if (parsed.session_id) {
                        claudeSessionId = parsed.session_id;
                    }
                    if (parsed.type === 'assistant' && parsed.message?.content) {
                        for (const block of parsed.message.content) {
                            if (block.type === 'text' && block.text) {
                                assistantResponse += block.text;
                            }
                        }
                    }
                }
            );

            claudeSessionId = result.claudeSessionId || claudeSessionId;

            if (assistantResponse) {
                const assistantMessageId = randomUUID();
                db.prepare(
                    `INSERT INTO messages (id, session_id, role, content, timestamp)
                     VALUES (?, ?, ?, ?, ?)`
                ).run(assistantMessageId, sessionId, "assistant", assistantResponse, new Date().toISOString());

                if (claudeSessionId && claudeSessionId !== session.claude_session_id) {
                    db.prepare("UPDATE sessions SET claude_session_id = ?, updated_at = ? WHERE id = ?").run(
                        claudeSessionId,
                        new Date().toISOString(),
                        sessionId
                    );
                }

                res.json({
                    data: {
                        response: assistantResponse
                    }
                });
            } else {
                res.status(500).json({
                    error: {
                        code: "CLAUDE_CLI_FAILED",
                        message: "No response from Claude"
                    }
                });
            }
        } catch (error) {
            res.status(500).json({
                error: {
                    code: "CLAUDE_CLI_FAILED",
                    message: error instanceof Error ? error.message : "Unknown error"
                }
            });
        }
    } catch (error) {
        res.status(500).json({
            error: {
                code: "CHAT_SEND_FAILED",
                message: error instanceof Error ? error.message : "Unknown error"
            }
        });
    }
});
*/

export default router;
