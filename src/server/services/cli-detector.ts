import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface CliProvider {
    id: string;
    name: string;
    type: "cli" | "api";
    installed?: boolean;
    version?: string;
    loggedIn?: boolean;
    apiKeySet?: boolean;
    description?: string;
}

/**
 * CLI 도구의 설치 여부와 버전을 확인합니다.
 */
const checkCliTool = (command: string): { installed: boolean; version?: string } => {
    try {
        const output = execSync(`${command} --version`, {
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
            timeout: 3000,
        }).trim();

        // 버전 정보 추출 (예: "1.0.0" 형식)
        const versionMatch = output.match(/(\d+\.\d+\.\d+)/);
        const version = versionMatch ? versionMatch[1] : undefined;

        return { installed: true, version };
    } catch {
        return { installed: false };
    }
};

/**
 * Claude Code 플러그인 설치 여부를 확인합니다.
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
                    const fs = require("fs");
                    const pluginJson = JSON.parse(fs.readFileSync(pluginJsonPath, "utf-8"));
                    return { installed: true, version: pluginJson.version };
                }
                return { installed: true };
            }
        }

        return { installed: false };
    } catch (error) {
        console.error("Claude Code plugin check error:", error);
        return { installed: false };
    }
};

/**
 * Gemini CLI 로그인 상태를 확인합니다.
 */
const checkGeminiLogin = (): boolean => {
    try {
        // gemini-cli에 "whoami" 같은 명령어가 있다면 사용
        // 임시로 config 파일 존재 여부로 판단
        const homeDir = homedir();
        const configPath = join(homeDir, ".config", "gemini-cli", "config.json");
        return existsSync(configPath);
    } catch {
        return false;
    }
};

/**
 * 모든 CLI 도구의 상태를 감지합니다.
 */
export const detectCliTools = async (apiKeys: { groq?: string }): Promise<CliProvider[]> => {
    const providers: CliProvider[] = [];

    // 1. Claude Code (Hooks 연동)
    const claudeCode = checkClaudeCodePlugin();
    providers.push({
        id: "claude-code",
        name: "Claude Code",
        type: "cli",
        installed: claudeCode.installed,
        version: claudeCode.version,
        description: "Hooks 연동으로 작동",
    });

    // 2. Gemini CLI
    const geminiCli = checkCliTool("gemini");
    providers.push({
        id: "gemini-cli",
        name: "Gemini CLI",
        type: "cli",
        installed: geminiCli.installed,
        version: geminiCli.version,
        loggedIn: geminiCli.installed ? checkGeminiLogin() : undefined,
        description: "무료: 60req/min, 1000req/day",
    });

    // 3. Codex CLI
    const codexCli = checkCliTool("codex");
    providers.push({
        id: "codex-cli",
        name: "Codex CLI",
        type: "cli",
        installed: codexCli.installed,
        version: codexCli.version,
    });

    // 4. Groq API
    providers.push({
        id: "groq",
        name: "Groq API",
        type: "api",
        apiKeySet: !!apiKeys.groq && apiKeys.groq.length > 0,
        description: "API 키 필요",
    });

    return providers;
};
