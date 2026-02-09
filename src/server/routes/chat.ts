/**
 * Chat Routes - PTY + Hooks + Transcript 통합
 *
 * - POST /api/chat/start - PTY 세션 시작
 * - POST /api/chat/send - PTY stdin 메시지 전송 (fire-and-forget)
 * - POST /api/chat/tool-result - AskUserQuestion 답변을 PTY stdin으로 전송
 * - POST /api/chat/stop - Claude 작업 중단 (Ctrl+C 시그널 전송)
 *
 * 응답 수신 방식:
 * - 도구 사용: Hooks (PostToolUse) → SSE tool_use_message
 * - 질문: Hooks (PreToolUse AskUserQuestion) → SSE ask_user_question
 * - 텍스트 응답: Stop Hook → transcript JSONL 파싱 → SSE assistant_message
 * - 턴 완료: Stop Hook → SSE turn_complete
 */

import { Router, type Router as RouterType } from "express";
import { getDatabase } from "../services/database.js";
import sessionStatusManager from "../services/sessionStatusManager.js";
import claudeProcessManager from "../services/claudeProcessManager.js";
import sseManager from "../services/sseManager.js";
import { pendingPermissions } from "./hooks.js";

const router: RouterType = Router();

// 타입 정의
interface ToolResultRequest {
    sessionId: string;
    clientId: string;
    toolUseId: string;
    answers: QuestionAnswer[];
}

interface QuestionAnswer {
    questionIndex: number;
    question: string;
    selectedOptions: string[];
    selectedIndices?: number[]; // 선택한 옵션의 인덱스 (0부터 시작)
    isOther?: boolean; // Other 텍스트 입력인지
}

// 유틸리티: 방향키 시퀀스 생성 (옵션 인덱스 기반)
// Claude TUI에서 AskUserQuestion은 방향키로 옵션 선택 후 Enter
const formatAnswerAsKeySequence = (answer: QuestionAnswer): string => {
    // Other 텍스트 입력인 경우: 텍스트 그대로 반환 (마지막 옵션 "Other" 선택 후 입력)
    if (answer.isOther) {
        return answer.selectedOptions.join(", ");
    }

    // 옵션 선택인 경우: 첫 번째 선택된 인덱스 기준으로 방향키 생성
    // 기본 커서는 첫 번째 옵션(인덱스 0)에 위치
    const optionIndex = answer.selectedIndices?.[0] ?? 0;

    // 인덱스만큼 ↓ 키 + Enter
    // 방향키 Down = \x1b[B (ANSI escape sequence)
    const downArrows = '\x1b[B'.repeat(optionIndex);
    return downArrows; // Enter는 writeAnswer에서 추가됨
};

// POST /api/chat/start - PTY 세션 시작
router.post("/start", async (req, res) => {
    try {
        const { sessionId, clientId, claudeSessionId } = req.body;
        console.log("[CHAT START] Request received:", { sessionId, clientId, claudeSessionId });

        if (!sessionId || !clientId) {
            res.status(400).json({
                error: {
                    code: "MISSING_PARAMETERS",
                    message: "sessionId and clientId are required"
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

        // PTY 프로세스 생성 (clientId 기반)
        const cp = await claudeProcessManager.createForClient(
            clientId,
            sessionId,
            claudeSessionId || session.claude_session_id,
            projectPath
        );

        console.log("[CHAT START] PTY process ready:", {
            clientId,
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

// POST /api/chat/send - PTY stdin으로 메시지 전송 (fire-and-forget)
router.post("/send", async (req, res) => {
    try {
        const { sessionId, clientId, message, images } = req.body;
        console.log("[CHAT SEND] Request received:", { sessionId, clientId, messageLength: message?.length, hasImages: !!images });

        if (!sessionId || !clientId || !message) {
            res.status(400).json({
                error: {
                    code: "MISSING_PARAMETERS",
                    message: "sessionId, clientId, and message are required"
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
            }
        }

        // 세션 조회 (claude_session_id, project_path 등)
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

        // 로딩 상태 SSE broadcast
        sessionStatusManager.setStatus(sessionId, "streaming");
        sseManager.broadcastToSession(sessionId, {
            type: "loading_start",
            sessionId
        });

        // PTY 프로세스가 없으면 자동 생성
        const projectPath = session.project_path || process.cwd();
        const isNewProcess = !claudeProcessManager.hasProcess(clientId);
        await claudeProcessManager.createForClient(
            clientId,
            sessionId,
            session.claude_session_id,
            projectPath
        );

        // 새 프로세스 생성 시 TUI 초기화 대기
        if (isNewProcess) {
            console.log("[CHAT SEND] New PTY process created, waiting for TUI initialization...");
            // TUI가 입력 프롬프트를 표시할 때까지 대기
            await new Promise<void>((resolve) => {
                let resolved = false;
                const timeout = setTimeout(() => {
                    if (!resolved) { resolved = true; resolve(); }
                }, 10000); // 최대 10초

                const unsubscribe = claudeProcessManager.onData(clientId, (data: string) => {
                    // TUI가 준비되면 입력 힌트가 표시됨
                    if (data.includes('ctrl+') || data.includes('Ctrl+') || data.includes('Tips') || data.includes('Welcome')) {
                        // 추가 대기 (TUI 렌더링 완료)
                        setTimeout(() => {
                            if (!resolved) {
                                resolved = true;
                                clearTimeout(timeout);
                                unsubscribe();
                                resolve();
                            }
                        }, 1000);
                    }
                });
            });
            console.log("[CHAT SEND] TUI initialization detected, proceeding...");
        }

        // PTY stdin으로 메시지 전송 (텍스트와 Enter를 분리 전송)
        const writeSuccess = claudeProcessManager.write(clientId, actualMessage);

        if (writeSuccess) {
            // 텍스트 입력 후 딜레이를 두고 Enter 전송
            await new Promise(resolve => setTimeout(resolve, 500));
            claudeProcessManager.write(clientId, '\r');
            console.log("[CHAT SEND] Message + Enter sent to PTY stdin");
            res.json({ success: true });
        } else {
            console.log("[CHAT SEND] Failed to write to PTY");
            res.status(500).json({
                error: {
                    code: "PTY_WRITE_FAILED",
                    message: "Failed to write to PTY process"
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

// POST /api/chat/tool-result - AskUserQuestion 답변을 PTY stdin으로 전송
router.post("/tool-result", async (req, res) => {
    try {
        const { sessionId, clientId, toolUseId, answers } = req.body as ToolResultRequest;
        console.log("[TOOL RESULT] Request received:", {
            sessionId,
            clientId,
            toolUseId,
            answersCount: answers?.length
        });

        // 1. 입력 검증
        if (!sessionId || !clientId || !answers || !Array.isArray(answers) || answers.length === 0) {
            res.status(400).json({
                error: {
                    code: "INVALID_REQUEST",
                    message: "sessionId, clientId, and answers are required"
                }
            });
            return;
        }

        // 2. 세션 조회
        const db = getDatabase();
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

        // 3. 로딩 상태 SSE broadcast
        sessionStatusManager.setStatus(sessionId, "streaming");
        sseManager.broadcastToSession(sessionId, {
            type: "loading_start",
            sessionId
        });

        // 4. PTY stdin으로 답변 전송 (각 질문마다 방향키 시퀀스 + Enter)
        let success = true;
        for (let i = 0; i < answers.length; i++) {
            const answer = answers[i];
            const keySequence = formatAnswerAsKeySequence(answer);
            console.log(`[TOOL RESULT] Q${i + 1}: selectedIndices=${JSON.stringify(answer.selectedIndices)}, isOther=${answer.isOther}, keySequence="${keySequence.replace(/\x1b/g, '\\x1b')}"`);

            // 방향키 시퀀스 전송 후 Enter
            const written = claudeProcessManager.writeAnswer(clientId, keySequence);
            if (!written) {
                success = false;
                break;
            }

            // 다음 질문 전에 딜레이 (TUI가 다음 질문을 렌더링할 시간)
            if (i < answers.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        if (success) {
            console.log("[TOOL RESULT] Answer sent to PTY stdin");
            res.json({ success: true });
        } else {
            console.log("[TOOL RESULT] No active PTY process");
            res.status(404).json({
                error: {
                    code: "NO_ACTIVE_PROCESS",
                    message: "No active PTY process for this client"
                }
            });
        }
    } catch (error) {
        console.log("[TOOL RESULT] Error:", error);
        res.status(500).json({
            error: {
                code: "TOOL_RESULT_FAILED",
                message: error instanceof Error ? error.message : "Unknown error"
            }
        });
    }
});

// POST /api/chat/permission-decide - 사용자 권한 결정 처리
router.post("/permission-decide", async (req, res) => {
    try {
        const { requestId, behavior } = req.body;

        if (!requestId || !behavior) {
            res.status(400).json({ error: { code: "INVALID_REQUEST", message: "requestId and behavior are required" } });
            return;
        }

        if (behavior !== "allow" && behavior !== "deny") {
            res.status(400).json({ error: { code: "INVALID_BEHAVIOR", message: "behavior must be 'allow' or 'deny'" } });
            return;
        }

        const pending = pendingPermissions.get(requestId);

        if (!pending) {
            res.status(404).json({ error: { code: "REQUEST_NOT_FOUND", message: "Permission request not found" } });
            return;
        }

        // 결정 저장
        pending.decided = true;
        pending.behavior = behavior;

        // SSE로 프론트엔드에 알림
        sseManager.broadcastToSession(pending.sessionId, {
            type: "permission_decided",
            sessionId: pending.sessionId,
            requestId,
            behavior
        });

        console.log(`[CHAT] PermissionDecide: User decided ${behavior} for ${requestId}`);

        res.json({ success: true });
    } catch (error) {
        console.log("[CHAT] PermissionDecide error:", error);
        res.status(500).json({ error: { code: "PERMISSION_DECIDE_FAILED", message: error instanceof Error ? error.message : "Unknown error" } });
    }
});

// POST /api/chat/stop - Claude 작업 중단 (Ctrl+C)
router.post("/stop", (req, res) => {
    try {
        const { sessionId, clientId } = req.body;
        console.log("[CHAT STOP] Request received:", { sessionId, clientId });

        if (!sessionId || !clientId) {
            res.status(400).json({
                error: {
                    code: "MISSING_PARAMETERS",
                    message: "sessionId and clientId are required"
                }
            });
            return;
        }

        // PTY에 Ctrl+C 시그널 전송 (ESC 03)
        const success = claudeProcessManager.write(clientId, '\x03');

        if (success) {
            // SSE로 프론트엔드에 알림
            sseManager.broadcastToSession(sessionId, {
                type: "stop_requested",
                sessionId
            });
            console.log("[CHAT STOP] Stop signal sent to PTY");
            res.json({ success: true });
        } else {
            console.log("[CHAT STOP] No active PTY process");
            res.status(404).json({
                error: {
                    code: "NO_PROCESS",
                    message: "No active process for this client"
                }
            });
        }
    } catch (error) {
        console.log("[CHAT STOP] Error:", error);
        res.status(500).json({
            error: {
                code: "STOP_FAILED",
                message: error instanceof Error ? error.message : "Unknown error"
            }
        });
    }
});

export default router;
