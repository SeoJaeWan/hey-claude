import {Model} from "../components/commons/modelSelect";

export interface Provider {
    id: string;
    name: string;
}

type TranslationFunction = (key: string) => string;

// Get provider models with translated descriptions
export const getProviderModels = (t: TranslationFunction): Record<string, Model[]> => ({
    "claude-code": [
        {
            id: "opus-4.5",
            name: "Opus 4.5",
            provider: "claude-code",
            description: t("models.mostPowerful")
        },
        {
            id: "sonnet-4.5",
            name: "Sonnet 4.5",
            provider: "claude-code",
            description: t("models.balanced")
        },
        {
            id: "haiku-4.5",
            name: "Haiku 4.5",
            provider: "claude-code",
            description: t("models.fastResponse")
        }
    ],
    "gemini-cli": [
        {
            id: "gemini-2.5-pro",
            name: "Gemini 2.5 Pro",
            provider: "gemini-cli",
            description: t("models.latestPro")
        },
        {
            id: "gemini-2.5-flash",
            name: "Gemini 2.5 Flash",
            provider: "gemini-cli",
            description: t("models.fastResponse")
        },
        {
            id: "gemini-2.0-flash-exp",
            name: "Gemini 2.0 Flash Experimental",
            provider: "gemini-cli",
            description: t("models.experimental")
        }
    ],
    "codex-cli": [
        {
            id: "gpt-5.2",
            name: "GPT-5.2",
            provider: "codex-cli",
            description: t("models.latestGPT")
        },
        {
            id: "o3",
            name: "O3",
            provider: "codex-cli",
            description: t("models.reasoning")
        },
        {
            id: "o4-mini",
            name: "O4 Mini",
            provider: "codex-cli",
            description: t("models.lightReasoning")
        }
    ],
    groq: [
        {
            id: "llama-3.3-70b",
            name: "Llama 3.3 70B",
            provider: "groq",
            description: t("models.groqOptimized")
        },
        {
            id: "mixtral-8x7b",
            name: "Mixtral 8x7B",
            provider: "groq",
            description: t("models.moeModel")
        },
        {
            id: "gemma-2-9b",
            name: "Gemma 2 9B",
            provider: "groq",
            description: t("models.lightModel")
        }
    ]
});

// Backward compatibility - static exports (English defaults)
export const PROVIDER_MODELS: Record<string, Model[]> = {
    "claude-code": [
        {
            id: "opus-4.5",
            name: "Opus 4.5",
            provider: "claude-code",
            description: "Most powerful model"
        },
        {
            id: "sonnet-4.5",
            name: "Sonnet 4.5",
            provider: "claude-code",
            description: "Balanced performance"
        },
        {
            id: "haiku-4.5",
            name: "Haiku 4.5",
            provider: "claude-code",
            description: "Fast response"
        }
    ],
    "gemini-cli": [
        {
            id: "gemini-2.5-pro",
            name: "Gemini 2.5 Pro",
            provider: "gemini-cli",
            description: "Latest Pro model"
        },
        {
            id: "gemini-2.5-flash",
            name: "Gemini 2.5 Flash",
            provider: "gemini-cli",
            description: "Fast response"
        },
        {
            id: "gemini-2.0-flash-exp",
            name: "Gemini 2.0 Flash Experimental",
            provider: "gemini-cli",
            description: "Experimental model"
        }
    ],
    "codex-cli": [
        {
            id: "gpt-5.2",
            name: "GPT-5.2",
            provider: "codex-cli",
            description: "Latest GPT model"
        },
        {
            id: "o3",
            name: "O3",
            provider: "codex-cli",
            description: "Reasoning model"
        },
        {
            id: "o4-mini",
            name: "O4 Mini",
            provider: "codex-cli",
            description: "Light reasoning model"
        }
    ],
    groq: [
        {
            id: "llama-3.3-70b",
            name: "Llama 3.3 70B",
            provider: "groq",
            description: "Groq optimized"
        },
        {
            id: "mixtral-8x7b",
            name: "Mixtral 8x7B",
            provider: "groq",
            description: "MoE model"
        },
        {
            id: "gemma-2-9b",
            name: "Gemma 2 9B",
            provider: "groq",
            description: "Light model"
        }
    ]
};

// Provider list (for Quick Chat tab)
export const PROVIDERS: Provider[] = [
    {id: "gemini-cli", name: "Gemini CLI"},
    {id: "codex-cli", name: "Codex CLI"},
    {id: "groq", name: "Groq"}
];

// Default values
export const DEFAULT_CLAUDE_MODEL = "sonnet-4.5";
export const DEFAULT_PROVIDER = "groq";
export const DEFAULT_QUICK_CHAT_MODEL = "llama-3.3-70b";
