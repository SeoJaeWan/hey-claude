/**
 * Claude AI Provider (Anthropic API)
 * https://docs.anthropic.com/en/api/messages
 */

import { AIProvider, AIMessage, ModelInfo } from "./index.js";

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";

const CLAUDE_MODELS: ModelInfo[] = [
    { id: "claude-opus-4-5-20251101", name: "Claude Opus 4.5", isDefault: true },
    { id: "claude-sonnet-4-5-20250929", name: "Claude Sonnet 4.5", isDefault: false },
    { id: "claude-haiku-4-5-20250110", name: "Claude Haiku 4.5", isDefault: false },
    { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet", isDefault: false },
    { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku", isDefault: false }
];

export class ClaudeProvider implements AIProvider {
    private apiKey: string;
    private model: string;

    constructor(apiKey: string, model?: string) {
        this.apiKey = apiKey;
        this.model = model || CLAUDE_MODELS.find(m => m.isDefault)!.id;
    }

    getSupportedModels(): ModelInfo[] {
        return CLAUDE_MODELS;
    }

    async chat(messages: AIMessage[]): Promise<string> {
        // Claude API는 system 메시지를 별도로 처리
        const systemMessage = messages.find((m) => m.role === "system");
        const conversationMessages = messages
            .filter((m) => m.role !== "system")
            .map((msg) => ({
                role: msg.role,
                content: msg.content,
            }));

        const response = await fetch(CLAUDE_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": this.apiKey,
                "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
                model: this.model,
                max_tokens: 2000,
                system: systemMessage?.content,
                messages: conversationMessages,
                temperature: 0.7,
            }),
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Claude API error: ${response.status} - ${error}`);
        }

        const data = (await response.json()) as {
            content: Array<{ text: string }>;
        };
        return data.content[0]?.text || "";
    }
}
