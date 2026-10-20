import assert from "node:assert/strict";
import test from "node:test";
import * as models from "../src/lib/ai/models.ts";
import * as config from "../src/lib/ai/platform-router-config.ts";
import { loadTsModule } from "./helpers/load-ts-module.mts";

test("current Gemini choices retain exact model identifiers and native discovery excludes audio/image-only models", () => {
    for (const id of ["gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-3.8-flash"]) {
        const selection = `gemini:models/${id}`;
        assert.equal(models.normalizeChatModelSelection(selection), selection);
        assert.equal(models.resolveChatModelSelection(selection).model, `models/${id}`);
    }
    assert.equal(models.SUPPORTED_CHAT_MODELS.some(m => m.model === "gemini-2.0-flash"), false);
    const api = loadTsModule("src/lib/ai/platform-model-catalog.ts", { "server-only": {}, "@/lib/ai/provider-keys": {}, "@/lib/ai/models": models }) as { geminiChatModelOptions: (value: unknown) => Array<{ id: string }> };
    const result = api.geminiChatModelOptions({ models: [
        { name: "models/gemini-future-flash", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-3.8-flash-tts", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-3.1-flash-image", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-embedding-001", supportedGenerationMethods: ["embedContent"] },
    ] });
    assert.deepEqual(JSON.parse(JSON.stringify(result.map(r => r.id))), ["gemini:models/gemini-future-flash"]);
});

test("diagnostics require admin and origin, use only a fixed synthetic prompt and never echo keys or provider output", async () => {
    let allowed = false, origin = true, io = 0;
    const captured: unknown[] = [];
    const api = loadTsModule("src/app/api/control/ai/provider/route.ts", {
        "next/server": { NextResponse: { json: (data: unknown, options: { status?: number } = {}) => ({ data, status: options.status || 200 }) } },
        "@/lib/platform-admin": { requirePlatformAdmin: async () => { if (!allowed) throw Object.assign(new Error("Sin acceso"), { status: 403 }); return { id: "admin" }; } },
        "@/lib/control-api-errors": { ControlValidationError: class extends Error {}, controlApiError: (error: { status?: number; message: string }) => ({ status: error.status || 400, message: error.message }) },
        "@/lib/security": { isSameApplicationOrigin: () => origin, consumeRateLimit: () => ({ allowed: true }) },
        "@/lib/ai/platform-router-config": config,
        "@/lib/ai/platform-runtime": { resolvePlatformProviderCredential: async (_id: string, _url: string, key: string) => { io++; return key; } },
        "@/lib/ai/platform-compatible-transport": { PlatformAiHttpError: class extends Error {}, requestCompatibleModels: async () => ["qwen/example"], requestCompatibleAi: async (_base: string, _key: string, body: unknown) => { captured.push(body); return "private-key must never be echoed"; } },
    }) as { POST: (request: Request) => Promise<{ status: number; data: unknown }> };
    const request = (action: string) => new Request("https://crm.example/api/control/ai/provider", { method: "POST", body: JSON.stringify({ action, baseUrl: "https://api.groq.com/openai/v1", apiKey: "private-key", model: "qwen/example", messages: [{ role: "user", content: "Untrusted customer prompt" }] }) });
    assert.equal((await api.POST(request("models"))).status, 403); assert.equal(io, 0);
    allowed = true; origin = false; assert.equal((await api.POST(request("test"))).status, 403); assert.equal(io, 0);
    origin = true;
    const catalog = await api.POST(request("models")); assert.equal(catalog.status, 200); assert.deepEqual(JSON.parse(JSON.stringify(catalog.data)), { models: ["qwen/example"] });
    const result = await api.POST(request("test")); assert.equal(result.status, 200);
    assert.equal(JSON.stringify(result.data).includes("private-key"), false);
    assert.equal(JSON.stringify(captured).includes("Untrusted customer prompt"), false);
    assert.equal(JSON.stringify(captured).includes("Responde únicamente OK."), true);
});
