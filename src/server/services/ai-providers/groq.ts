/**
 * Groq AI Provider
 * https://console.groq.com/docs/quickstart
 */

import { AIProvider, AIMessage, ModelInfo } from "./index.js";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

const GROQ_MODELS: ModelInfo[] = [
    { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B Versatile", isDefault: true },
    { id: "llama-3.1-70b-versatile", name: "Llama 3.1 70B Versatile", isDefault: false },
    { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant", isDefault: false },
    { id: "llama3-70b-8192", name: "Llama 3 70B", isDefault: false },
    { id: "llama3-8b-8192", name: "Llama 3 8B", isDefault: false },
    { id: "mixtral-8x7b-32768", name: "Mixtral 8x7B", isDefault: false },
    { id: "gemma2-9b-it", name: "Gemma 2 9B", isDefault: false }
];

export class GroqProvider implements AIProvider {
    private apiKey: string;
    private model: string;

    constructor(apiKey: string, model?: string) {
        this.apiKey = apiKey;
        this.model = model || GROQ_MODELS.find(m => m.isDefault)!.id;
    }

    getSupportedModels(): ModelInfo[] {
        return GROQ_MODELS;
    }

    async chat(messages: AIMessage[]): Promise<string> {
        const response = await fetch(GROQ_API_URL, {
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
            throw new Error(`Groq API error: ${response.status} - ${error}`);
        }

        const data = (await response.json()) as {
            choices: Array<{ message: { content: string } }>;
        };
        return data.choices[0]?.message?.content || "";
    }
}
