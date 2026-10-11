import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

type CapturedRequest = { url: string; body: Record<string, unknown> };
function harness(overrides: Record<string, unknown> = {}, compatibleFailures: Record<string, number> = {}) {
    const root = path.resolve(import.meta.dirname, "..");
    const requests: CapturedRequest[] = [];
    const settings = { openaiModel: "gemini:models/gemini-3.1-flash-lite", agentTemperature: 0.3, aiRouterEnabled: false, ...overrides };
    const moduleCache = new Map<string, { exports: Record<string, unknown> }>();
    const silentConsole = { log() {}, warn() {}, error() {} };
    const settingsModule = { SYSTEM_SETTINGS_DEFAULTS: settings, withSettingsDefaults: (value: unknown) => ({ ...settings, ...value as object }) };
    const stubs: Record<string, unknown> = {
        "openai": { __esModule: true, default: class OpenAI {}, toFile: async () => ({}) },
        "@/lib/db": { prisma: { systemSettings: { findFirst: async () => settings } } },
        "@/lib/system-settings": settingsModule,
        "@/lib/system-settings-defaults": settingsModule,
        "@/lib/ai/provider-keys": { resolveAiProviderKey: async (provider: string) => provider === "gemini" ? "fake-test-key" : null },
        "@/lib/ai/platform-runtime": { getPlatformChatModelSelection: async () => settings.openaiModel },
    };
    async function simulatedGoogle(url: string, init?: { body?: string }) {
        if (url.includes("/models?pageSize")) {
            return Response.json({ models: [
                { name: "models/gemini-3.1-flash-lite" }, { name: "models/gemini-3.6-flash" },
                { name: "models/gemini-3.8-flash" }, { name: "models/gemini-2.5-flash" },
            ] });
        }
        const body = JSON.parse(init?.body || "{}") as Record<string, unknown>;
        requests.push({ url, body });
        const configuredStatus = compatibleFailures[new URL(url).hostname];
        if (configuredStatus) return Response.json({ error: { message: "Simulated provider failure" } }, { status: configuredStatus });
        const config = (url.includes(":generateContent") ? body.generationConfig : body) as Record<string, unknown> | undefined;
        const forbidden = ["temperature", "topP", "top_p", "topK", "top_k", "thinkingBudget", "thinking_budget", "candidateCount", "candidate_count"];
        const thinking = config?.thinkingConfig as Record<string, unknown> | undefined;
        if (forbidden.some((key) => config && key in config)
            || (thinking && ("thinkingBudget" in thinking || "thinking_budget" in thinking))) {
            return Response.json({ error: { message: "INVALID_ARGUMENT: deprecated parameter" } }, { status: 400 });
        }
        if (url.includes("gemini-3.8-flash") && thinking?.thinkingLevel === "minimal") {
            return Response.json({ error: { message: "Unsupported thinking level" } }, { status: 400 });
        }
        if (url.includes(":generateContent")) {
            return Response.json({ candidates: [{ content: { parts: [{ text: "Respuesta verificada" }] } }] });
        }
        return Response.json({ choices: [{ message: { content: "Respuesta verificada" } }] });
    }
    function load(filePath: string): Record<string, unknown> {
        if (moduleCache.has(filePath)) return moduleCache.get(filePath)!.exports;
        const loadedModule = { exports: {} as Record<string, unknown> };
        moduleCache.set(filePath, loadedModule);
        const output = ts.transpileModule(readFileSync(filePath, "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
            fileName: filePath,
        }).outputText;
        const sandbox = {
            exports: loadedModule.exports, module: loadedModule,
            require: (name: string) => {
                if (Object.hasOwn(stubs, name)) return stubs[name];
                if (name.startsWith("@/lib/ai/")) return load(path.join(root, "src", name.slice(2)) + ".ts");
                throw new Error("Unexpected dependency in isolated request test: " + name);
            },
            fetch: simulatedGoogle, console: silentConsole,
            process: { env: {} }, setTimeout, clearTimeout, AbortSignal, URL, Buffer,
        };
        vm.runInNewContext(output, sandbox, { filename: filePath });
        return loadedModule.exports;
    }
    const api = load(path.join(root, "src/lib/ai/openai.ts")) as {
        generateCompletion: (messages: unknown[], temperature?: number) => Promise<string>;
        callGeminiGenerateContent: (options: Record<string, unknown>) => Promise<string>;
        extractTextFromImageBufferWithFallback: (buffer: Buffer, mimeType: string) => Promise<string>;
    };
    return { api, requests, root };
}

test("actual chat and OCR paths succeed against an API that rejects deprecated parameters", async () => {
    const { api, requests } = harness();
    assert.equal(await api.generateCompletion([{ role: "user", content: "Hola" }], 0.1), "Respuesta verificada");
    assert.equal(await api.extractTextFromImageBufferWithFallback(Buffer.from("synthetic image"), "image/jpeg"), "Respuesta verificada");
    assert.equal(requests.length, 2);
    for (const { url, body } of requests) {
        assert.ok(url.includes("models/gemini-3.1-flash-lite:generateContent"));
        assert.equal((body.generationConfig as Record<string, unknown>).temperature, undefined);
    }
    assert.ok(JSON.stringify(requests[1].body).includes("c3ludGhldGljIGltYWdl"));
});

test("shared request boundary strips a legacy caller's budget and sampling before fetch", async () => {
    const { api, requests } = harness();
    assert.equal(await api.callGeminiGenerateContent({
        apiKey: "fake-test-key", preferredModel: "gemini-3.8-flash",
        payload: { contents: [{ role: "user", parts: [{ text: "Hola" }] }], generationConfig: {
            temperature: 0.1, topP: 0.9, topK: 20, maxOutputTokens: 512,
            thinkingConfig: { thinkingBudget: 1000, thinkingLevel: "minimal" },
        } },
    }), "Respuesta verificada");
    const config = requests[0].body.generationConfig as Record<string, unknown>;
    assert.equal(config.maxOutputTokens, 512);
    assert.equal((config.thinkingConfig as Record<string, unknown>).thinkingLevel, "low");
});

test("a stale 2.5 Flash model setting cannot invoke that model", async () => {
    const { api, requests } = harness({ openaiModel: "gemini:gemini-2.5-flash" });
    assert.equal(await api.generateCompletion([{ role: "user", content: "Hola" }]), "Respuesta verificada");
    assert.ok(requests.every(({ url }) => !url.includes("gemini-2.5-flash")));
    assert.ok(requests[0].url.includes("gemini-3.1-flash-lite"));
});

test("unavailable configured models fail without silently selecting an older Gemini model", async () => {
    const { api, requests } = harness();
    await assert.rejects(api.callGeminiGenerateContent({
        apiKey: "fake-test-key", preferredModel: "gemini-not-available",
        payload: { contents: [{ role: "user", parts: [{ text: "Hola" }] }] },
    }), /configurado no esta disponible/);
    assert.equal(requests.length, 0);
});

const hasRouter = existsSync(new URL("../src/lib/ai/router-config.ts", import.meta.url));
test("router still tries Groq, experimental and then Gemini in saved order", { skip: !hasRouter }, async () => {
    const { api, requests } = harness({
        aiRouterEnabled: true, aiRouterTimeoutMs: 4000, aiRouterPrimaryEnabled: true, aiRouterFallbackEnabled: false,
        aiRouterCustomProviders: [
            { id: "groq", name: "Groq", enabled: true, baseUrl: "https://api.groq.com/openai/v1", model: "llama-test", apiKey: "fake-groq" },
            { id: "experimental", name: "Experimental", enabled: true, baseUrl: "https://experimental.example/v1", model: "chappie-magic", apiKey: "fake-experimental" },
        ],
        aiRouterOrder: ["groq", "experimental", "primary"],
    }, { "api.groq.com": 429, "experimental.example": 503 });
    assert.equal(await api.generateCompletion([{ role: "user", content: "Hola" }], 0.3), "Respuesta verificada");
    assert.deepEqual(requests.map(({ url }) => new URL(url).hostname), ["api.groq.com", "experimental.example", "generativelanguage.googleapis.com"]);
    assert.equal(requests[0].body.temperature, 0.3);
    assert.equal(requests[1].body.temperature, 0.3);
    assert.equal((requests[2].body.generationConfig as Record<string, unknown>).temperature, undefined);
});

test("custom OpenAI-compatible Gemini requests also succeed with Google's strict validation", { skip: !hasRouter }, async () => {
    const { api, requests } = harness({
        aiRouterEnabled: true, aiRouterTimeoutMs: 4000, aiRouterPrimaryEnabled: false, aiRouterFallbackEnabled: false,
        aiRouterCustomProviders: [
            { id: "google-compatible", enabled: true, baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", model: "gemini-3.6-flash", apiKey: "fake-key" },
        ],
        aiRouterOrder: ["google-compatible"],
    });
    assert.equal(await api.generateCompletion([{ role: "system", content: "Devuelve JSON" }], 0.1), "Respuesta verificada");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.temperature, undefined);
    assert.ok((requests[0].body.messages as Array<{ role: string }>).some(({ role }) => role === "user"));
});
