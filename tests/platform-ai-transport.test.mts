import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import * as config from "../src/lib/ai/platform-router-config.ts";
import { loadTsModule } from "./helpers/load-ts-module.mts";

function fixture(address = "8.8.8.8", status = 200, payload: unknown = { choices: [{ message: { content: "OK" } }] }, disconnected = false) {
    const calls: Array<{ url: string; options: Record<string, unknown>; body: string }> = [];
    const api = loadTsModule("src/lib/ai/platform-compatible-transport.ts", {
        "server-only": {}, "@/lib/ai/platform-router-config": config,
        "node:dns/promises": { lookup: async () => [{ address, family: address.includes(":") ? 6 : 4 }] },
        "node:https": { request: (url: URL, options: Record<string, unknown>, callback: (response: unknown) => void) => {
            const req = new EventEmitter() as EventEmitter & { end: (body: string) => void };
            req.end = (body: string) => {
                calls.push({ url: url.toString(), options, body });
                queueMicrotask(() => {
                    const response = Object.assign(new EventEmitter(), { statusCode: status, resume() {}, destroy() {} });
                    callback(response);
                    if (disconnected) { response.emit("error", new Error("connection lost")); return; }
                    response.emit("data", Buffer.from(JSON.stringify(payload)));
                    response.emit("end");
                });
            }; return req;
        } },
    }) as { requestCompatibleAi: (url: string, key: string, body: object, signal: AbortSignal) => Promise<string>; requestCompatibleModels: (url: string, key: string, signal: AbortSignal) => Promise<string[]>; isPublicAiAddress: (address: string) => boolean };
    return { api, calls, run: (signal = new AbortController().signal) => api.requestCompatibleAi("https://api.groq.com/openai/v1", "private-key", { model: "example", messages: [{ role: "user", content: "Hola" }] }, signal) };
}

test("compatible transport pins the validated DNS address and never sends keys in URLs or request bodies", async () => {
    const f = fixture(); assert.equal(await f.run(), "OK"); assert.equal(f.calls.length, 1);
    const call = f.calls[0]; assert.equal(call.url, "https://api.groq.com/openai/v1/chat/completions");
    assert.equal(call.url.includes("private-key"), false); assert.equal(call.body.includes("private-key"), false);
    assert.equal((call.options.headers as Record<string, string>).authorization, "Bearer private-key");
    assert.ok(call.options.signal instanceof AbortSignal);
    const lookup = call.options.lookup as (host: string, options: { all: boolean }, cb: (...args: unknown[]) => void) => void;
    lookup("api.groq.com", { all: true }, (_error, addresses) => assert.deepEqual(JSON.parse(JSON.stringify(addresses)), [{ address: "8.8.8.8", family: 4 }]));
});
test("endpoint model discovery uses authenticated GET /models without changing Google's base path", async () => {
    const f = fixture("8.8.8.8", 200, { data: [{ id: "gemini-3.8-flash" }, null, { id: "gemini-3.5-flash-lite" }, { id: "gemini-3.8-flash" }] });
    const models = await f.api.requestCompatibleModels("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", "private-key", new AbortController().signal);
    assert.equal(f.calls[0].url, "https://generativelanguage.googleapis.com/v1beta/openai/models");
    assert.equal(f.calls[0].options.method, "GET");
    assert.deepEqual(JSON.parse(JSON.stringify(models)), ["gemini-3.5-flash-lite", "gemini-3.8-flash"]);
});
test("private DNS resolutions and IPv4-mapped local addresses never receive a request", async () => {
    for (const address of ["127.0.0.1", "10.0.0.4", "169.254.169.254", "172.16.0.1", "192.168.1.1", "100.64.0.1", "::1", "::ffff:127.0.0.1", "fd00::1", "fe80::1"]) {
        const f = fixture(address); await assert.rejects(f.run(), /dirección pública/); assert.equal(f.calls.length, 0);
    }
});
test("redirects are not followed and an already aborted request sends nothing", async () => {
    const redirected = fixture("8.8.8.8", 302); await assert.rejects(redirected.run(), /HTTP 302/); assert.equal(redirected.calls.length, 1);
    const aborted = fixture(), controller = new AbortController(); controller.abort();
    await assert.rejects(aborted.run(controller.signal), /Tiempo de espera/); assert.equal(aborted.calls.length, 0);
});

test("a failed provider disconnecting while its error body drains does not emit an unhandled error", async () => {
    const f = fixture("8.8.8.8", 401, {}, true);
    await assert.rejects(f.run(), /HTTP 401/);
});

test("control AI endpoint checks platform-admin access and origin before exposing or mutating state", async () => {
    let permitted = false, sameOrigin = true, reads = 0, writes = 0;
    const api = loadTsModule("src/app/api/control/ai/route.ts", {
        "next/server": { NextResponse: { json: (data: unknown, init: { status?: number } = {}) => ({ data, status: init.status || 200 }) } },
        "@/lib/platform-admin": { requirePlatformAdmin: async () => { if (!permitted) throw Object.assign(new Error("No autorizado"), { status: 403 }); return { id: "admin" }; } },
        "@/lib/security": { isSameApplicationOrigin: () => sameOrigin },
        "@/lib/control-api-errors": { ControlValidationError: class extends Error {}, controlApiError: (error: { status?: number; message: string }) => ({ status: error.status || 400, message: error.message }) },
        "@/lib/ai/platform-runtime": { getPlatformAiControlState: async () => { reads++; return { router: { providers: [] } }; }, savePlatformAiRuntime: async () => { writes++; return { saved: true }; } },
    }) as { GET: () => Promise<{ status: number }>; PATCH: (request: Request) => Promise<{ status: number }> };
    const request = () => new Request("https://crm.example/api/control/ai", { method: "PATCH", body: JSON.stringify({ chatModel: "openai:gpt-4o-mini" }) });
    assert.equal((await api.GET()).status, 403); assert.equal((await api.PATCH(request())).status, 403); assert.equal(reads + writes, 0);
    permitted = true; sameOrigin = false; assert.equal((await api.PATCH(request())).status, 403); assert.equal(writes, 0);
    sameOrigin = true; assert.equal((await api.GET()).status, 200); assert.equal((await api.PATCH(request())).status, 200); assert.equal(reads, 1); assert.equal(writes, 1);
});
