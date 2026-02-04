/**
 * AI 압축 서비스
 * Groq API를 사용하여 도구 사용 내역을 압축
 */

import { readConfig } from "./config.js";
import { GroqProvider } from "./ai-providers/index.js";

interface ToolUsage {
    toolName: string;
    toolInput: Record<string, unknown>;
    toolOutput: Record<string, unknown>;
}

interface CompressionResult {
    type: "gotcha" | "problem-solution" | "info" | "decision";
    title: string;
    content: string;
}

/**
 * AI 기반 압축 (Groq API 사용)
 */
const compressWithAI = async (
    projectPath: string,
    toolUsage: ToolUsage
): Promise<CompressionResult | null> => {
    try {
        const config = await readConfig(projectPath);

        // 압축 비활성화 또는 API 키 없음
        if (!config.compression.enabled || !config.apiKeys.groq) {
            return basicCompress(toolUsage);
        }

        // 제외 도구 체크
        if (config.compression.excludeTools.includes(toolUsage.toolName)) {
            return null;
        }

        const provider = new GroqProvider(config.apiKeys.groq);

        // 도구 사용 내역 포맷팅
        const toolContext = `
Tool: ${toolUsage.toolName}
Input: ${JSON.stringify(toolUsage.toolInput, null, 2)}
Output: ${JSON.stringify(toolUsage.toolOutput, null, 2)}
`.trim();

        const response = await provider.chat([
            {
                role: "system",
                content: `You are an expert at analyzing developer tool usage and creating concise, meaningful summaries.

Classify the tool usage into ONE of these types:
- gotcha: Unexpected issues or surprises (e.g., "node_modules needed reinstall", "missing env variable")
- problem-solution: A problem was encountered and solved (e.g., "CORS error → added proxy config")
- info: Regular information or action (e.g., "Created Button.tsx", "Ran tests")
- decision: Design or architecture decision (e.g., "Chose Zustand over Jotai", "Split component into smaller pieces")

Respond with ONLY a JSON object in this format:
{
  "type": "gotcha" | "problem-solution" | "info" | "decision",
  "title": "Short title (5-10 words)",
  "content": "One sentence description"
}`,
            },
            {
                role: "user",
                content: `Analyze and compress this tool usage:\n\n${toolContext}`,
            },
        ]);

        // JSON 파싱
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const result = JSON.parse(jsonMatch[0]) as CompressionResult;
            return result;
        }

        // 파싱 실패 시 기본 압축
        return basicCompress(toolUsage);
    } catch (error) {
        console.error("AI compression failed, falling back to basic:", error);
        return basicCompress(toolUsage);
    }
};

/**
 * 기본 압축 (룰 기반)
 */
const basicCompress = (toolUsage: ToolUsage): CompressionResult | null => {
    const { toolName, toolInput, toolOutput } = toolUsage;

    if (toolName === "Write") {
        const filePath = (toolInput.file_path as string) || "unknown";
        return {
            type: "info",
            title: `Created ${filePath}`,
            content: `Created new file: ${filePath}`,
        };
    }

    if (toolName === "Edit") {
        const filePath = (toolInput.file_path as string) || "unknown";
        return {
            type: "info",
            title: `Edited ${filePath}`,
            content: `Modified file: ${filePath}`,
        };
    }

    if (toolName === "Bash") {
        const command = (toolInput.command as string) || "unknown";
        const output = JSON.stringify(toolOutput);

        // 에러 감지
        const hasError =
            output.includes("error") ||
            output.includes("Error") ||
            output.includes("failed") ||
            output.includes("Failed");

        if (hasError) {
            return {
                type: "problem-solution",
                title: `Command error: ${command.substring(0, 30)}`,
                content: `Command "${command}" encountered an error`,
            };
        }

        return {
            type: "info",
            title: `Ran: ${command.substring(0, 30)}`,
            content: `Executed command: ${command}`,
        };
    }

    return null;
};

/**
 * 도구 사용 내역 압축 (메인 함수)
 */
export const compressToolUsage = async (
    projectPath: string,
    toolUsage: ToolUsage
): Promise<CompressionResult | null> => {
    return compressWithAI(projectPath, toolUsage);
};
