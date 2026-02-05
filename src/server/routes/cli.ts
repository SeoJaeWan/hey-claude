import { Router, type Router as RouterType } from "express";
import { detectCliTools } from "../services/cli-detector.js";
import { readConfig } from "../services/config.js";
import { getAllCommands } from "../services/claude-commands-detector.js";

const router: RouterType = Router();

// GET /api/cli/status - CLI 도구 감지
router.get("/status", async (_req, res) => {
    try {
        // 프로젝트 경로 가져오기
        const projectPath = process.cwd();

        // config에서 API 키 가져오기
        const config = await readConfig(projectPath);
        const apiKeys = config.apiKeys || {};

        // CLI 도구 감지
        const providers = await detectCliTools(apiKeys);

        res.json({
            data: providers,
        });
    } catch (error) {
        console.error("CLI detection failed:", error);
        res.status(500).json({
            error: {
                code: "CLI_DETECTION_FAILED",
                message: error instanceof Error ? error.message : "Unknown error",
            },
        });
    }
});

// GET /api/cli/commands - Claude 명령어 목록 (로컬 + 빌트인)
router.get("/commands", async (_req, res) => {
    try {
        const projectPath = process.cwd();
        const commands = await getAllCommands(projectPath);

        res.json({
            data: commands,
        });
    } catch (error) {
        console.error("Commands detection failed:", error);
        // 에러 발생 시 빈 배열 반환
        res.json({
            data: [],
        });
    }
});

export default router;
