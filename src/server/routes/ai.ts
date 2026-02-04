import { Router, type Router as RouterType } from "express";
import { readConfig } from "../services/config.js";
import { getDatabase } from "../services/database.js";
import {
    GroqProvider,
    GeminiProvider,
    OpenAIProvider,
    ClaudeProvider,
    AIMessage,
    ProviderType,
} from "../services/ai-providers/index.js";

const router: RouterType = Router();

/**
 * AI Provider 팩토리
 */
const createProvider = async (
    projectPath: string,
    providerType: ProviderType,
    model?: string
) => {
    const config = await readConfig(projectPath);
    const apiKey = config.apiKeys[providerType];

    if (!apiKey) {
        throw new Error(`API key not found for ${providerType}`);
    }

    switch (providerType) {
        case "groq":
            return new GroqProvider(apiKey, model);
        case "gemini":
            return new GeminiProvider(apiKey, model);
        case "openai":
            return new OpenAIProvider(apiKey, model);
        case "claude":
            return new ClaudeProvider(apiKey, model);
        default:
            throw new Error(`Unknown provider: ${providerType}`);
    }
};

// POST /api/ai/chat - 일반 질문
router.post("/chat", async (req, res) => {
    try {
        const { provider, messages, model } = req.body as {
            provider: ProviderType;
            messages: AIMessage[];
            model?: string;
        };

        if (!provider || !messages || messages.length === 0) {
            res.status(400).json({
                error: {
                    code: "MISSING_PARAMETERS",
                    message: "provider and messages are required",
                },
            });
            return;
        }

        const projectPath = process.cwd();
        const aiProvider = await createProvider(projectPath, provider, model);
        const response = await aiProvider.chat(messages);

        res.json({
            data: {
                response,
            },
        });
    } catch (error) {
        res.status(500).json({
            error: {
                code: "AI_CHAT_FAILED",
                message: error instanceof Error ? error.message : "Unknown error",
            },
        });
    }
});

// POST /api/ai/feedback - 프롬프트 피드백
router.post("/feedback", async (req, res) => {
    try {
        const { prompt } = req.body;

        if (!prompt) {
            res.status(400).json({
                error: {
                    code: "MISSING_PARAMETERS",
                    message: "prompt is required",
                },
            });
            return;
        }

        const projectPath = process.cwd();
        const config = await readConfig(projectPath);
        const provider = config.multiAI.feedbackModel as ProviderType;

        const aiProvider = await createProvider(projectPath, provider);

        const feedbackPrompt: AIMessage[] = [
            {
                role: "system",
                content: `You are an expert prompt engineer. Analyze the given prompt and provide actionable feedback to improve it.

Focus on:
1. Clarity: Is the prompt clear and specific?
2. Context: Does it provide enough context?
3. Structure: Is it well-structured?
4. Specificity: Are the requirements specific enough?

Provide 3-5 concrete suggestions for improvement.`,
            },
            {
                role: "user",
                content: `Analyze this prompt and suggest improvements:\n\n${prompt}`,
            },
        ];

        const response = await aiProvider.chat(feedbackPrompt);

        res.json({
            data: {
                feedback: response,
            },
        });
    } catch (error) {
        res.status(500).json({
            error: {
                code: "AI_FEEDBACK_FAILED",
                message: error instanceof Error ? error.message : "Unknown error",
            },
        });
    }
});

// POST /api/ai/summary - 컨텍스트 요약
router.post("/summary", async (req, res) => {
    try {
        const { sessionId } = req.body;

        if (!sessionId) {
            res.status(400).json({
                error: {
                    code: "MISSING_PARAMETERS",
                    message: "sessionId is required",
                },
            });
            return;
        }

        const db = getDatabase();

        // 세션의 모든 메시지 조회
        const messages = db
            .prepare(
                `SELECT role, content FROM messages
                 WHERE session_id = ?
                 ORDER BY timestamp ASC`
            )
            .all(sessionId) as { role: string; content: string }[];

        if (messages.length === 0) {
            res.status(404).json({
                error: {
                    code: "NO_MESSAGES",
                    message: "No messages found for this session",
                },
            });
            return;
        }

        // 대화 내용 포맷팅
        const conversation = messages
            .map((msg) => `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`)
            .join("\n\n");

        const projectPath = process.cwd();
        const config = await readConfig(projectPath);
        const provider = config.multiAI.compressionModel as ProviderType;

        const aiProvider = await createProvider(projectPath, provider);

        const summaryPrompt: AIMessage[] = [
            {
                role: "system",
                content: `You are an expert at summarizing conversations. Create a concise summary that captures:
1. Main topics discussed
2. Key decisions made
3. Action items or outcomes
4. Important context

Keep the summary focused and actionable.`,
            },
            {
                role: "user",
                content: `Summarize this conversation:\n\n${conversation}`,
            },
        ];

        const summary = await aiProvider.chat(summaryPrompt);

        // 요약 저장
        try {
            db.prepare(
                `INSERT OR REPLACE INTO context_summaries (session_id, content, created_at)
                 VALUES (?, ?, ?)`
            ).run(sessionId, summary, new Date().toISOString());
        } catch (dbError) {
            console.error("Failed to save summary:", dbError);
        }

        res.json({
            data: {
                summary,
            },
        });
    } catch (error) {
        res.status(500).json({
            error: {
                code: "AI_SUMMARY_FAILED",
                message: error instanceof Error ? error.message : "Unknown error",
            },
        });
    }
});

// GET /api/ai/models - 사용 가능 모델
router.get("/models", async (_req, res) => {
    try {
        const projectPath = process.cwd();
        const config = await readConfig(projectPath);

        // 각 Provider의 getSupportedModels()를 호출하여 모델 정보 수집
        const groqProvider = new GroqProvider("");
        const geminiProvider = new GeminiProvider("");
        const openaiProvider = new OpenAIProvider("");
        const claudeProvider = new ClaudeProvider("");

        const availableModels = {
            groq: {
                available: !!config.apiKeys.groq,
                models: groqProvider.getSupportedModels(),
            },
            gemini: {
                available: !!config.apiKeys.gemini,
                models: geminiProvider.getSupportedModels(),
            },
            openai: {
                available: !!config.apiKeys.openai,
                models: openaiProvider.getSupportedModels(),
            },
            claude: {
                available: !!config.apiKeys.claude,
                models: claudeProvider.getSupportedModels(),
            },
        };

        res.json({
            data: availableModels,
        });
    } catch (error) {
        res.status(500).json({
            error: {
                code: "AI_MODELS_FAILED",
                message: error instanceof Error ? error.message : "Unknown error",
            },
        });
    }
});

export default router;
