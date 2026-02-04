/**
 * AI Provider 인터페이스
 */

export interface AIMessage {
    role: "user" | "assistant" | "system";
    content: string;
}

export interface ModelInfo {
    id: string;
    name: string;
    isDefault: boolean;
}

export interface AIProvider {
    chat(messages: AIMessage[]): Promise<string>;
    getSupportedModels(): ModelInfo[];
}

export type ProviderType = "groq" | "gemini" | "openai" | "claude";

// Export providers
export { GroqProvider } from "./groq.js";
export { GeminiProvider } from "./gemini.js";
export { OpenAIProvider } from "./openai.js";
export { ClaudeProvider } from "./claude.js";
