import assert from "node:assert/strict";
import test from "node:test";
import * as models from "../src/lib/ai/models.ts";
import * as config from "../src/lib/ai/platform-router-config.ts";
import * as gemini from "../src/lib/ai/gemini-config.ts";
import { loadTsModule } from "./helpers/load-ts-module.mts";

class ProviderError extends Error { readonly status: number; constructor(status: number) { super("private provider detail must not be logged"); this.status = status; } }
function fixture() {
    const router = { ...config.normalizePlatformRouter({ enabled: true, primaryEnabled: true, fallbackEnabled: true, order: ["groq", "google", "primary", "fallback"], providers: [
        { id: "groq", name: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "qwen/example", enabled: true },
        { id: "google", name: "Google extra", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-3.6-flash", enabled: true },
    ] }), providers: [] as Array<config.PlatformAiProvider & { apiKey: string }> };
    router.providers = config.normalizePlatformRouter({ providers: [
        { id: "groq", name: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "qwen/example", enabled: true },
        { id: "google", name: "Google extra", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-3.6-flash", enabled: true },
    ] }).providers.map(p => ({ ...p, apiKey: `private-${p.id}` }));
    const calls: Array<{ target: string; body?: Record<string, unknown>; timeout?: number }> = [];
    const statuses = new Map<string, number>(); const logs: unknown[] = [];
    let empty = false;
    const api = loadTsModule("src/lib/ai/platform-chat-router.ts", {
        "server-only": {}, "@/lib/ai/platform-runtime": { getPlatformAiRouterRuntime: async () => ({ chatModel: models.GEMINI_ROUTER_MODEL_ID, router }) },
        "@/lib/ai/platform-router-config": config, "@/lib/ai/models": models, "@/lib/ai/gemini-config": gemini,
        "@/lib/ai/platform-compatible-transport": { PlatformAiHttpError: ProviderError, requestCompatibleAi: async (base: string, _key: string, body: Record<string, unknown>) => {
            calls.push({ target: base, body }); if (statuses.has(base)) throw new ProviderError(statuses.get(base)!); return empty ? "" : "Respuesta";
        } },
    }, { console: { warn: (...args: unknown[]) => logs.push(args) } }) as { generatePlatformCompletion: (messages: unknown[], temp: number, official: unknown) => Promise<string> };
    const official = async (model: string, _messages: unknown, _temp: number, timeout: number) => { calls.push({ target: model, timeout }); return "Oficial"; };
    const run = (messages = [{ role: "system", content: "Responde con JSON" }]) => api.generatePlatformCompletion(messages, 0.3, official);
    return { run, calls, router, statuses, logs, setEmpty: () => { empty = true; } };
}

test("first successful provider avoids additional token calls and adds a user turn for internal tasks", async () => {
    const f = fixture(); assert.equal(await f.run(), "Respuesta"); assert.equal(f.calls.length, 1);
    assert.ok((f.calls[0].body?.messages as Array<{ role: string }>).some(m => m.role === "user"));
});
test("quota failure tries the next active account, strips Gemini sampling, and skips failed account during cooldown", async () => {
    const f = fixture(); f.statuses.set(f.router.providers[0].baseUrl, 429);
    assert.equal(await f.run(), "Respuesta"); assert.equal(f.calls.length, 2);
    assert.equal(f.calls[1].body?.temperature, undefined);
    await f.run(); assert.equal(f.calls.length, 3); assert.equal(f.calls[2].target, f.router.providers[1].baseUrl);
    assert.equal(JSON.stringify(f.logs).includes("private-"), false);
    assert.equal(JSON.stringify(f.logs).includes("private provider detail"), false);
});
test("a malformed payload does not suppress a provider for subsequent valid requests", async () => {
    const f = fixture(); f.statuses.set(f.router.providers[0].baseUrl, 400); await f.run();
    f.statuses.clear(); await f.run([{ role: "user", content: "Hola" }]);
    assert.equal(f.calls[2].target, f.router.providers[0].baseUrl);
});
test("disabled providers are skipped; empty replies fall back to the configured official model", async () => {
    const f = fixture(); f.router.providers[0].enabled = false; f.setEmpty();
    assert.equal(await f.run(), "Oficial"); assert.deepEqual(f.calls.map(c => c.target), [f.router.providers[1].baseUrl, models.GEMINI_ROUTER_MODEL_ID]);
    assert.equal(f.calls[1].timeout, 4000);
});
test("router disabled preserves the existing official model; no implicit backup is activated", async () => {
    const f = fixture(); f.router.enabled = false;
    assert.equal(await f.run(), "Oficial"); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].target, models.GEMINI_ROUTER_MODEL_ID);
});
test("all configured providers failing returns a safe error without leaking credentials or input", async () => {
    const f = fixture(); f.router.primaryEnabled = false; f.router.fallbackEnabled = false;
    for (const p of f.router.providers) f.statuses.set(p.baseUrl, 503);
    await assert.rejects(f.run(), /Ningún proveedor de IA activo pudo responder/);
    assert.equal(f.calls.length, 2);
});
