import { Router, type Router as RouterType } from "express";
import { getDatabase } from "../services/database.js";
import { randomUUID } from "crypto";
import { compressToolUsage } from "../services/compression.js";
import sseManager from "../services/sseManager.js";
import { buildMessageFromToolUse } from "../services/messageBuilder.js";

const router: RouterType = Router();

// POST /api/hooks/session - SessionStart Hook
interface SessionHookRequest {
    sessionId: string;
    projectPath: string;
    source: 'startup' | 'resume' | 'clear' | 'compact';
    model: string;
}

router.post("/session", async (req, res) => {
    try {
        const { sessionId, projectPath, source, model } = req.body as SessionHookRequest;

        console.log("[HOOKS] SessionStart received:", { sessionId, projectPath, source, model });

        if (!sessionId || !projectPath) {
            return res.json({ success: true });
        }

        const db = getDatabase();

        // 세션이 이미 존재하는지 확인
        const existingSession = db.prepare("SELECT id FROM sessions WHERE claude_session_id = ?").get(sessionId);

        if (existingSession) {
            // 기존 세션 업데이트
            db.prepare(`
                UPDATE sessions
                SET updated_at = ?, source = ?
                WHERE claude_session_id = ?
            `).run(new Date().toISOString(), source === 'resume' ? 'terminal' : 'web', sessionId);

            console.log(`[HOOKS] SessionStart: Updated existing session ${sessionId}`);
        } else {
            // 새 세션 생성
            const newSessionId = randomUUID();
            const now = new Date().toISOString();

            db.prepare(`
                INSERT INTO sessions (id, type, claude_session_id, model, project_path, source, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                newSessionId,
                "claude-code",
                sessionId,
                model || null,
                projectPath,
                source === 'resume' ? 'terminal' : 'web',
                "active",
                now,
                now
            );

            console.log(`[HOOKS] SessionStart: Created new session ${newSessionId} for claude_session_id ${sessionId}`);
        }

        res.json({ success: true });
    } catch (error) {
        console.error("[HOOKS] SessionStart error:", error);
        res.json({ success: true }); // 에러가 발생해도 Claude Code를 막으면 안 됨
    }
});

// POST /api/hooks/tool-use - PreToolUse/PostToolUse Hook
interface ToolUseHookRequest {
    type: 'pre' | 'post';
    sessionId?: string;
    projectPath?: string;
    toolUseId?: string;
    toolName: string;
    toolInput: any;
    toolOutput?: any;  // post only
}

router.post("/tool-use", async (req, res) => {
    try {
        // PreToolUse와 PostToolUse 모두 처리
        const { type, sessionId, projectPath, toolUseId, toolName, toolInput, toolOutput } = req.body as ToolUseHookRequest;

        // 기존 PostToolUse hook 형식 (session_id, cwd, tool_name 등)도 지원
        const claudeSessionId = sessionId || req.body.session_id;
        const cwd = projectPath || req.body.cwd;
        const tool_name = toolName || req.body.tool_name;
        const tool_input = toolInput || req.body.tool_input;
        const tool_response = toolOutput || req.body.tool_response;

        console.log("[HOOKS] ToolUse received:", { type, claudeSessionId, toolName: tool_name, toolUseId });

        if (!claudeSessionId || !cwd || !tool_name) {
            return res.json({
                continue: true,
                suppressOutput: true,
            });
        }

        const db = getDatabase();

        // 세션이 존재하는지 확인
        const session = db.prepare("SELECT id FROM sessions WHERE claude_session_id = ?").get(claudeSessionId);

        let internalSessionId: string;

        if (!session) {
            // 터미널에서 생성된 세션 - 새로 등록
            internalSessionId = randomUUID();
            const now = new Date().toISOString();

            db.prepare(`
                INSERT INTO sessions (id, type, claude_session_id, project_path, source, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(internalSessionId, "claude-code", claudeSessionId, cwd, "terminal", "active", now, now);
        } else {
            internalSessionId = (session as { id: string }).id;
        }

        // PreToolUse: AskUserQuestion 감지 시 SSE로 프론트엔드에 전달
        if (type === 'pre' && tool_name === 'AskUserQuestion' && tool_input?.questions) {
            console.log("[HOOKS] AskUserQuestion detected, broadcasting to frontend via SSE");

            sseManager.broadcastToSession(internalSessionId, {
                type: "ask_user_question",
                sessionId: internalSessionId,
                toolUseId: toolUseId,
                questions: tool_input.questions
            });
        }

        // PostToolUse: 도구 사용 내역 저장
        if (type === 'post' || !type) {
            const now = new Date().toISOString();
            const result = db.prepare(`
                INSERT INTO tool_usages (session_id, tool_name, tool_input, tool_output, timestamp)
                VALUES (?, ?, ?, ?, ?)
            `).run(
                internalSessionId,
                tool_name,
                JSON.stringify(tool_input || {}),
                JSON.stringify(tool_response || {}),
                now
            );

            const toolUsageId = result.lastInsertRowid;

            // 세션 업데이트 시간 갱신
            db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(now, internalSessionId);

            console.log(`[HOOKS] Tool use saved: ${tool_name} in session ${internalSessionId}`);

            // Convert tool usage to message format
            const messageContent = buildMessageFromToolUse({
                sessionId: internalSessionId,
                toolName: tool_name,
                toolInput: tool_input || {},
                toolOutput: tool_response || {}
            });

            // Save message to database
            const messageId = randomUUID();
            db.prepare(`
                INSERT INTO messages (id, session_id, role, content, timestamp)
                VALUES (?, ?, ?, ?, ?)
            `).run(
                messageId,
                internalSessionId,
                messageContent.role,
                messageContent.content,
                now
            );

            console.log(`[HOOKS] Message created from tool use: ${messageId}`);

            // Broadcast to frontend via SSE
            sseManager.broadcastToSession(internalSessionId, {
                type: "tool_use_message",
                sessionId: internalSessionId,
                message: {
                    id: messageId,
                    sessionId: internalSessionId,
                    role: messageContent.role,
                    content: messageContent.content,
                    toolUsages: messageContent.toolUsages,
                    createdAt: now
                }
            });

            console.log(`[HOOKS] SSE broadcast: tool_use_message for session ${internalSessionId}`);

            // 비동기로 압축 수행 (응답 지연 방지)
            compressToolUsage(cwd, {
                toolName: tool_name,
                toolInput: tool_input || {},
                toolOutput: tool_response || {},
            })
                .then((compression) => {
                    if (compression) {
                        db.prepare(`
                            UPDATE tool_usages
                            SET compressed_type = ?, compressed_title = ?, compressed_content = ?, compressed_at = ?
                            WHERE id = ?
                        `).run(
                            compression.type,
                            compression.title,
                            compression.content,
                            new Date().toISOString(),
                            toolUsageId
                        );
                        console.log(`[HOOKS] Compression saved for tool usage ${toolUsageId}`);
                    }
                })
                .catch((error) => {
                    console.error("[HOOKS] Compression failed:", error);
                });
        }

        res.json({
            continue: true,
            suppressOutput: true,
        });
    } catch (error) {
        console.error("[HOOKS] Tool use hook error:", error);
        res.json({
            continue: true,
            suppressOutput: true,
        });
    }
});

// POST /api/hooks/stop - Stop hook (수집)
router.post("/stop", async (req, res) => {
    try {
        const { session_id } = req.body;

        if (!session_id) {
            return res.json({ status: "ok" });
        }

        const db = getDatabase();

        // 세션 상태를 'completed'로 변경
        db.prepare(`
            UPDATE sessions
            SET status = 'completed', updated_at = ?
            WHERE claude_session_id = ?
        `).run(new Date().toISOString(), session_id);

        console.log(`Session stopped: ${session_id}`);

        res.json({ status: "ok" });
    } catch (error) {
        console.error("Stop hook error:", error);
        res.json({ status: "error" });
    }
});

export default router;
