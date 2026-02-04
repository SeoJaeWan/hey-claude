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
 * installed_plugins.json 파일을 파싱하여 hey-claude 플러그인이 설치되어 있는지 확인합니다.
 *
 * 지원하는 플러그인 키 형식:
 * - hey-claude@hey-claude-marketplace (기본)
 * - hey-claude@npm (npm registry)
 * - hey-claude@* (기타 마켓플레이스)
 */
const checkClaudeCodePlugin = (): { installed: boolean; version?: string } => {
    try {
        const homeDir = homedir();
        const installedPluginsPath = join(homeDir, ".claude", "plugins", "installed_plugins.json");

        if (!existsSync(installedPluginsPath)) {
            console.log("installed_plugins.json not found at:", installedPluginsPath);
            return { installed: false };
        }

        const fileContent = readFileSync(installedPluginsPath, "utf-8");
        const installedPlugins = JSON.parse(fileContent);
        const plugins = installedPlugins.plugins || {};

        console.log("Checking for hey-claude plugin...");
        console.log("Available plugin keys:", Object.keys(plugins));

        // 1. 정확한 키로 먼저 확인 (가장 빠름)
        const exactKey = "hey-claude@hey-claude-marketplace";
        if (plugins[exactKey]) {
            const pluginData = plugins[exactKey];
            if (Array.isArray(pluginData) && pluginData.length > 0) {
                const pluginInfo = pluginData[0];
                console.log(`✅ Found plugin with key: ${exactKey}`);
                return {
                    installed: true,
                    version: pluginInfo.version,
                };
            }
        }

        // 2. hey-claude@로 시작하는 모든 키 확인 (다양한 마켓플레이스 지원)
        const heyClaudeKeys = Object.keys(plugins).filter((key) =>
            key.toLowerCase().startsWith("hey-claude@")
        );

        if (heyClaudeKeys.length > 0) {
            console.log(`Found ${heyClaudeKeys.length} hey-claude related keys:`, heyClaudeKeys);

            for (const key of heyClaudeKeys) {
                const pluginData = plugins[key];
                if (Array.isArray(pluginData) && pluginData.length > 0) {
                    const pluginInfo = pluginData[0];
                    console.log(`✅ Using plugin from key: ${key}`);
                    return {
                        installed: true,
                        version: pluginInfo.version,
                    };
                }
            }
        }

        console.log("❌ hey-claude plugin not found in installed_plugins.json");
        return { installed: false };
    } catch (error) {
        console.error("Plugin check error:", error);
        if (error instanceof SyntaxError) {
            console.error("Failed to parse installed_plugins.json - invalid JSON format");
        }
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
