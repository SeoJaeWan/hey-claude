import { Router, type Router as RouterType } from "express";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

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

interface SnippetsFile {
    version: number;
    snippets: Snippet[];
}

const getSnippetsFilePath = (projectPath: string): string => {
    return join(projectPath, ".hey-claude", "snippets.json");
};

const readSnippets = (projectPath: string): Snippet[] => {
    const filePath = getSnippetsFilePath(projectPath);

    if (!existsSync(filePath)) {
        // .hey-claude 폴더 생성
        const heyClaudePath = join(projectPath, ".hey-claude");
        if (!existsSync(heyClaudePath)) {
            mkdirSync(heyClaudePath, { recursive: true });
        }

        // 기본 스니펫 파일 생성
        const defaultData: SnippetsFile = {
            version: 1,
            snippets: [],
        };
        writeFileSync(filePath, JSON.stringify(defaultData, null, 2), "utf-8");
        return [];
    }

    const data: SnippetsFile = JSON.parse(readFileSync(filePath, "utf-8"));
    return data.snippets || [];
};

const writeSnippets = (projectPath: string, snippets: Snippet[]): void => {
    const filePath = getSnippetsFilePath(projectPath);
    const data: SnippetsFile = {
        version: 1,
        snippets,
    };
    writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
};

// GET /api/snippets - 스니펫 목록 조회
router.get("/", async (req, res) => {
    try {
        const { projectPath } = req.query;

        if (!projectPath) {
            return res.status(400).json({
                error: {
                    code: "INVALID_INPUT",
                    message: "projectPath is required",
                },
            });
        }

        const snippets = readSnippets(projectPath as string);

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
        const { trigger, name, content, category, projectPath } = req.body;

        if (!trigger || !name || !content || !projectPath) {
            return res.status(400).json({
                error: {
                    code: "INVALID_INPUT",
                    message: "trigger, name, content, and projectPath are required",
                },
            });
        }

        const snippets = readSnippets(projectPath);

        // 중복 트리거 확인
        if (snippets.some((s) => s.trigger === trigger)) {
            return res.status(400).json({
                error: {
                    code: "DUPLICATE_TRIGGER",
                    message: "Trigger already exists",
                },
            });
        }

        const now = new Date().toISOString();
        const newSnippet: Snippet = {
            id: randomUUID(),
            trigger,
            name,
            content,
            category: category || "general",
            usageCount: 0,
            createdAt: now,
            updatedAt: now,
        };

        snippets.push(newSnippet);
        writeSnippets(projectPath, snippets);

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
        const { trigger, name, content, category, projectPath } = req.body;

        if (!projectPath) {
            return res.status(400).json({
                error: {
                    code: "INVALID_INPUT",
                    message: "projectPath is required",
                },
            });
        }

        const snippets = readSnippets(projectPath);
        const index = snippets.findIndex((s) => s.id === id);

        if (index === -1) {
            return res.status(404).json({
                error: {
                    code: "SNIPPET_NOT_FOUND",
                    message: "Snippet not found",
                },
            });
        }

        // 트리거 변경 시 중복 확인
        if (trigger && trigger !== snippets[index].trigger) {
            if (snippets.some((s) => s.trigger === trigger)) {
                return res.status(400).json({
                    error: {
                        code: "DUPLICATE_TRIGGER",
                        message: "Trigger already exists",
                    },
                });
            }
        }

        // 업데이트
        snippets[index] = {
            ...snippets[index],
            trigger: trigger || snippets[index].trigger,
            name: name || snippets[index].name,
            content: content !== undefined ? content : snippets[index].content,
            category: category || snippets[index].category,
            updatedAt: new Date().toISOString(),
        };

        writeSnippets(projectPath, snippets);

        res.json({
            data: snippets[index],
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
        const { projectPath } = req.query;

        if (!projectPath) {
            return res.status(400).json({
                error: {
                    code: "INVALID_INPUT",
                    message: "projectPath is required",
                },
            });
        }

        const snippets = readSnippets(projectPath as string);
        const index = snippets.findIndex((s) => s.id === id);

        if (index === -1) {
            return res.status(404).json({
                error: {
                    code: "SNIPPET_NOT_FOUND",
                    message: "Snippet not found",
                },
            });
        }

        snippets.splice(index, 1);
        writeSnippets(projectPath as string, snippets);

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
