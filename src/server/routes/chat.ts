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
        console.log("[CHAT STREAM] Request received:", { sessionId, prompt: prompt?.substring(0, 50) });

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
        console.log("[CHAT STREAM] SSE headers set");

        const db = getDatabase();
        const projectPath = process.cwd();

        // 세션 조회
        const session = db
            .prepare("SELECT * FROM sessions WHERE id = ?")
            .get(sessionId) as any;

        if (!session) {
            console.log("[CHAT STREAM] Session not found:", sessionId);
            res.write(
                `data: ${JSON.stringify({ type: "error", error: "Session not found" })}\n\n`
            );
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

        // Claude CLI 호출
        console.log("[CHAT STREAM] Calling Claude CLI with:", {
            sessionId: session.claude_session_id,
            cwd: projectPath
        });
        const claude = callClaude({
            prompt: finalPrompt,
            sessionId: session.claude_session_id,
            cwd: projectPath,
        });

        let assistantResponse = "";
        let claudeSessionId = session.claude_session_id;
        let buffer = "";

        // stdout 스트리밍
        claude.stdout?.on("data", (data) => {
            const chunk = data.toString();
            console.log("[CHAT STREAM] stdout chunk received, length:", chunk.length);

            buffer += chunk;
            const lines = buffer.split("\n");

            // 마지막 불완전한 라인은 버퍼에 남겨둠
            buffer = lines.pop() || "";

            for (const line of lines) {
                if (!line.trim()) continue;

                try {
                    const parsed = JSON.parse(line);

                    // Claude Code 세션 ID 추출
                    if (parsed.session_id) {
                        claudeSessionId = parsed.session_id;
                        console.log("[CHAT STREAM] Claude session ID extracted:", claudeSessionId);
                    }

                    // type: "assistant" 메시지에서 실제 텍스트 추출
                    if (parsed.type === "assistant" && parsed.message?.content) {
                        for (const contentBlock of parsed.message.content) {
                            if (contentBlock.type === "text" && contentBlock.text) {
                                const text = contentBlock.text;
                                assistantResponse += text;
                                res.write(`data: ${JSON.stringify({ type: "chunk", content: text })}\n\n`);
                                console.log("[CHAT STREAM] Extracted text, length:", text.length);
                            }
                        }
                    }

                    // type: "result"에서 최종 응답 추출 (fallback)
                    else if (parsed.type === "result" && parsed.result && !assistantResponse) {
                        assistantResponse = parsed.result;
                        res.write(`data: ${JSON.stringify({ type: "chunk", content: parsed.result })}\n\n`);
                        console.log("[CHAT STREAM] Extracted result text, length:", parsed.result.length);
                    }
                } catch (e) {
                    console.log("[CHAT STREAM] Failed to parse JSON line:", line.substring(0, 100));
                }
            }
        });

        // stderr 스트리밍
        claude.stderr?.on("data", (data) => {
            const error = data.toString();
            console.log("[CHAT STREAM] stderr received:", error);
            res.write(
                `data: ${JSON.stringify({ type: "error", content: error })}\n\n`
            );
        });

        // 종료 시 assistant 메시지 저장
        claude.on("close", (code) => {
            console.log("[CHAT STREAM] Claude process closed with code:", code);
            console.log("[CHAT STREAM] Response length:", assistantResponse.length);

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
                    console.log("[CHAT STREAM] Updating session with new claude_session_id:", claudeSessionId);
                    db.prepare(
                        "UPDATE sessions SET claude_session_id = ?, updated_at = ? WHERE id = ?"
                    ).run(claudeSessionId, new Date().toISOString(), sessionId);
                }
            }

            res.write(`data: ${JSON.stringify({ type: "done", code })}\n\n`);
            res.end();
        });

        // 에러 핸들링
        claude.on("error", (error) => {
            console.log("[CHAT STREAM] Claude process error:", error);
            res.write(
                `data: ${JSON.stringify({ type: "error", error: error.message })}\n\n`
            );
            res.end();
        });

        // 클라이언트 연결 종료 시
        req.on("close", () => {
            console.log("[CHAT STREAM] Client connection closed, killing claude process");
            claude.kill();
        });
    } catch (error) {
        console.log("[CHAT STREAM] Exception caught:", error);
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
