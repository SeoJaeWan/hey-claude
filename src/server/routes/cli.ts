import { Router, type Router as RouterType } from "express";
import { detectCliTools } from "../services/cli-detector";
import { readConfig } from "../services/config";

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

export default router;
