import "server-only";

import { getControlDb } from "@/lib/control-db";
import { ControlValidationError } from "@/lib/control-validation-error";
import { aiRecord, compatibleChatEndpoint, MAX_AI_PROVIDERS, normalizePlatformRouter, type PlatformAiRouterView } from "@/lib/ai/platform-router-config";
import { decryptPlatformAiKey, encryptPlatformAiKey, platformAiEncryptionReady } from "@/lib/ai/platform-ai-secrets";
import {
    DEFAULT_CHAT_MODEL_ID,
    GEMINI_ROUTER_MODEL_ID,
    normalizeChatModelSelection,
    resolveChatModelSelection,
    SUPPORTED_CHAT_MODELS,
} from "@/lib/ai/models";

export const PLATFORM_AI_RUNTIME_KEY = "ai.runtime";
export const DEFAULT_PLATFORM_CHAT_MODEL = GEMINI_ROUTER_MODEL_ID;

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
    const setting = await getControlDb().platformRuntimeSetting.findUnique({ where: { key: PLATFORM_AI_RUNTIME_KEY }, select: { value: true } });
    const value = record(setting?.value);
    const chatModel = normalizeChatModelSelection(typeof value.chatModel === "string" ? value.chatModel : configuredFallback());
    const router = normalizePlatformRouter(value.router);
    const stored = aiRecord(value.router);
    const rows = Array.isArray(stored.providers) ? stored.providers.map(aiRecord) : [];
    const publicRouter: PlatformAiRouterView = { ...router, providers: router.providers.map(p => ({ ...p, apiKeyConfigured: Boolean(rows.find(row => row.id === p.id)?.apiKeyCiphertext) })) };
    return {
        chatModel,
        selectedModel: resolveChatModelSelection(chatModel),
        geminiKeyConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
        openaiKeyConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()),
        environmentFallbackEnabled: process.env.ALLOW_ENV_AI_FALLBACK === "true",
        encryptionReady: platformAiEncryptionReady(),
        revision: Number(value.revision) || 0,
        router: publicRouter,
    };
}

/** Runtime reads fail closed: a DB outage must not silently select a paid fallback. */
export async function getPlatformAiRouterRuntime() {
    const setting = await getControlDb().platformRuntimeSetting.findUnique({ where: { key: PLATFORM_AI_RUNTIME_KEY }, select: { value: true } });
    const value = aiRecord(setting?.value), router = normalizePlatformRouter(value.router);
    const rows = Array.isArray(aiRecord(value.router).providers) ? (aiRecord(value.router).providers as unknown[]).map(aiRecord) : [];
    return {
        chatModel: normalizeChatModelSelection(typeof value.chatModel === "string" ? value.chatModel : configuredFallback()),
        router: { ...router, providers: router.providers.map(p => {
            const stored = rows.find(row => row.id === p.id);
            let apiKey = "";
            if (p.enabled && typeof stored?.apiKeyCiphertext === "string") {
                try { apiKey = decryptPlatformAiKey(stored.apiKeyCiphertext, Number(stored.keyVersion)); }
                catch { console.warn("[AI Router] A provider credential is unavailable."); }
            }
            return { ...p, apiKey };
        }) },
    };
}

export async function savePlatformAiRuntime(body: Record<string, unknown>, actorUserId: string) {
    const chatModel = typeof body.chatModel === "string" ? body.chatModel.trim() : "";
    if (normalizeChatModelSelection(chatModel) !== chatModel) throw new ControlValidationError("El modelo seleccionado no está permitido.");
    if (!SUPPORTED_CHAT_MODELS.some(model => model.id === chatModel)) {
        const { getPlatformModelCatalog } = await import("@/lib/ai/platform-model-catalog");
        const catalog = await getPlatformModelCatalog();
        if (!catalog.live || !catalog.models.some(model => model.id === chatModel)) throw new ControlValidationError("Actualiza el catálogo y elige un modelo disponible para la cuenta oficial.");
    }
    return getControlDb().$transaction(async tx => {
        const setting = await tx.platformRuntimeSetting.findUnique({ where: { key: PLATFORM_AI_RUNTIME_KEY }, select: { value: true, updatedAt: true } });
        const current = aiRecord(setting?.value), revision = Number(current.revision) || 0;
        if (body.router !== undefined && body.revision !== revision) throw new ControlValidationError("La configuración cambió en otra sesión. Recarga antes de guardar.");
        let router = current.router;
        if (body.router !== undefined) {
            const input = aiRecord(body.router);
            if (!Array.isArray(input.providers) || input.providers.length > MAX_AI_PROVIDERS || typeof input.enabled !== "boolean" || typeof input.primaryEnabled !== "boolean" || typeof input.fallbackEnabled !== "boolean"
                || !Number.isInteger(input.timeoutMs) || Number(input.timeoutMs) < 1500 || Number(input.timeoutMs) > 10000) throw new ControlValidationError("La configuración de proveedores no es válida.");
            const normalized = normalizePlatformRouter(input);
            if (normalized.providers.length !== input.providers.length) throw new ControlValidationError("Los proveedores deben tener identificadores únicos.");
            const previous = Array.isArray(aiRecord(current.router).providers) ? (aiRecord(current.router).providers as unknown[]).map(aiRecord) : [];
            const providers = normalized.providers.map(p => {
                const incoming = aiRecord((input.providers as unknown[]).find(value => aiRecord(value).id === p.id));
                if (!p.name.trim() || !p.model.trim() || !p.baseUrl.trim()) throw new ControlValidationError("Completa el nombre, modelo y URL de cada proveedor.");
                try { compatibleChatEndpoint(p.baseUrl); } catch { throw new ControlValidationError("Usa una URL HTTPS pública, sin credenciales ni parámetros."); }
                const existing = previous.find(row => row.id === p.id);
                const key = typeof incoming.apiKey === "string" ? incoming.apiKey.trim() : "";
                if (key.length > 4096 || /[\r\n]/.test(key)) throw new ControlValidationError("La clave de API no es válida.");
                // A changed destination requires a new explicit key, preventing stale
                // masked credentials from being forwarded to a different provider.
                const unchangedDestination = existing?.baseUrl === p.baseUrl;
                const secret = key ? encryptPlatformAiKey(key) : unchangedDestination && incoming.clearApiKey !== true
                    ? { apiKeyCiphertext: existing?.apiKeyCiphertext, keyVersion: existing?.keyVersion } : {};
                if (p.enabled && !secret.apiKeyCiphertext) throw new ControlValidationError("Captura la clave del proveedor antes de activarlo; si cambiaste su URL, vuelve a capturarla.");
                return { ...p, ...secret };
            });
            const envReady = process.env.ALLOW_ENV_AI_FALLBACK === "true";
            const primary = resolveChatModelSelection(chatModel).provider;
            const officialReady = (provider: string) => envReady && Boolean((provider === "gemini" ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY)?.trim());
            if (normalized.enabled && !providers.some(p => p.enabled && p.apiKeyCiphertext)
                && !(normalized.primaryEnabled && officialReady(primary)) && !(normalized.fallbackEnabled && officialReady(primary === "gemini" ? "openai" : "gemini"))) throw new ControlValidationError("Activa al menos un proveedor con credenciales disponibles.");
            router = { ...normalized, providers };
        }
        const value = JSON.parse(JSON.stringify({ ...current, chatModel, ...(router ? { router } : {}), revision: revision + 1 }));
        if (setting) {
            const result = await tx.platformRuntimeSetting.updateMany({ where: { key: PLATFORM_AI_RUNTIME_KEY, updatedAt: setting.updatedAt, value: { equals: JSON.parse(JSON.stringify(setting.value)) } }, data: { value } });
            if (result.count !== 1) throw new ControlValidationError("La configuración cambió en otra sesión. Recarga antes de guardar.");
        } else await tx.platformRuntimeSetting.create({ data: { key: PLATFORM_AI_RUNTIME_KEY, value } });
        await tx.auditLog.create({ data: { actorUserId, action: "ai_runtime.updated", resourceType: "PlatformRuntimeSetting", resourceId: PLATFORM_AI_RUNTIME_KEY, metadata: { chatModel, routerEnabled: aiRecord(router).enabled === true, providerCount: Array.isArray(aiRecord(router).providers) ? (aiRecord(router).providers as unknown[]).length : 0 } } });
        return { saved: true };
    });
}

/** Used only by the platform-admin diagnostic endpoint; never returns a secret to the client. */
export async function resolvePlatformProviderCredential(id: string, baseUrl: string, draftKey: string) {
    if (draftKey.trim()) return draftKey.trim();
    const setting = await getControlDb().platformRuntimeSetting.findUnique({ where: { key: PLATFORM_AI_RUNTIME_KEY }, select: { value: true } });
    const providers = aiRecord(aiRecord(setting?.value).router).providers;
    const stored = Array.isArray(providers) ? providers.map(aiRecord).find(p => p.id === id && p.baseUrl === baseUrl) : undefined;
    if (!stored || typeof stored.apiKeyCiphertext !== "string") throw new ControlValidationError("Captura una clave para este endpoint.");
    return decryptPlatformAiKey(stored.apiKeyCiphertext, Number(stored.keyVersion));
}
