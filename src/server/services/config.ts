/**
 * Config Service - .hey-claude/config.json 읽기/쓰기
 */

import fs from "fs/promises";
import path from "path";

export interface Config {
    version: number;
    server: {
        autoStart: boolean;
    };
    theme: "system" | "dark" | "light";
    language: "en" | "ko";
    apiKeys: {
        groq?: string;
        gemini?: string;
        openai?: string;
        claude?: string;
    };
    multiAI: {
        feedbackEnabled: boolean;
        feedbackModel: string;
        quickChatModel: string;
        compressionModel: string;
    };
    compression: {
        enabled: boolean;
        excludeTools: string[];
    };
}

const DEFAULT_CONFIG: Config = {
    version: 1,
    server: {
        autoStart: true,
    },
    theme: "system",
    language: "en",
    apiKeys: {},
    multiAI: {
        feedbackEnabled: false,
        feedbackModel: "groq",
        quickChatModel: "groq",
        compressionModel: "groq",
    },
    compression: {
        enabled: true,
        excludeTools: ["Read", "Grep", "Glob"],
    },
};

/**
 * Config 파일 경로 반환
 */
export const getConfigPath = (projectPath: string): string => {
    return path.join(projectPath, ".hey-claude", "config.json");
};

/**
 * Config 디렉토리 경로 반환
 */
export const getConfigDirPath = (projectPath: string): string => {
    return path.join(projectPath, ".hey-claude");
};

/**
 * Config 파일 읽기 (없으면 기본값으로 생성)
 */
export const readConfig = async (projectPath: string): Promise<Config> => {
    const configPath = getConfigPath(projectPath);

    try {
        const data = await fs.readFile(configPath, "utf-8");
        const config = JSON.parse(data) as Config;

        // 기본값과 병합 (누락된 필드 방지)
        return {
            ...DEFAULT_CONFIG,
            ...config,
            server: { ...DEFAULT_CONFIG.server, ...config.server },
            apiKeys: { ...DEFAULT_CONFIG.apiKeys, ...config.apiKeys },
            multiAI: { ...DEFAULT_CONFIG.multiAI, ...config.multiAI },
            compression: { ...DEFAULT_CONFIG.compression, ...config.compression },
        };
    } catch (error) {
        // 파일이 없으면 기본값으로 생성
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            await writeConfig(projectPath, DEFAULT_CONFIG);
            return DEFAULT_CONFIG;
        }
        throw error;
    }
};

/**
 * Config 파일 쓰기
 */
export const writeConfig = async (
    projectPath: string,
    config: Config
): Promise<void> => {
    const configDirPath = getConfigDirPath(projectPath);
    const configPath = getConfigPath(projectPath);

    // 디렉토리 생성 (없으면)
    await fs.mkdir(configDirPath, { recursive: true });

    // Config 파일 쓰기
    await fs.writeFile(configPath, JSON.stringify(config, null, 4), "utf-8");
};

/**
 * Config 부분 업데이트
 */
export const updateConfig = async (
    projectPath: string,
    updates: Partial<Config>
): Promise<Config> => {
    const config = await readConfig(projectPath);
    const newConfig = { ...config, ...updates };
    await writeConfig(projectPath, newConfig);
    return newConfig;
};

/**
 * API 키 가져오기
 */
export const getApiKey = async (
    projectPath: string,
    provider: keyof Config["apiKeys"]
): Promise<string | undefined> => {
    const config = await readConfig(projectPath);
    return config.apiKeys[provider];
};

/**
 * API 키 설정
 */
export const setApiKey = async (
    projectPath: string,
    provider: keyof Config["apiKeys"],
    apiKey: string
): Promise<void> => {
    const config = await readConfig(projectPath);
    config.apiKeys[provider] = apiKey;
    await writeConfig(projectPath, config);
};
