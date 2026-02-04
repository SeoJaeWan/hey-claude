import { Router, type Router as RouterType } from "express";
import { readConfig, updateConfig, type Config } from "../services/config.js";

const router: RouterType = Router();

// GET /api/settings - 설정 조회
router.get("/", async (_req, res) => {
    try {
        const projectPath = process.cwd();
        const config = await readConfig(projectPath);

        res.json({
            data: config,
        });
    } catch (error) {
        console.error("Settings read failed:", error);
        res.status(500).json({
            error: {
                code: "SETTINGS_READ_FAILED",
                message: error instanceof Error ? error.message : "Unknown error",
            },
        });
    }
});

// PATCH /api/settings - 설정 부분 업데이트
router.patch("/", async (req, res) => {
    try {
        const projectPath = process.cwd();
        const updates = req.body as Partial<Config>;

        // 유효성 검사
        if (updates.theme && !["system", "dark", "light"].includes(updates.theme)) {
            return res.status(400).json({
                error: {
                    code: "INVALID_INPUT",
                    message: "Invalid theme value",
                },
            });
        }

        // 설정 업데이트
        const updatedConfig = await updateConfig(projectPath, updates);

        res.json({
            data: updatedConfig,
        });
    } catch (error) {
        console.error("Settings update failed:", error);
        res.status(500).json({
            error: {
                code: "SETTINGS_UPDATE_FAILED",
                message: error instanceof Error ? error.message : "Unknown error",
            },
        });
    }
});

export default router;
