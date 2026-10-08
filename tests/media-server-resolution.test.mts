import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { loadTsModule } from "./helpers/load-ts-module.mts";
import * as policy from "../src/lib/chat-media-policy.ts";

test("QR resolution and AI transcription read owned local /api/media files, not the login page", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "crm-media-resolution-test-"));
    const filename = `private-t-${policy.tenantMediaNamespace("a")}-image.jpg`;
    const checks: string[] = [];
    const mocks = {
        "@/lib/chat-media-policy": policy,
        "@/lib/local-media-access": { assertLocalMediaOwnership: async (name: string) => { checks.push(name); } },
        "@/lib/ffmpeg-runtime": { runMediaFfmpeg: async () => {} },
    };
    const globals = { process: { ...process, cwd: () => root, env: { APP_BASE_URL: "https://app.test" } }, fetch: () => { throw new Error("must_read_disk_not_http"); } };
    try {
        await fs.mkdir(path.join(root, "public", "uploads"), { recursive: true });
        await fs.writeFile(path.join(root, "public", "uploads", filename), Buffer.from("image-bytes"));
        const resolved = loadTsModule("src/lib/media-data-url.ts", mocks, globals).resolveMediaToDataUrl as (url: string, type: string) => Promise<{ dataUrl: string }>;
        assert.equal((await resolved(`https://app.test/api/media/${filename}`, "image/jpeg")).dataUrl, "data:image/jpeg;base64,aW1hZ2UtYnl0ZXM=");
        const ai = loadTsModule("src/lib/ai/media-understanding.ts", {
            ...mocks, "@/lib/brain/knowledge": {}, "@/lib/ai/openai": {}, "@/lib/db": {}, "@/lib/ai/models": {}, "@/lib/ai/provider-keys": {},
        }, globals).readMediaBuffer as (url: string) => Promise<Buffer>;
        assert.equal((await ai(`/api/media/${filename}`)).toString(), "image-bytes");
        assert.deepEqual(checks, [filename, filename]);
    } finally { assert.ok(path.basename(root).startsWith("crm-media-resolution-test-")); await fs.rm(root, { recursive: true, force: true }); }
});

test("official media URLs are signed only after owner validation; QR and reactions stay tenant-routed", async () => {
    process.env.AUTH_SECRET = "test-only-delivery-signing-secret-not-a-real-key";
    const calls: Array<Record<string, unknown>> = [];
    let denyOwner = false;
    const filename = `private-t-${policy.tenantMediaNamespace("a")}-file.mp4`;
    const loaded = loadTsModule("src/lib/channel-delivery.ts", {
        "server-only": {}, "@/lib/chat-media-policy": policy,
        "@/lib/local-media-access": { assertLocalMediaOwnership: async () => { if (denyOwner) throw new Error("otro negocio"); } },
        "@/lib/active-tenant-context": { getActiveTenantRuntimeContext: async () => ({ tenantId: "a" }) },
        "@/lib/routed-prisma": { getScopedTenantId: () => null },
        "@/lib/multitenant-features": { isMultitenantRuntimeEnabled: () => true },
        "@/lib/meta-whatsapp": { sendMetaMediaMessage: () => { throw new Error("global credentials must not be used"); } },
        "@/lib/wuzapi": { sendWuzapiMediaMessage: () => { throw new Error("global credentials must not be used"); } },
        "@/lib/tenant-channels": {
            sendTenantChannelMedia: async (params: Record<string, unknown>) => { calls.push(params); return { Id: "provider-id" }; },
            sendTenantChannelReaction: async (params: Record<string, unknown>) => { calls.push(params); },
        },
    }, { process: { ...process, env: { ...process.env, APP_BASE_URL: "https://app.test" } } });
    const send = loaded.sendChannelMedia as (params: Record<string, unknown>) => Promise<unknown>;
    const react = loaded.sendChannelReaction as (params: Record<string, unknown>) => Promise<unknown>;
    await send({ sourceType: "meta", to: "demo", mediaType: "video", link: `https://app.test/api/media/${filename}` });
    assert.equal(calls[0].tenantId, "a");
    assert.equal(policy.verifyMediaDownload(filename, new URL(String(calls[0].link)).searchParams), true);
    denyOwner = true;
    await assert.rejects(send({ sourceType: "meta", to: "demo", mediaType: "video", link: `https://app.test/api/media/${filename}` }), /otro negocio/);
    assert.equal(calls.length, 1);
    await send({ sourceType: "wuzapi", to: "demo", mediaType: "image", dataUrl: "data:image/jpeg;base64,YWJj" });
    await react({ sourceType: "wuzapi", to: "demo", providerMessageId: "native-id", reaction: "👍" });
    assert.equal(calls[1].tenantId, "a"); assert.equal(calls[2].tenantId, "a");
});
