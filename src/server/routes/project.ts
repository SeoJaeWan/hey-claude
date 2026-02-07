import { Router, type Router as RouterType } from "express";
import { basename } from "path";
import { existsSync, readdirSync, readFileSync } from "fs";

const router: RouterType = Router();

// GET /api/project/path - 현재 프로젝트 경로
router.get("/path", async (_req, res) => {
    try {
        const projectPath = process.cwd();
        res.json({
            data: {
                path: projectPath,
            },
        });
    } catch (error) {
        console.error("Project path failed:", error);
        res.status(500).json({
            error: {
                code: "PROJECT_PATH_FAILED",
                message: error instanceof Error ? error.message : "Unknown error",
            },
        });
    }
});

// GET /api/project/info - 프로젝트 정보
router.get("/info", async (req, res) => {
    try {
        const { path } = req.query;

        if (!path) {
            return res.status(400).json({
                error: {
                    code: "INVALID_INPUT",
                    message: "path is required",
                },
            });
        }

        const projectPath = path as string;

        // 프로젝트 이름 (폴더명)
        const name = basename(projectPath);

        // package.json 정보
        let packageInfo = null;
        const packageJsonPath = `${projectPath}/package.json`;
        if (existsSync(packageJsonPath)) {
            try {
                const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
                packageInfo = {
                    name: packageJson.name,
                    version: packageJson.version,
                    description: packageJson.description,
                };
            } catch (error) {
                // package.json 파싱 실패
            }
        }

        res.json({
            data: {
                path: projectPath,
                name,
                package: packageInfo,
            },
        });
    } catch (error) {
        console.error("Project info failed:", error);
        res.status(500).json({
            error: {
                code: "PROJECT_INFO_FAILED",
                message: error instanceof Error ? error.message : "Unknown error",
            },
        });
    }
});

// GET /api/project/commands - 명령어 목록
router.get("/commands", async (req, res) => {
    try {
        const { path } = req.query;

        if (!path) {
            return res.status(400).json({
                error: {
                    code: "INVALID_INPUT",
                    message: "path is required",
                },
            });
        }

        const commandsPath = `${path}/.claude/commands`;
        
        if (!existsSync(commandsPath)) {
            return res.json({
                data: [],
            });
        }

        // .md 파일 목록 조회
        const files = readdirSync(commandsPath).filter((file) => file.endsWith(".md"));

        const commands = files.map((file) => {
            const filePath = `${commandsPath}/${file}`;
            const content = readFileSync(filePath, "utf-8");
            
            // 첫 줄에서 명령어 이름 추출 (# /명령어-이름)
            const firstLine = content.split("\n")[0];
            const match = firstLine.match(/^#\s*\/(.+)/);
            const commandName = match ? match[1].trim() : file.replace(".md", "");

            return {
                name: commandName,
                file,
                path: filePath,
            };
        });

        res.json({
            data: commands,
        });
    } catch (error) {
        console.error("Project commands failed:", error);
        res.status(500).json({
            error: {
                code: "PROJECT_COMMANDS_FAILED",
                message: error instanceof Error ? error.message : "Unknown error",
            },
        });
    }
});

export default router;
