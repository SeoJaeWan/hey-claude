import { Router, type Router as RouterType } from "express";
import { getDatabase } from "../services/database.js";
import { randomUUID } from "crypto";
import sessionStatusManager from "../services/sessionStatusManager.js";

const router: RouterType = Router();

// GET /api/sessions - 세션 목록 조회
router.get("/", async (req, res) => {
    try {
        const { projectPath } = req.query;
        const db = getDatabase();

        let query = "SELECT * FROM sessions";
        const params: string[] = [];

        if (projectPath) {
            query += " WHERE project_path = ?";
            params.push(projectPath as string);
        }

        query += " ORDER BY updated_at DESC";

        const sessions = db.prepare(query).all(...params) as any[];

        // Attach current status to each session
        const sessionsWithStatus = sessions.map(session => {
            const status = sessionStatusManager.getStatus(session.id);
            return {
                ...session,
                currentStatus: status?.status || "idle",
                backgroundTasksCount: status?.backgroundTasksCount || 0
            };
        });

        res.json({
            data: sessionsWithStatus,
            total: sessionsWithStatus.length,
        });
    } catch (error) {
        console.error("Session list failed:", error);
        res.status(500).json({
            error: {
                code: "SESSION_LIST_FAILED",
                message: error instanceof Error ? error.message : "Unknown error",
            },
        });
    }
});

// POST /api/sessions - 세션 생성
router.post("/", async (req, res) => {
    try {
        const { type, name, projectPath, model } = req.body;

        if (!type || !projectPath) {
            return res.status(400).json({
                error: {
                    code: "INVALID_INPUT",
                    message: "type and projectPath are required",
                },
            });
        }

        const db = getDatabase();
        const id = randomUUID();
        const now = new Date().toISOString();

        db.prepare(`
            INSERT INTO sessions (id, type, model, name, project_path, source, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, type, model || null, name || null, projectPath, "web", "active", now, now);

        const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);

        res.status(201).json({
            data: session,
        });
    } catch (error) {
        console.error("Session create failed:", error);
        res.status(500).json({
            error: {
                code: "SESSION_CREATE_FAILED",
                message: error instanceof Error ? error.message : "Unknown error",
            },
        });
    }
});

// GET /api/sessions/:id - 세션 조회 (메시지 제외)
router.get("/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const db = getDatabase();

        const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);

        if (!session) {
            return res.status(404).json({
                error: {
                    code: "SESSION_NOT_FOUND",
                    message: "Session not found",
                },
            });
        }

        // 실시간 상태 포함
        const status = sessionStatusManager.getStatus(id);

        res.json({
            data: {
                ...session,
                currentStatus: status?.status || "idle",
                backgroundTasksCount: status?.backgroundTasksCount || 0,
            },
        });
    } catch (error) {
        console.error("Session get failed:", error);
        res.status(500).json({
            error: {
                code: "SESSION_GET_FAILED",
                message: error instanceof Error ? error.message : "Unknown error",
            },
        });
    }
});

// GET /api/sessions/:id/messages - 메시지 페이지네이션
router.get("/:id/messages", async (req, res) => {
    try {
        const { id } = req.params;
        const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
        const before = req.query.before as string | undefined;

        const db = getDatabase();

        let messages;
        if (before) {
            // 이전 메시지 로드 (커서 기반)
            messages = db.prepare(
                "SELECT * FROM messages WHERE session_id = ? AND timestamp < ? ORDER BY timestamp DESC LIMIT ?"
            ).all(id, before, limit);
        } else {
            // 최신 메시지 로드 (첫 요청)
            messages = db.prepare(
                "SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp DESC LIMIT ?"
            ).all(id, limit);
        }

        // DESC로 가져왔으므로 ASC 순서로 뒤집기
        messages.reverse();

        const hasMore = messages.length === limit;

        res.json({
            data: messages,
            hasMore,
        });
    } catch (error) {
        console.error("Messages fetch failed:", error);
        res.status(500).json({
            error: {
                code: "MESSAGES_FETCH_FAILED",
                message: error instanceof Error ? error.message : "Unknown error",
            },
        });
    }
});

// PATCH /api/sessions/:id - 세션 수정
router.patch("/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const { name } = req.body;

        const db = getDatabase();

        // 세션 존재 확인
        const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);

        if (!session) {
            return res.status(404).json({
                error: {
                    code: "SESSION_NOT_FOUND",
                    message: "Session not found",
                },
            });
        }

        const now = new Date().toISOString();

        // 이름 업데이트
        db.prepare(`
            UPDATE sessions
            SET name = ?, updated_at = ?
            WHERE id = ?
        `).run(name || null, now, id);

        const updatedSession = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);

        res.json({
            data: updatedSession,
        });
    } catch (error) {
        console.error("Session update failed:", error);
        res.status(500).json({
            error: {
                code: "SESSION_UPDATE_FAILED",
                message: error instanceof Error ? error.message : "Unknown error",
            },
        });
    }
});

// DELETE /api/sessions/:id - 세션 삭제
router.delete("/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const db = getDatabase();

        // 세션 존재 확인
        const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);

        if (!session) {
            return res.status(404).json({
                error: {
                    code: "SESSION_NOT_FOUND",
                    message: "Session not found",
                },
            });
        }

        // CASCADE로 관련 데이터 자동 삭제됨
        db.prepare("DELETE FROM sessions WHERE id = ?").run(id);

        res.json({
            data: { deleted: true },
        });
    } catch (error) {
        console.error("Session delete failed:", error);
        res.status(500).json({
            error: {
                code: "SESSION_DELETE_FAILED",
                message: error instanceof Error ? error.message : "Unknown error",
            },
        });
    }
});

// GET /api/sessions/statuses - 모든 세션 상태 조회
router.get("/statuses", async (_req, res) => {
    try {
        const allStatuses = sessionStatusManager.getAllStatuses();

        res.json({
            data: allStatuses,
            total: allStatuses.length,
        });
    } catch (error) {
        console.error("Session statuses failed:", error);
        res.status(500).json({
            error: {
                code: "SESSION_STATUSES_FAILED",
                message: error instanceof Error ? error.message : "Unknown error",
            },
        });
    }
});

export default router;
