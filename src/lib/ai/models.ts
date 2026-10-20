export type SupportedLlmProvider = "openai" | "gemini";

export type SupportedChatModelOption = {
    id: string;
    provider: SupportedLlmProvider;
    model: string;
    label: string;
    description: string;
};

export const DEFAULT_CHAT_MODEL_ID = "openai:gpt-4o-mini";
export const GEMINI_ROUTER_MODEL_ID = "gemini:models/gemini-3.1-flash-lite";
export const GEMINI_ROUTER_MODEL_PATH = "models/gemini-3.1-flash-lite";

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
        id: "gemini:models/gemini-3.5-flash-lite",
        provider: "gemini",
        model: "models/gemini-3.5-flash-lite",
        label: "Gemini 3.5 Flash-Lite",
        description: "Modelo Flash-Lite para tareas de texto de alto volumen.",
    },
    { id: "gemini:models/gemini-3.6-flash", provider: "gemini", model: "models/gemini-3.6-flash", label: "Gemini 3.6 Flash", description: "Modelo Flash de propósito general." },
    { id: "gemini:models/gemini-3.8-flash", provider: "gemini", model: "models/gemini-3.8-flash", label: "Gemini 3.8 Flash", description: "Modelo Flash reciente para tareas complejas." },
    { id: "gemini:models/gemini-3.1-pro-preview", provider: "gemini", model: "models/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro · Preview", description: "Modelo avanzado en versión preliminar." },
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
        description: "Ultrarrapido. Utiliza el modelo configurado sin cambiar a versiones anteriores.",
    },
];

const DEPRECATED_CHAT_MODEL_MAP: Record<string, string> = {
    "gemini:gemini-2.0-flash": "gemini:models/gemini-3.6-flash",
    "gemini:models/gemini-2.0-flash": "gemini:models/gemini-3.6-flash",
    "gemini-2.0-flash": "gemini:models/gemini-3.6-flash",
    "gemini:models/gemini-3.1-flash-lite-preview": "gemini:models/gemini-3.1-flash-lite",
    "gemini:gemini-3.1-flash-lite-preview": "gemini:models/gemini-3.1-flash-lite",
    "models/gemini-3.1-flash-lite-preview": "gemini:models/gemini-3.1-flash-lite",
    "gemini-3.1-flash-lite-preview": "gemini:models/gemini-3.1-flash-lite",
    "models/gemini-3.1-flash-lite": "gemini:models/gemini-3.1-flash-lite",
    "gemini-3.1-flash-lite": "gemini:models/gemini-3.1-flash-lite",
};

export function normalizeChatModelSelection(value?: string | null) {
    const trimmed = (value || "").trim();
    if (/^(?:gemini:)?(?:models\/)?gemini-2\.5-flash(?:$|-)/i.test(trimmed)) {
        return GEMINI_ROUTER_MODEL_ID;
    }
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

    // Additional models are admitted only after server-side account discovery on save.
    if (/^gemini:models\/gemini-[a-zA-Z0-9._-]+$/.test(trimmed)) return trimmed;

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
    const trimmed = (value || "").trim().replace(/^gemini:/, "").replace(/^\/+/, "");
    if (/^(?:models\/)?gemini-2\.5-flash(?:$|-)/i.test(trimmed)) {
        return GEMINI_ROUTER_MODEL_PATH;
    }
    if (!trimmed) {
        return GEMINI_ROUTER_MODEL_PATH;
    }

    if (trimmed.startsWith("models/")) {
        return trimmed;
    }

    return `models/${trimmed.replace(/^\/+/, "")}`;
}
