/**
 * Chat Routes - PTY + Hooks + Transcript 통합
 *
 * - POST /api/chat/start - PTY 세션 시작
 * - POST /api/chat/send - PTY stdin 메시지 전송 (fire-and-forget)
 * - POST /api/chat/tool-result - AskUserQuestion 답변을 PTY stdin으로 전송
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

const router: RouterType = Router();

// 타입 정의
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

// 유틸리티: 사용자 답변을 자연어 텍스트로 변환 (PTY stdin용)
const formatAnswersAsText = (answers: QuestionAnswer[]): string => {
    if (answers.length === 1) {
        // 단일 질문: 선택된 옵션만 전송
        return answers[0].selectedOptions.join(", ");
    }

    // 복수 질문: 번호 + 답변 형식
    return answers
        .map(a => `${a.questionIndex + 1}. ${a.selectedOptions.join(", ")}`)
        .join("\n");
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

// POST /api/chat/send - PTY stdin으로 메시지 전송 (fire-and-forget)
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
        const isNewProcess = !claudeProcessManager.hasProcess(sessionId);
        await claudeProcessManager.getOrCreateProcess(
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

                const unsubscribe = claudeProcessManager.onData(sessionId, (data: string) => {
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
        const writeSuccess = claudeProcessManager.write(sessionId, actualMessage);

        if (writeSuccess) {
            // 텍스트 입력 후 딜레이를 두고 Enter 전송
            await new Promise(resolve => setTimeout(resolve, 500));
            claudeProcessManager.write(sessionId, '\r');
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
        const { sessionId, toolUseId, answers } = req.body as ToolResultRequest;
        console.log("[TOOL RESULT] Request received:", {
            sessionId,
            toolUseId,
            answersCount: answers?.length
        });

        // 1. 입력 검증
        if (!sessionId || !answers || !Array.isArray(answers) || answers.length === 0) {
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
            res.status(404).json({
                error: {
                    code: "SESSION_NOT_FOUND",
                    message: "Session not found"
                }
            });
            return;
        }

        // 3. 답변 텍스트 포맷팅
        const answerText = formatAnswersAsText(answers);
        console.log("[TOOL RESULT] Answer text:", answerText);

        // 4. 로딩 상태 SSE broadcast
        sessionStatusManager.setStatus(sessionId, "streaming");
        sseManager.broadcastToSession(sessionId, {
            type: "loading_start",
            sessionId
        });

        // 5. PTY stdin으로 답변 전송
        const success = claudeProcessManager.writeAnswer(sessionId, answerText);

        if (success) {
            // 6. DB에서 해당 질문을 제출 완료로 표시
            db.prepare(`
                UPDATE messages SET question_submitted = 1
                WHERE session_id = ? AND question_data IS NOT NULL AND question_submitted IS NULL
            `).run(sessionId);

            console.log("[TOOL RESULT] Answer sent to PTY stdin");
            res.json({ success: true });
        } else {
            console.log("[TOOL RESULT] No active PTY process");
            res.status(404).json({
                error: {
                    code: "NO_ACTIVE_PROCESS",
                    message: "No active PTY process for this session"
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

export default router;
