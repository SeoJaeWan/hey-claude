import {useState, useCallback, useEffect, useRef} from "react";
import type {QuestionItem, Message} from "../../../../types";

/**
 * PTY 세션 생성 Hook
 */
export const useCreatePtySession = () => {
    const [isCreating, setIsCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const createSession = useCallback(async (sessionId?: string, claudeSessionId?: string, cwd?: string) => {
        setIsCreating(true);
        setError(null);

        try {
            const response = await fetch("/api/pty/create", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({sessionId, claudeSessionId, cwd})
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            return data;
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : "Failed to create PTY session";
            setError(errorMsg);
            console.error("[PTY] Create error:", err);
            throw err;
        } finally {
            setIsCreating(false);
        }
    }, []);

    return {createSession, isCreating, error};
};

/**
 * PTY 세션 상태 조회 Hook
 */
export const usePtyStatus = () => {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const getStatus = useCallback(async (sessionId: string) => {
        setIsLoading(true);
        setError(null);

        try {
            const response = await fetch(`/api/pty/status/${sessionId}`);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            return data;
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : "Failed to get PTY status";
            setError(errorMsg);
            console.error("[PTY] Status error:", err);
            return null;
        } finally {
            setIsLoading(false);
        }
    }, []);

    return {getStatus, isLoading, error};
};

/**
 * PTY 세션 종료 Hook
 */
export const useTerminatePtySession = () => {
    const [isTerminating, setIsTerminating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const terminate = useCallback(async (sessionId: string) => {
        setIsTerminating(true);
        setError(null);

        try {
            const response = await fetch(`/api/pty/${sessionId}`, {
                method: "DELETE"
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            return true;
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : "Failed to terminate PTY session";
            setError(errorMsg);
            console.error("[PTY] Terminate error:", err);
            return false;
        } finally {
            setIsTerminating(false);
        }
    }, []);

    return {terminate, isTerminating, error};
};

/**
 * PTY 리사이즈 Hook
 */
export const useResizePty = () => {
    const resize = useCallback(async (sessionId: string, cols: number, rows: number) => {
        try {
            const response = await fetch(`/api/pty/resize/${sessionId}`, {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({cols, rows})
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            return true;
        } catch (err) {
            console.error("[PTY] Resize error:", err);
            return false;
        }
    }, []);

    return {resize};
};

/**
 * usePtySession Options
 */
export interface UsePtySessionOptions {
    sessionId: string;
    claudeSessionId?: string;
    cwd?: string;
    onOutput?: (data: string) => void;
    onExit?: (code: number) => void;
    onAskUserQuestion?: (questionData: {tool_use_id: string; questions: QuestionItem[]}) => void;
    onToolUseMessage?: (message: Message) => void;
}

/**
 * usePtySession Return
 */
export interface UsePtySessionReturn {
    isConnected: boolean;
    isLoading: boolean;
    error: Error | null;
    sendInput: (input: string) => Promise<void>;
    resize: (cols: number, rows: number) => Promise<void>;
    terminate: () => Promise<void>;
}

/**
 * PTY 세션 관리 통합 훅
 *
 * - PTY 세션 생성 및 연결
 * - SSE로 PTY 출력 스트리밍 (/api/pty/stream/:sessionId)
 * - SSE로 Hooks 데이터 수신 (/api/sse/:sessionId - ask_user_question)
 * - 입력 전송, 크기 조정, 종료
 */
export const usePtySession = (options: UsePtySessionOptions): UsePtySessionReturn => {
    const {sessionId, claudeSessionId, cwd, onOutput, onExit, onAskUserQuestion, onToolUseMessage} = options;

    const [isLoading, setIsLoading] = useState(false);
    const [isConnected, setIsConnected] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    const ptyStreamRef = useRef<EventSource | null>(null);
    const hooksStreamRef = useRef<EventSource | null>(null);
    const isInitializedRef = useRef(false);

    /**
     * 1. PTY 세션 생성
     */
    const createPtySession = useCallback(async () => {
        try {
            const response = await fetch("/api/pty/create", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({
                    sessionId,
                    claudeSessionId,
                    cwd
                })
            });

            if (!response.ok) {
                throw new Error(`Failed to create PTY session: ${response.status}`);
            }

            const result = await response.json();

            if (!result.success) {
                throw new Error(result.error || "Failed to create PTY session");
            }

            return result;
        } catch (err) {
            console.error("[usePtySession] Create error:", err);
            throw err;
        }
    }, [sessionId, claudeSessionId, cwd]);

    /**
     * 2. PTY 출력 SSE 연결
     */
    const connectPtyStream = useCallback(() => {
        if (ptyStreamRef.current) {
            ptyStreamRef.current.close();
        }

        const eventSource = new EventSource(`/api/pty/stream/${sessionId}`);

        eventSource.addEventListener("connected", () => {
            console.log(`[usePtySession] PTY stream connected for session ${sessionId}`);
            setIsConnected(true);
            setIsLoading(false);
        });

        eventSource.addEventListener("output", (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === "output" && onOutput) {
                    onOutput(data.data);
                }
            } catch (err) {
                console.error("[usePtySession] Failed to parse output event:", err);
            }
        });

        eventSource.addEventListener("exit", (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === "exit") {
                    console.log(`[usePtySession] PTY process exited with code ${data.code}`);
                    setIsConnected(false);
                    if (onExit) {
                        onExit(data.code);
                    }
                }
            } catch (err) {
                console.error("[usePtySession] Failed to parse exit event:", err);
            }
        });

        eventSource.addEventListener("error", (err) => {
            console.error("[usePtySession] PTY stream error:", err);
            setError(new Error("PTY stream connection failed"));
            setIsConnected(false);
            setIsLoading(false);
        });

        ptyStreamRef.current = eventSource;
    }, [sessionId, onOutput, onExit]);

    /**
     * 3. Hooks SSE 연결 (ask_user_question, tool_use_message 이벤트용)
     */
    const connectHooksStream = useCallback(() => {
        if (hooksStreamRef.current) {
            hooksStreamRef.current.close();
        }

        const eventSource = new EventSource(`/api/sse/${sessionId}`);

        eventSource.addEventListener("message", (event) => {
            try {
                const parsed = JSON.parse(event.data);

                // ask_user_question 이벤트 처리
                if (parsed.type === "ask_user_question" && onAskUserQuestion) {
                    const {toolUseId, questions} = parsed;
                    onAskUserQuestion({tool_use_id: toolUseId, questions});
                }

                // tool_use_message 이벤트 처리
                if (parsed.type === "tool_use_message" && onToolUseMessage) {
                    onToolUseMessage(parsed.message);
                }
            } catch (err) {
                console.error("[usePtySession] Failed to parse hooks event:", err);
            }
        });

        eventSource.addEventListener("error", (err) => {
            console.error("[usePtySession] Hooks stream error:", err);
        });

        hooksStreamRef.current = eventSource;
    }, [sessionId, onAskUserQuestion, onToolUseMessage]);

    /**
     * 4. 세션 초기화
     */
    useEffect(() => {
        if (isInitializedRef.current) return;

        const initialize = async () => {
            setIsLoading(true);
            setError(null);

            try {
                // PTY 세션 생성
                await createPtySession();

                // SSE 연결 (PTY 출력 + Hooks 데이터)
                connectPtyStream();
                connectHooksStream();

                isInitializedRef.current = true;
            } catch (err) {
                console.error("[usePtySession] Initialization failed:", err);
                setError(err instanceof Error ? err : new Error("Initialization failed"));
                setIsLoading(false);
            }
        };

        initialize();

        // Cleanup: SSE 연결 해제
        return () => {
            if (ptyStreamRef.current) {
                ptyStreamRef.current.close();
                ptyStreamRef.current = null;
            }
            if (hooksStreamRef.current) {
                hooksStreamRef.current.close();
                hooksStreamRef.current = null;
            }
        };
    }, [createPtySession, connectPtyStream, connectHooksStream]);

    /**
     * 5. 입력 전송
     */
    const sendInput = useCallback(
        async (input: string) => {
            try {
                const response = await fetch(`/api/pty/input/${sessionId}`, {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({input})
                });

                if (!response.ok) {
                    throw new Error(`Failed to send input: ${response.status}`);
                }

                const result = await response.json();

                if (!result.success) {
                    throw new Error(result.error || "Failed to send input");
                }
            } catch (err) {
                console.error("[usePtySession] Send input error:", err);
                throw err;
            }
        },
        [sessionId]
    );

    /**
     * 6. 크기 조정
     */
    const resize = useCallback(
        async (cols: number, rows: number) => {
            try {
                const response = await fetch(`/api/pty/resize/${sessionId}`, {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({cols, rows})
                });

                if (!response.ok) {
                    throw new Error(`Failed to resize: ${response.status}`);
                }

                const result = await response.json();

                if (!result.success) {
                    throw new Error(result.error || "Failed to resize");
                }
            } catch (err) {
                console.error("[usePtySession] Resize error:", err);
                throw err;
            }
        },
        [sessionId]
    );

    /**
     * 7. 종료
     */
    const terminate = useCallback(async () => {
        try {
            const response = await fetch(`/api/pty/${sessionId}`, {
                method: "DELETE"
            });

            if (!response.ok) {
                throw new Error(`Failed to terminate: ${response.status}`);
            }

            const result = await response.json();

            if (!result.success) {
                throw new Error(result.error || "Failed to terminate");
            }

            // SSE 연결 해제
            if (ptyStreamRef.current) {
                ptyStreamRef.current.close();
                ptyStreamRef.current = null;
            }
            if (hooksStreamRef.current) {
                hooksStreamRef.current.close();
                hooksStreamRef.current = null;
            }

            setIsConnected(false);
        } catch (err) {
            console.error("[usePtySession] Terminate error:", err);
            throw err;
        }
    }, [sessionId]);

    return {
        isConnected,
        isLoading,
        error,
        sendInput,
        resize,
        terminate
    };
};
