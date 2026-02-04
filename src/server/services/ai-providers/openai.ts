/**
 * OpenAI AI Provider
 * https://platform.openai.com/docs/api-reference/chat
 */

import { AIProvider, AIMessage, ModelInfo } from "./index.js";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

const OPENAI_MODELS: ModelInfo[] = [
    { id: "gpt-5.2", name: "GPT-5.2", isDefault: true },
    { id: "gpt-5.2-instant", name: "GPT-5.2 Instant", isDefault: false },
    { id: "o3", name: "O3", isDefault: false },
    { id: "o3-pro", name: "O3 Pro", isDefault: false },
    { id: "o4-mini", name: "O4 Mini", isDefault: false },
    { id: "gpt-4.1", name: "GPT-4.1", isDefault: false },
    { id: "gpt-4.1-mini", name: "GPT-4.1 Mini", isDefault: false },
    { id: "gpt-4.1-nano", name: "GPT-4.1 Nano", isDefault: false }
];

export class OpenAIProvider implements AIProvider {
    private apiKey: string;
    private model: string;

    constructor(apiKey: string, model?: string) {
        this.apiKey = apiKey;
        this.model = model || OPENAI_MODELS.find(m => m.isDefault)!.id;
    }

    getSupportedModels(): ModelInfo[] {
        return OPENAI_MODELS;
    }

    async chat(messages: AIMessage[]): Promise<string> {
        const response = await fetch(OPENAI_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
                model: this.model,
                messages: messages.map((msg) => ({
                    role: msg.role,
                    content: msg.content,
                })),
                temperature: 0.7,
                max_tokens: 2000,
            }),
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`OpenAI API error: ${response.status} - ${error}`);
        }

        const data = (await response.json()) as {
            choices: Array<{ message: { content: string } }>;
        };
        return data.choices[0]?.message?.content || "";
    }
}
