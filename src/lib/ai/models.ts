export type SupportedLlmProvider = "openai" | "gemini";

export type SupportedChatModelOption = {
    id: string;
    provider: SupportedLlmProvider;
    model: string;
    label: string;
    description: string;
};

export const DEFAULT_CHAT_MODEL_ID = "openai:gpt-4o-mini";

export const SUPPORTED_CHAT_MODELS: SupportedChatModelOption[] = [
    {
        id: "openai:gpt-4o-mini",
        provider: "openai",
        model: "gpt-4o-mini",
        label: "GPT-4o mini",
        description: "Rapido, economico y muy util para soporte y ventas.",
    },
    {
        id: "openai:gpt-4.1-mini",
        provider: "openai",
        model: "gpt-4.1-mini",
        label: "GPT-4.1 mini",
        description: "Equilibrio entre velocidad y mejor razonamiento.",
    },
    {
        id: "openai:gpt-4.1",
        provider: "openai",
        model: "gpt-4.1",
        label: "GPT-4.1",
        description: "Mas potente para conversaciones complejas.",
    },
    {
        id: "gemini:gemini-2.0-flash",
        provider: "gemini",
        model: "gemini-2.0-flash",
        label: "Gemini 2.0 Flash",
        description: "Respuesta veloz con buena calidad para chat diario.",
    },
    {
        id: "gemini:gemini-2.5-flash",
        provider: "gemini",
        model: "gemini-2.5-flash",
        label: "Gemini 2.5 Flash",
        description: "Flash mas reciente para uso general.",
    },
    {
        id: "gemini:gemini-2.5-pro",
        provider: "gemini",
        model: "gemini-2.5-pro",
        label: "Gemini 2.5 Pro",
        description: "Mas capaz para razonamiento y respuestas exigentes.",
    },
    {
        id: "gemini:models/gemini-3.1-flash-lite",
        provider: "gemini",
        model: "models/gemini-3.1-flash-lite",
        label: "Gemini 3.1 Flash Lite",
        description: "Ultrarrapido. Si no esta disponible, el sistema usa fallback estable.",
    },
];

const DEPRECATED_CHAT_MODEL_MAP: Record<string, string> = {
    "gemini:models/gemini-3.1-flash-lite-preview": "gemini:models/gemini-3.1-flash-lite",
    "gemini:gemini-3.1-flash-lite-preview": "gemini:models/gemini-3.1-flash-lite",
    "models/gemini-3.1-flash-lite-preview": "gemini:models/gemini-3.1-flash-lite",
    "gemini-3.1-flash-lite-preview": "gemini:models/gemini-3.1-flash-lite",
    "models/gemini-3.1-flash-lite": "gemini:models/gemini-3.1-flash-lite",
    "gemini-3.1-flash-lite": "gemini:models/gemini-3.1-flash-lite",
};

export function normalizeChatModelSelection(value?: string | null) {
    const trimmed = (value || "").trim();
    if (!trimmed) {
        return DEFAULT_CHAT_MODEL_ID;
    }

    const deprecatedMapping = DEPRECATED_CHAT_MODEL_MAP[trimmed];
    if (deprecatedMapping) {
        return deprecatedMapping;
    }

    const exactMatch = SUPPORTED_CHAT_MODELS.find((option) => option.id === trimmed);
    if (exactMatch) {
        return exactMatch.id;
    }

    const legacyOpenAiMatch = SUPPORTED_CHAT_MODELS.find(
        (option) => option.provider === "openai" && option.model === trimmed,
    );
    if (legacyOpenAiMatch) {
        return legacyOpenAiMatch.id;
    }

    const legacyGeminiMatch = SUPPORTED_CHAT_MODELS.find(
        (option) => option.provider === "gemini" && option.model === trimmed,
    );
    if (legacyGeminiMatch) {
        return legacyGeminiMatch.id;
    }

    return DEFAULT_CHAT_MODEL_ID;
}

export function resolveChatModelSelection(value?: string | null) {
    const normalized = normalizeChatModelSelection(value);
    const exactMatch = SUPPORTED_CHAT_MODELS.find((option) => option.id === normalized);

    if (exactMatch) {
        return exactMatch;
    }

    const [provider, model] = normalized.split(":", 2) as [SupportedLlmProvider, string];
    return {
        id: normalized,
        provider,
        model,
        label: model,
        description: "",
    } satisfies SupportedChatModelOption;
}

export function resolveGeminiRestModelPath(value?: string | null) {
    const trimmed = (value || "").trim();
    if (!trimmed) {
        return "models/gemini-2.5-flash";
    }

    if (trimmed.startsWith("models/")) {
        return trimmed;
    }

    return `models/${trimmed.replace(/^\/+/, "")}`;
}
