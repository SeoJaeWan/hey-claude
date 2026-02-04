/**
 * Gemini AI Provider
 * https://ai.google.dev/gemini-api/docs/text-generation
 */

import { AIProvider, AIMessage, ModelInfo } from "./index.js";

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models";

const GEMINI_MODELS: ModelInfo[] = [
    { id: "gemini-3-pro", name: "Gemini 3 Pro", isDefault: true },
    { id: "gemini-3-flash", name: "Gemini 3 Flash", isDefault: false },
    { id: "gemini-3-pro-image", name: "Gemini 3 Pro Image (Nano Banana Pro)", isDefault: false }
];

export class GeminiProvider implements AIProvider {
    private apiKey: string;
    private model: string;

    constructor(apiKey: string, model?: string) {
        this.apiKey = apiKey;
        this.model = model || GEMINI_MODELS.find(m => m.isDefault)!.id;
    }

    getSupportedModels(): ModelInfo[] {
        return GEMINI_MODELS;
    }

    async chat(messages: AIMessage[]): Promise<string> {
        // Gemini는 OpenAI와 다른 형식을 사용
        // system 메시지는 별도로 처리하고, user/model(assistant) 형식으로 변환
        const systemMessage = messages.find((m) => m.role === "system");
        const conversationMessages = messages.filter((m) => m.role !== "system");

        const contents = conversationMessages.map((msg) => ({
            role: msg.role === "assistant" ? "model" : "user",
            parts: [{ text: msg.content }],
        }));

        // system 메시지가 있으면 첫 user 메시지에 포함
        if (systemMessage && contents.length > 0 && contents[0].role === "user") {
            contents[0].parts[0].text = `${systemMessage.content}\n\n${contents[0].parts[0].text}`;
        }

        const response = await fetch(
            `${GEMINI_API_URL}/${this.model}:generateContent?key=${this.apiKey}`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    contents,
                    generationConfig: {
                        temperature: 0.7,
                        maxOutputTokens: 2000,
                    },
                }),
            }
        );

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Gemini API error: ${response.status} - ${error}`);
        }

        const data = (await response.json()) as {
            candidates: Array<{
                content: { parts: Array<{ text: string }> };
            }>;
        };
        return data.candidates[0]?.content?.parts[0]?.text || "";
    }
}
