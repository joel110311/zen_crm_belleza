/**
 * Compatibility boundary for Google's October 2026 parameter deprecation.
 * Keep task settings (output limits, JSON schemas, safety, media) intact.
 */
const DEPRECATED_SAMPLING_FIELDS = new Set([
    "temperature", "topP", "top_p", "topK", "top_k", "candidateCount", "candidate_count",
]);

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown> : {};
}

function omitSampling(config: Record<string, unknown>) {
    return Object.fromEntries(Object.entries(config).filter(([key]) => !DEPRECATED_SAMPLING_FIELDS.has(key)));
}

function assertAllowedGeminiModel(model: string) {
    if (/(?:^|[:/])gemini-2\.5-flash(?:$|-)/i.test(model.trim())) {
        throw new Error("Gemini 2.5 Flash esta deshabilitado. Configura Gemini 3.1 Flash-Lite u otro proveedor permitido.");
    }
}

function thinkingProfile(model: string) {
    const name = model.replace(/^gemini:/, "").replace(/^models\//, "").toLowerCase();
    if (/^gemini-3\.(1|5)-flash-lite(?:-preview)?$/.test(name)) {
        return { defaultLevel: "minimal", levels: ["minimal", "low", "medium", "high"] };
    }
    if (/^gemini-3\.6-flash(?:-preview)?$/.test(name) || name === "gemini-3-flash-preview") {
        return { defaultLevel: "low", levels: ["minimal", "low", "medium", "high"] };
    }
    if (/^gemini-3\.(7|8)-flash(?:-preview)?$/.test(name)) {
        return { defaultLevel: "low", levels: ["low", "medium", "high"] };
    }
    // Unknown/new models use Google's defaults instead of guessing supported levels.
    return null;
}

export function prepareGeminiPayload(model: string, payload: Record<string, unknown>): Record<string, unknown> & { generationConfig?: Record<string, unknown> } {
    assertAllowedGeminiModel(model);
    const { generationConfig, generation_config, ...rest } = payload;
    const config = omitSampling({ ...record(generation_config), ...record(generationConfig) });
    const thinking = { ...record(config.thinking_config), ...record(config.thinkingConfig) };
    const requestedLevel = thinking.thinkingLevel ?? thinking.thinking_level;
    delete config.thinkingConfig;
    delete config.thinking_config;
    delete config.thinkingBudget;
    delete config.thinking_budget;
    delete config.thinkingLevel;
    delete config.thinking_level;
    delete thinking.thinkingBudget;
    delete thinking.thinking_budget;
    delete thinking.thinkingLevel;
    delete thinking.thinking_level;

    const profile = thinkingProfile(model);
    if (profile) {
        thinking.thinkingLevel = typeof requestedLevel === "string" && profile.levels.includes(requestedLevel)
            ? requestedLevel : profile.defaultLevel;
    }
    if (Object.keys(thinking).length > 0) config.thinkingConfig = thinking;
    return { ...rest, ...(Object.keys(config).length > 0 ? { generationConfig: config } : {}) };
}

/** Google-compatible endpoints and Gemini models behind proxies share the same deprecation. */
export function prepareCompatibleChatPayload(baseUrl: string, payload: Record<string, unknown>) {
    const model = typeof payload.model === "string" ? payload.model : "";
    assertAllowedGeminiModel(model);
    const googleHost = new URL(baseUrl).hostname.toLowerCase() === "generativelanguage.googleapis.com";
    if (!googleHost && !/(?:^|\/)gemini-/i.test(model)) return payload;
    return omitSampling(payload);
}
