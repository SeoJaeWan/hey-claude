import { Router, type Router as RouterType } from "express";
import { getDatabase } from "../services/database.js";
import { randomUUID } from "crypto";
import { compressToolUsage } from "../services/compression.js";

const router: RouterType = Router();

// POST /api/hooks/tool-use - PostToolUse hook (수집)
router.post("/tool-use", async (req, res) => {
    try {
        const { session_id, cwd, tool_name, tool_input, tool_response } = req.body;

        if (!session_id || !cwd || !tool_name) {
            return res.json({
                continue: true,
                suppressOutput: true,
            });
        }

        const db = getDatabase();

        // 세션이 존재하는지 확인
        const session = db.prepare("SELECT id FROM sessions WHERE claude_session_id = ?").get(session_id);

        let sessionId: string;

        if (!session) {
            // 터미널에서 생성된 세션 - 새로 등록
            sessionId = randomUUID();
            const now = new Date().toISOString();

            db.prepare(`
                INSERT INTO sessions (id, type, claude_session_id, project_path, source, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(sessionId, "claude-code", session_id, cwd, "terminal", "active", now, now);
        } else {
            sessionId = (session as { id: string }).id;
        }

        // 도구 사용 내역 저장
        const now = new Date().toISOString();
        const result = db.prepare(`
            INSERT INTO tool_usages (session_id, tool_name, tool_input, tool_output, timestamp)
            VALUES (?, ?, ?, ?, ?)
        `).run(
            sessionId,
            tool_name,
            JSON.stringify(tool_input || {}),
            JSON.stringify(tool_response || {}),
            now
        );

        const toolUsageId = result.lastInsertRowid;

        // 세션 업데이트 시간 갱신
        db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(now, sessionId);

        console.log(`Tool use saved: ${tool_name} in session ${sessionId}`);

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
                    console.log(`Compression saved for tool usage ${toolUsageId}`);
                }
            })
            .catch((error) => {
                console.error("Compression failed:", error);
            });

        res.json({
            continue: true,
            suppressOutput: true,
        });
    } catch (error) {
        console.error("Tool use hook error:", error);
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
