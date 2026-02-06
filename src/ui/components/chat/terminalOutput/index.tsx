import {useEffect, useRef} from "react";
import {Terminal} from "@xterm/xterm";
import {FitAddon} from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface TerminalOutputProps {
    sessionId: string;
    className?: string;
    onReady?: (terminal: Terminal) => void;
}

/**
 * TerminalOutput 컴포넌트
 *
 * xterm.js를 사용하여 PTY 출력을 실시간으로 표시합니다.
 * ANSI escape codes를 제대로 렌더링합니다.
 */
const TerminalOutput = ({sessionId, className = "", onReady}: TerminalOutputProps) => {
    const terminalRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const eventSourceRef = useRef<EventSource | null>(null);

    useEffect(() => {
        if (!terminalRef.current) return;

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
        }, 0);

        xtermRef.current = terminal;
        fitAddonRef.current = fitAddon;

        // 콜백 호출
        if (onReady) {
            onReady(terminal);
        }

        // SSE 연결
        const eventSource = new EventSource(`/api/pty/stream/${sessionId}`);
        eventSourceRef.current = eventSource;

        eventSource.addEventListener("connected", (e) => {
            console.log("[Terminal] Connected:", e.data);
        });

        eventSource.addEventListener("output", (e) => {
            try {
                const data = JSON.parse(e.data);
                terminal.write(data.data);
            } catch (err) {
                console.error("[Terminal] Failed to parse output:", err);
            }
        });

        eventSource.addEventListener("exit", (e) => {
            try {
                const data = JSON.parse(e.data);
                console.log("[Terminal] Process exited with code:", data.code);
                terminal.write(`\r\n\x1b[90m[Process exited with code ${data.code}]\x1b[0m\r\n`);
            } catch (err) {
                console.error("[Terminal] Failed to parse exit:", err);
            }
        });

        eventSource.addEventListener("error", (e) => {
            console.error("[Terminal] SSE error:", e);
            eventSource.close();
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
            terminal.dispose();
        };
    }, [sessionId, onReady]);

    return (
        <div
            ref={terminalRef}
            className={`terminal-output rounded-lg overflow-hidden ${className}`}
            style={{
                height: "100%",
                minHeight: "400px"
            }}
        />
    );
};

export default TerminalOutput;
