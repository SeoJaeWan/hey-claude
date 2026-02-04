import { Router, type Router as RouterType } from "express";
import { randomUUID } from "crypto";
import { callClaude } from "../services/claude.js";
import { getRecentContext } from "../services/context.js";
import { getDatabase } from "../services/database.js";

const router: RouterType = Router();

// POST /api/chat/stream - SSE 스트리밍
router.post("/stream", async (req, res) => {
    try {
        const { sessionId, prompt, images } = req.body;

        if (!sessionId || !prompt) {
            res.status(400).json({
                error: {
                    code: "MISSING_PARAMETERS",
                    message: "sessionId and prompt are required",
                },
            });
            return;
        }

        // SSE 헤더 설정
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        const db = getDatabase();
        const projectPath = process.cwd();

        // 세션 조회
        const session = db
            .prepare("SELECT * FROM sessions WHERE id = ?")
            .get(sessionId) as any;

        if (!session) {
            res.write(
                `data: ${JSON.stringify({ type: "error", error: "Session not found" })}\n\n`
            );
            res.end();
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

        // Claude CLI 호출
        const claude = callClaude({
            prompt: finalPrompt,
            sessionId: session.claude_session_id,
            cwd: projectPath,
        });

        let assistantResponse = "";
        let claudeSessionId = session.claude_session_id;

        // stdout 스트리밍
        claude.stdout?.on("data", (data) => {
            const chunk = data.toString();
            assistantResponse += chunk;

            // Claude Code 세션 ID 추출
            const sessionMatch = chunk.match(/session_id['"]\s*:\s*['"]([^'"]+)['"]/);
            if (sessionMatch) {
                claudeSessionId = sessionMatch[1];
            }

            res.write(`data: ${JSON.stringify({ type: "chunk", content: chunk })}\n\n`);
        });

        // stderr 스트리밍
        claude.stderr?.on("data", (data) => {
            res.write(
                `data: ${JSON.stringify({ type: "error", content: data.toString() })}\n\n`
            );
        });

        // 종료 시 assistant 메시지 저장
        claude.on("close", (code) => {
            if (code === 0 && assistantResponse) {
                const assistantMessageId = randomUUID();
                db.prepare(
                    `INSERT INTO messages (id, session_id, role, content, timestamp)
                     VALUES (?, ?, ?, ?, ?)`
                ).run(
                    assistantMessageId,
                    sessionId,
                    "assistant",
                    assistantResponse,
                    new Date().toISOString()
                );

                // Claude 세션 ID 업데이트
                if (claudeSessionId && claudeSessionId !== session.claude_session_id) {
                    db.prepare(
                        "UPDATE sessions SET claude_session_id = ?, updated_at = ? WHERE id = ?"
                    ).run(claudeSessionId, new Date().toISOString(), sessionId);
                }
            }

            res.write(`data: ${JSON.stringify({ type: "done", code })}\n\n`);
            res.end();
        });

        // 클라이언트 연결 종료 시
        req.on("close", () => {
            claude.kill();
        });
    } catch (error) {
        res.write(
            `data: ${JSON.stringify({
                type: "error",
                error: error instanceof Error ? error.message : "Unknown error",
            })}\n\n`
        );
        res.end();
    }
});

// POST /api/chat/send - fallback (non-streaming)
router.post("/send", async (req, res) => {
    try {
        const { sessionId, prompt, images } = req.body;

        if (!sessionId || !prompt) {
            res.status(400).json({
                error: {
                    code: "MISSING_PARAMETERS",
                    message: "sessionId and prompt are required",
                },
            });
            return;
        }

        const db = getDatabase();
        const projectPath = process.cwd();

        // 세션 조회
        const session = db
            .prepare("SELECT * FROM sessions WHERE id = ?")
            .get(sessionId) as any;

        if (!session) {
            res.status(404).json({
                error: {
                    code: "SESSION_NOT_FOUND",
                    message: "Session not found",
                },
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

        // Claude CLI 호출
        const claude = callClaude({
            prompt: finalPrompt,
            sessionId: session.claude_session_id,
            cwd: projectPath,
        });

        let assistantResponse = "";
        let claudeSessionId = session.claude_session_id;

        claude.stdout?.on("data", (data) => {
            const chunk = data.toString();
            assistantResponse += chunk;

            const sessionMatch = chunk.match(/session_id['"]\s*:\s*['"]([^'"]+)['"]/);
            if (sessionMatch) {
                claudeSessionId = sessionMatch[1];
            }
        });

        claude.on("close", (code) => {
            if (code === 0 && assistantResponse) {
                const assistantMessageId = randomUUID();
                db.prepare(
                    `INSERT INTO messages (id, session_id, role, content, timestamp)
                     VALUES (?, ?, ?, ?, ?)`
                ).run(
                    assistantMessageId,
                    sessionId,
                    "assistant",
                    assistantResponse,
                    new Date().toISOString()
                );

                if (claudeSessionId && claudeSessionId !== session.claude_session_id) {
                    db.prepare(
                        "UPDATE sessions SET claude_session_id = ?, updated_at = ? WHERE id = ?"
                    ).run(claudeSessionId, new Date().toISOString(), sessionId);
                }

                res.json({
                    data: {
                        response: assistantResponse,
                    },
                });
            } else {
                res.status(500).json({
                    error: {
                        code: "CLAUDE_CLI_FAILED",
                        message: `Claude CLI exited with code ${code}`,
                    },
                });
            }
        });
    } catch (error) {
        res.status(500).json({
            error: {
                code: "CHAT_SEND_FAILED",
                message: error instanceof Error ? error.message : "Unknown error",
            },
        });
    }
});

export default router;
