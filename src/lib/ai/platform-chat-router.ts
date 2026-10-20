import "server-only";
import { createHash } from "node:crypto";
import type OpenAI from "openai";
import { getPlatformAiRouterRuntime } from "@/lib/ai/platform-runtime";
import { AI_PRIMARY, AI_FALLBACK } from "@/lib/ai/platform-router-config";
import { resolveChatModelSelection, GEMINI_ROUTER_MODEL_ID } from "@/lib/ai/models";
import { prepareCompatibleChatPayload } from "@/lib/ai/gemini-config";
import { PlatformAiHttpError, requestCompatibleAi } from "@/lib/ai/platform-compatible-transport";

const cooldowns = new Map<string, number>();
type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type BuiltIn = (model: string, messages: Message[], temperature: number, timeoutMs?: number) => Promise<string | null>;

export async function generatePlatformCompletion(messages: Message[], temperature: number, runBuiltIn: BuiltIn) {
    const { chatModel, router } = await getPlatformAiRouterRuntime();
    if (!router.enabled) return runBuiltIn(chatModel, messages, temperature);
    const candidates = new Map<string, { fingerprint: string; run: (timeout: number) => Promise<string | null> }>();
    const userMessages = messages.some(message => message.role === "user") ? messages : [...messages, { role: "user" as const, content: "Ejecuta la tarea indicada y devuelve únicamente el resultado solicitado." }];
    for (const provider of router.providers) {
        if (!provider.enabled || !provider.apiKey) continue;
        candidates.set(provider.id, {
            fingerprint: createHash("sha256").update(JSON.stringify([provider.baseUrl, provider.model, provider.apiKey])).digest("hex"),
            run: timeout => requestCompatibleAi(provider.baseUrl, provider.apiKey, prepareCompatibleChatPayload(provider.baseUrl, { model: provider.model, messages: userMessages, temperature, stream: false }), AbortSignal.timeout(timeout)),
        });
    }
    const fallback = resolveChatModelSelection(chatModel).provider === "gemini" ? "openai:gpt-4o-mini" : GEMINI_ROUTER_MODEL_ID;
    if (router.primaryEnabled) candidates.set(AI_PRIMARY, { fingerprint: `official:${chatModel}`, run: timeout => runBuiltIn(chatModel, messages, temperature, timeout) });
    if (router.fallbackEnabled) candidates.set(AI_FALLBACK, { fingerprint: `official:${fallback}`, run: timeout => runBuiltIn(fallback, messages, temperature, timeout) });
    const deadline = Date.now() + 20_000;
    for (const [key, expires] of cooldowns) if (expires <= Date.now()) cooldowns.delete(key);
    for (const id of router.order) {
        const candidate = candidates.get(id), remaining = deadline - Date.now();
        if (!candidate || remaining < 1 || (cooldowns.get(candidate.fingerprint) || 0) > Date.now()) continue;
        try {
            const result = (await candidate.run(Math.min(router.timeoutMs, remaining)))?.trim();
            if (!result) throw new Error("Respuesta vacía.");
            cooldowns.delete(candidate.fingerprint);
            return result;
        } catch (error) {
            const status = error instanceof PlatformAiHttpError ? error.status : typeof error === "object" && error ? Number(Reflect.get(error, "status")) : 0;
            if (![400, 422].includes(status)) cooldowns.set(candidate.fingerprint, Date.now() + 30_000);
            // Never include provider payloads, keys, customer messages or raw errors in logs.
            console.warn("[AI Router] Provider failed; trying next enabled provider.", { providerId: id, status: status || null });
        }
    }
    throw new Error("Ningún proveedor de IA activo pudo responder. Intenta nuevamente en unos momentos.");
}
