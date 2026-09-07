import "server-only";

import { getControlDb } from "@/lib/control-db";
import {
    DEFAULT_CHAT_MODEL_ID,
    normalizeChatModelSelection,
    resolveChatModelSelection,
} from "@/lib/ai/models";

export const PLATFORM_AI_RUNTIME_KEY = "ai.runtime";
export const DEFAULT_PLATFORM_CHAT_MODEL = "gemini:gemini-2.5-flash";

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function configuredFallback() {
    return normalizeChatModelSelection(
        process.env.AI_CHAT_MODEL?.trim()
        || (process.env.MULTITENANT_RUNTIME_ENABLED === "true" ? DEFAULT_PLATFORM_CHAT_MODEL : DEFAULT_CHAT_MODEL_ID),
    );
}

export async function getPlatformChatModelSelection() {
    if (process.env.MULTITENANT_RUNTIME_ENABLED !== "true") return configuredFallback();

    try {
        const setting = await getControlDb().platformRuntimeSetting.findUnique({
            where: { key: PLATFORM_AI_RUNTIME_KEY },
            select: { value: true },
        });
        const value = record(setting?.value).chatModel;
        return normalizeChatModelSelection(typeof value === "string" ? value : configuredFallback());
    } catch (error) {
        console.warn("[AI] Could not read the platform model selection; using the safe fallback:", error);
        return configuredFallback();
    }
}

export async function getPlatformAiControlState() {
    const chatModel = await getPlatformChatModelSelection();
    return {
        chatModel,
        selectedModel: resolveChatModelSelection(chatModel),
        geminiKeyConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
        openaiKeyConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()),
        environmentFallbackEnabled: process.env.ALLOW_ENV_AI_FALLBACK === "true",
    };
}
