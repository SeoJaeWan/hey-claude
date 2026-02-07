import { Router, type Router as RouterType } from "express";
import { getCachedCliTools } from "../services/cli-detector.js";
import { commandsCache } from "../index.js";

const router: RouterType = Router();

// GET /api/cli/status - CLI 도구 감지 (캐시 사용)
router.get("/status", async (_req, res) => {
    try {
        // 캐시된 CLI 도구 정보 반환
        const providers = getCachedCliTools();

        res.json({
            data: providers || [],
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

// GET /api/cli/commands - Claude 명령어 목록 (캐시 사용)
router.get("/commands", async (_req, res) => {
    try {
        // 캐시된 명령어 목록 반환
        res.json({
            data: commandsCache,
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
