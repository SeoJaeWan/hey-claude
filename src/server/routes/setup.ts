import { Router, type Router as RouterType } from "express";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { execSync } from "child_process";

const router: RouterType = Router();

/**
 * Claude Code CLI 설치 여부를 확인합니다.
 */
const checkClaudeCode = (): { installed: boolean; version?: string } => {
    try {
        // ~/.claude 디렉토리 확인
        const homeDir = homedir();
        const claudeDir = join(homeDir, ".claude");

        if (!existsSync(claudeDir)) {
            return { installed: false };
        }

        // claude --version 명령어로 버전 확인 시도
        try {
            const output = execSync("claude --version", {
                encoding: "utf-8",
                stdio: ["pipe", "pipe", "pipe"],
                timeout: 3000,
            }).trim();

            // 버전 정보 추출 (예: "1.0.0" 형식)
            const versionMatch = output.match(/(\d+\.\d+\.\d+)/);
            const version = versionMatch ? versionMatch[1] : undefined;

            return { installed: true, version };
        } catch {
            // 명령어 실패해도 디렉토리가 있으면 설치된 것으로 간주
            return { installed: true };
        }
    } catch (error) {
        console.error("Claude Code check error:", error);
        return { installed: false };
    }
};

/**
 * Claude Code Plugin 설치 여부를 확인합니다.
 */
const checkClaudeCodePlugin = (): { installed: boolean; version?: string } => {
    try {
        const homeDir = homedir();
        const pluginPath = join(homeDir, ".claude", "plugins");

        const possiblePaths = [
            join(pluginPath, "marketplaces", "hey-claude", "hooks", "hooks.json"),
            join(pluginPath, "hey-claude", "hooks", "hooks.json"),
        ];

        for (const path of possiblePaths) {
            if (existsSync(path)) {
                // plugin.json에서 버전 정보 읽기 시도
                const pluginJsonPath = path.replace("hooks/hooks.json", ".claude-plugin/plugin.json");
                if (existsSync(pluginJsonPath)) {
                    const pluginJson = JSON.parse(readFileSync(pluginJsonPath, "utf-8"));
                    return { installed: true, version: pluginJson.version };
                }
                return { installed: true };
            }
        }

        return { installed: false };
    } catch (error) {
        console.error("Plugin check error:", error);
        return { installed: false };
    }
};

// GET /api/setup/status - Claude Code 및 Plugin 설치 상태 확인
router.get("/status", async (_req, res) => {
    try {
        const claudeCode = checkClaudeCode();
        const plugin = checkClaudeCodePlugin();

        res.json({
            data: {
                claudeCode,
                plugin,
            },
        });
    } catch (error) {
        console.error("Setup status check failed:", error);
        res.status(500).json({
            error: {
                code: "SETUP_CHECK_FAILED",
                message: error instanceof Error ? error.message : "Unknown error",
            },
        });
    }
});

export default router;
