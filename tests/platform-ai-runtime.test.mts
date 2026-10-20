import assert from "node:assert/strict";
import test from "node:test";
import * as config from "../src/lib/ai/platform-router-config.ts";
import * as models from "../src/lib/ai/models.ts";
import { loadTsModule } from "./helpers/load-ts-module.mts";

function fixture() {
    let stored: { value: Record<string, unknown>; updatedAt: Date } | null = null;
    const audits: unknown[] = [];
    const env = { TENANT_CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString("base64"), MULTITENANT_RUNTIME_ENABLED: "true", ALLOW_ENV_AI_FALLBACK: "true", GEMINI_API_KEY: "env-gemini-secret" };
    const secrets = loadTsModule("src/lib/ai/platform-ai-secrets.ts", { "server-only": {} }, { process: { env } });
    const table = {
        findUnique: async () => stored,
        create: async ({ data }: { data: { value: Record<string, unknown> } }) => { stored = { value: structuredClone(data.value), updatedAt: new Date(1) }; },
        updateMany: async ({ data, where }: { data: { value: Record<string, unknown> }; where: { updatedAt: Date } }) => {
            if (stored?.updatedAt !== where.updatedAt) return { count: 0 };
            stored = { value: structuredClone(data.value), updatedAt: new Date((stored?.updatedAt.getTime() || 0) + 1) }; return { count: 1 };
        },
    };
    const db = { platformRuntimeSetting: table, auditLog: { create: async (data: unknown) => { audits.push(data); } }, $transaction: async (fn: (tx: unknown) => unknown) => fn(db) };
    const api = loadTsModule("src/lib/ai/platform-runtime.ts", {
        "server-only": {}, "@/lib/control-db": { getControlDb: () => db }, "@/lib/ai/models": models,
        "@/lib/control-validation-error": { ControlValidationError: class extends Error {} },
        "@/lib/ai/platform-router-config": config, "@/lib/ai/platform-ai-secrets": secrets,
    }, { process: { env }, console: { warn() {} } }) as {
        savePlatformAiRuntime: (body: Record<string, unknown>, actor: string) => Promise<unknown>;
        getPlatformAiControlState: () => Promise<Record<string, unknown>>;
        getPlatformAiRouterRuntime: () => Promise<{ router: { providers: Array<{ apiKey: string }> } }>;
        resolvePlatformProviderCredential: (id: string, baseUrl: string, draftKey: string) => Promise<string>;
    };
    const input = (key = "private-groq-key") => ({ chatModel: models.GEMINI_ROUTER_MODEL_ID, revision: 0, router: {
        enabled: true, timeoutMs: 4000, primaryEnabled: true, fallbackEnabled: false, order: ["groq", "primary", "fallback"],
        providers: [{ id: "groq", name: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "qwen/example", enabled: true, apiKey: key }],
    } });
    return { api, input, env, audits, row: () => stored?.value, table };
}

test("platform provider keys are encrypted, absent from public state/audits, and read only by runtime", async () => {
    const f = fixture(); await f.api.savePlatformAiRuntime(f.input(), "admin");
    assert.equal(JSON.stringify(f.row()).includes("private-groq-key"), false);
    const view = await f.api.getPlatformAiControlState();
    assert.equal(JSON.stringify(view).includes("Ciphertext"), false);
    assert.equal(JSON.stringify(view).includes("private-groq-key"), false);
    assert.equal(JSON.stringify(f.audits).includes("private-groq-key"), false);
    assert.equal((view.router as config.PlatformAiRouterView).providers[0].apiKeyConfigured, true);
    assert.equal((await f.api.getPlatformAiRouterRuntime()).router.providers[0].apiKey, "private-groq-key");
});

test("blank key preserves its secret; stale forms and changed destinations cannot silently reuse it", async () => {
    const f = fixture(); await f.api.savePlatformAiRuntime(f.input(), "admin");
    const input = f.input(""); input.revision = 1;
    await f.api.savePlatformAiRuntime(input, "admin");
    assert.equal((await f.api.getPlatformAiRouterRuntime()).router.providers[0].apiKey, "private-groq-key");
    await assert.rejects(f.api.savePlatformAiRuntime(input, "admin"), /otra sesión/);
    input.revision = 2; input.router.providers[0].baseUrl = "https://another.example/v1";
    await assert.rejects(f.api.savePlatformAiRuntime(input, "admin"), /vuelve a capturarla/);
    input.router.providers[0].apiKey = "new-explicit-key";
    await f.api.savePlatformAiRuntime(input, "admin");
    assert.equal((await f.api.getPlatformAiRouterRuntime()).router.providers[0].apiKey, "new-explicit-key");
});

test("old model-only control action preserves the global router and increments its revision", async () => {
    const f = fixture(); await f.api.savePlatformAiRuntime(f.input(), "admin");
    await f.api.savePlatformAiRuntime({ chatModel: "openai:gpt-4o-mini" }, "admin");
    assert.equal((await f.api.getPlatformAiRouterRuntime()).router.providers[0].apiKey, "private-groq-key");
    assert.equal(f.row()?.revision, 2);
});

test("invalid and unconfigured providers are rejected; removing a disabled key removes its ciphertext", async () => {
    const f = fixture(); const empty = f.input("");
    await assert.rejects(f.api.savePlatformAiRuntime(empty, "admin"), /clave/);
    const duplicate = f.input(); duplicate.router.providers.push({ ...duplicate.router.providers[0] });
    await assert.rejects(f.api.savePlatformAiRuntime(duplicate, "admin"), /únicos/);
    const privateUrl = f.input(); privateUrl.router.providers[0].baseUrl = "https://127.0.0.1/v1";
    await assert.rejects(f.api.savePlatformAiRuntime(privateUrl, "admin"), /HTTPS pública/);
    await f.api.savePlatformAiRuntime(f.input(), "admin");
    const clear = f.input(""); clear.revision = 1; clear.router.providers[0].enabled = false;
    Object.assign(clear.router.providers[0], { clearApiKey: true });
    await f.api.savePlatformAiRuntime(clear, "admin");
    assert.equal(JSON.stringify(f.row()).includes("apiKeyCiphertext"), false);
});

test("runtime fails closed on control DB failure and never substitutes an implicit provider", async () => {
    const f = fixture(); f.table.findUnique = async () => { throw new Error("DB unavailable"); };
    await assert.rejects(f.api.getPlatformAiRouterRuntime(), /DB unavailable/);
});

test("diagnostics reuse masked credentials only for the saved endpoint, while a model change preserves the same account", async () => {
    const f = fixture(); await f.api.savePlatformAiRuntime(f.input(), "admin");
    assert.equal(await f.api.resolvePlatformProviderCredential("groq", "https://api.groq.com/openai/v1", ""), "private-groq-key");
    await assert.rejects(f.api.resolvePlatformProviderCredential("groq", "https://another.example/v1", ""), /Captura una clave/);
    const input = f.input(""); input.revision = 1; input.router.providers[0].model = "qwen/another-model";
    await f.api.savePlatformAiRuntime(input, "admin");
    assert.equal((await f.api.getPlatformAiRouterRuntime()).router.providers[0].apiKey, "private-groq-key");
});

test("compatible URLs preserve Google paths and reject credentials, internal hosts and query parameters", () => {
    assert.equal(config.compatibleChatEndpoint("https://generativelanguage.googleapis.com/v1beta/openai/"), "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    assert.equal(config.compatibleChatEndpoint("https://api.groq.com/openai/v1/chat/completions"), "https://api.groq.com/openai/v1/chat/completions");
    for (const value of ["http://api.example/v1", "https://localhost/v1", "https://127.0.0.1/v1", "https://[::1]/v1", "https://api.example/v1?key=private", "https://user:password@api.example/v1", "https://host.local/v1"]) assert.throws(() => config.compatibleChatEndpoint(value));
});
