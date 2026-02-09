import { Router, type Router as RouterType } from "express";
import { randomUUID } from "crypto";
import { getDatabase } from "../services/database.js";

const router: RouterType = Router();

interface Snippet {
    id: string;
    trigger: string;
    name: string;
    content: string;
    category: string;
    usageCount: number;
    createdAt: string;
    updatedAt: string;
}

interface SnippetRow {
    id: string;
    trigger: string;
    name: string;
    content: string;
    category: string;
    usage_count: number;
    created_at: string;
    updated_at: string;
}

const rowToSnippet = (row: SnippetRow): Snippet => ({
    id: row.id,
    trigger: row.trigger,
    name: row.name,
    content: row.content,
    category: row.category,
    usageCount: row.usage_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
});

// GET /api/snippets - 스니펫 목록 조회
router.get("/", async (_req, res) => {
    try {
        const db = getDatabase();
        const rows = db.prepare("SELECT * FROM snippets ORDER BY created_at DESC").all() as SnippetRow[];
        const snippets = rows.map(rowToSnippet);

        res.json({
            data: snippets,
        });
    } catch (error) {
        console.error("Snippet list failed:", error);
        res.status(500).json({
            error: {
                code: "SNIPPET_LIST_FAILED",
                message: error instanceof Error ? error.message : "Unknown error",
            },
        });
    }
});

// POST /api/snippets - 스니펫 생성
router.post("/", async (req, res) => {
    try {
        const { trigger, name, content, category } = req.body;

        if (!trigger || !name || !content) {
            return res.status(400).json({
                error: {
                    code: "INVALID_INPUT",
                    message: "trigger, name, and content are required",
                },
            });
        }

        const db = getDatabase();

        // 중복 트리거 확인
        const existing = db.prepare("SELECT id FROM snippets WHERE trigger = ?").get(trigger);
        if (existing) {
            return res.status(400).json({
                error: {
                    code: "DUPLICATE_TRIGGER",
                    message: "Trigger already exists",
                },
            });
        }

        const now = new Date().toISOString();
        const id = randomUUID();

        db.prepare(`
            INSERT INTO snippets (id, trigger, name, content, category, usage_count, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, trigger, name, content, category || "general", 0, now, now);

        const newSnippet: Snippet = {
            id,
            trigger,
            name,
            content,
            category: category || "general",
            usageCount: 0,
            createdAt: now,
            updatedAt: now,
        };

        res.status(201).json({
            data: newSnippet,
        });
    } catch (error) {
        console.error("Snippet create failed:", error);
        res.status(500).json({
            error: {
                code: "SNIPPET_CREATE_FAILED",
                message: error instanceof Error ? error.message : "Unknown error",
            },
        });
    }
});

// PATCH /api/snippets/:id - 스니펫 수정
router.patch("/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const { trigger, name, content, category } = req.body;

        const db = getDatabase();

        // 기존 스니펫 조회
        const existingRow = db.prepare("SELECT * FROM snippets WHERE id = ?").get(id) as SnippetRow | undefined;

        if (!existingRow) {
            return res.status(404).json({
                error: {
                    code: "SNIPPET_NOT_FOUND",
                    message: "Snippet not found",
                },
            });
        }

        // 트리거 변경 시 중복 확인
        if (trigger && trigger !== existingRow.trigger) {
            const duplicate = db.prepare("SELECT id FROM snippets WHERE trigger = ? AND id != ?").get(trigger, id);
            if (duplicate) {
                return res.status(400).json({
                    error: {
                        code: "DUPLICATE_TRIGGER",
                        message: "Trigger already exists",
                    },
                });
            }
        }

        const now = new Date().toISOString();
        const updatedTrigger = trigger || existingRow.trigger;
        const updatedName = name || existingRow.name;
        const updatedContent = content !== undefined ? content : existingRow.content;
        const updatedCategory = category || existingRow.category;

        // 업데이트
        db.prepare(`
            UPDATE snippets
            SET trigger = ?, name = ?, content = ?, category = ?, updated_at = ?
            WHERE id = ?
        `).run(updatedTrigger, updatedName, updatedContent, updatedCategory, now, id);

        const updatedSnippet: Snippet = {
            id: existingRow.id,
            trigger: updatedTrigger,
            name: updatedName,
            content: updatedContent,
            category: updatedCategory,
            usageCount: existingRow.usage_count,
            createdAt: existingRow.created_at,
            updatedAt: now,
        };

        res.json({
            data: updatedSnippet,
        });
    } catch (error) {
        console.error("Snippet update failed:", error);
        res.status(500).json({
            error: {
                code: "SNIPPET_UPDATE_FAILED",
                message: error instanceof Error ? error.message : "Unknown error",
            },
        });
    }
});

// DELETE /api/snippets/:id - 스니펫 삭제
router.delete("/:id", async (req, res) => {
    try {
        const { id } = req.params;

        const db = getDatabase();

        // 존재 확인
        const existing = db.prepare("SELECT id FROM snippets WHERE id = ?").get(id);

        if (!existing) {
            return res.status(404).json({
                error: {
                    code: "SNIPPET_NOT_FOUND",
                    message: "Snippet not found",
                },
            });
        }

        // 삭제
        db.prepare("DELETE FROM snippets WHERE id = ?").run(id);

        res.json({
            data: { deleted: true },
        });
    } catch (error) {
        console.error("Snippet delete failed:", error);
        res.status(500).json({
            error: {
                code: "SNIPPET_DELETE_FAILED",
                message: error instanceof Error ? error.message : "Unknown error",
            },
        });
    }
});

export default router;
