import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { loadTsModule } from "./helpers/load-ts-module.mts";
import * as policy from "../src/lib/chat-media-policy.ts";
import * as audioPolicy from "../src/lib/whatsapp-audio.ts";
import type { QueuedWebhookPayload } from "../src/lib/tenant-work-queue.ts";

test("tenant QR downloads and reactions use only the matching tenant credential; Meta retrieval authenticates both requests", async () => {
    process.env.MULTITENANT_WUZAPI_BASE_URL = "https://gateway.test";
    process.env.META_APP_ID = "test-app"; process.env.META_APP_SECRET = "test-secret"; process.env.META_EMBEDDED_SIGNUP_CONFIG_ID = "test-config";
    const requests: Array<{ url: string; token: string | null; bearer: string | null; body: Record<string, unknown> }> = [];
    let rejectAudio = false;
    const loadedModule = loadTsModule("src/lib/tenant-channels.ts", {
        "server-only": {}, "@/generated/control-plane": { Prisma: {} },
        "@/lib/whatsapp-audio": audioPolicy,
        "@/lib/control-db": { getControlDb: () => ({ channelConnection: {
            findFirst: async ({ where }: { where: Record<string, unknown> }) => {
                if (where.tenantId !== "a" && where.tenantId !== "b") return null;
                const account = `${where.tenantId}-${where.provider}`;
                if (where.externalAccountId && where.externalAccountId !== account) return null;
                return { externalAccountId: account, secretCiphertext: `test-token-${where.tenantId}`, secretKeyVersion: 1 };
            },
        } }) },
        "@/lib/security": {},
        "@/lib/tenant-channel-secrets": { decryptChannelSecret: (value: string) => value },
        "@/lib/tenant-services/context": {},
        "@/lib/phone": { normalizeMetaRecipient: (s: string) => s, normalizeWuzapiRecipient: (s: string) => s },
    }, { fetch: async (url: string | URL, init: RequestInit) => {
        const headers = new Headers(init.headers);
        requests.push({ url: String(url), token: headers.get("token"), bearer: headers.get("authorization"), body: JSON.parse(String(init.body || "{}")) });
        if (rejectAudio) return Response.json({ success: false, error: "audio rejected" });
        if (String(url).includes("/download")) return Response.json({ data: { Data: "data:image/jpeg;base64,YWJj", Mimetype: "image/jpeg" } });
        if (String(url).includes("graph.facebook.com") && !init.body) return Response.json({ url: "https://lookaside.fbsbx.com/media", mime_type: "image/jpeg" });
        if (String(url).includes("lookaside.fbsbx.com")) return new Response("abc");
        return Response.json({ data: { Id: "reaction-id" } });
    } });
    const download = loadedModule.downloadTenantChannelMedia as (tenantId: string, p: QueuedWebhookPayload) => Promise<{ buffer: Buffer; mimeType: string }>;
    const react = loadedModule.sendTenantChannelReaction as (p: Record<string, unknown>) => Promise<unknown>;
    const qr: QueuedWebhookPayload = { kind: "message", sourceType: "wuzapi", sourceId: "a-WUZAPI", messageType: "image", mediaDownloadKind: "image", mediaDownload: { Url: "https://mmg.whatsapp.net/file", MediaKey: "test-key", FileSHA256: "hash", FileLength: 3, Mimetype: "image/jpeg" } };
    assert.equal((await download("a", qr)).buffer.toString(), "abc");
    assert.equal(requests[0].token, "test-token-a");
    assert.match(requests[0].url, /\/chat\/downloadimage$/);
    const count = requests.length;
    await assert.rejects(download("b", qr), /no pertenece/);
    assert.equal(requests.length, count, "cross-tenant download must not reach the gateway");
    await react({ tenantId: "b", sourceType: "wuzapi", to: "524771234567", providerMessageId: "native-id", reaction: "👍", ownMessage: true });
    assert.equal(requests.at(-1)?.token, "test-token-b");
    assert.equal(requests.at(-1)?.body.Id, "me:native-id");
    await download("a", { kind: "message", sourceType: "meta", sourceId: "a-META_CLOUD", providerMediaId: "media-id" });
    assert.equal(requests.at(-2)?.bearer, "Bearer test-token-a");
    assert.equal(requests.at(-1)?.bearer, "Bearer test-token-a");
    const sendMedia = loadedModule.sendTenantChannelMedia as (p: Record<string, unknown>) => Promise<unknown>;
    await sendMedia({ tenantId: "b", sourceType: "wuzapi", to: "demo", mediaType: "document", dataUrl: "data:application/pdf;base64,YWJj", fileName: "invoice.pdf", mimeType: "application/pdf" });
    assert.equal(requests.at(-1)?.token, "test-token-b");
    assert.equal(requests.at(-1)?.body.Document, "data:application/octet-stream;base64,YWJj");
    assert.equal(requests.at(-1)?.body.MimeType, "application/pdf");
    await sendMedia({ tenantId: "b", sourceType: "wuzapi", to: "demo", mediaType: "audio", dataUrl: "data:audio/mpeg;base64,YWJj", mimeType: "audio/mpeg" });
    assert.equal(requests.at(-1)?.token, "test-token-b");
    assert.equal(requests.at(-1)?.body.Audio, "data:audio/mpeg;base64,YWJj");
    assert.equal(requests.at(-1)?.body.PTT, false, "uploaded MP3 is not a microphone voice note");
    assert.equal(requests.at(-1)?.body.MimeType, "audio/mpeg");
    await sendMedia({ tenantId: "b", sourceType: "wuzapi", to: "demo", mediaType: "audio", dataUrl: "data:audio/ogg;base64,YWJj", mimeType: "audio/ogg" });
    assert.equal(requests.at(-1)?.body.PTT, true);
    assert.equal(requests.at(-1)?.body.MimeType, "audio/ogg; codecs=opus");
    rejectAudio = true;
    await assert.rejects(sendMedia({ tenantId: "b", sourceType: "wuzapi", to: "demo", mediaType: "audio", dataUrl: "data:audio/mpeg;base64,YWJj", mimeType: "audio/mpeg" }), /audio rejected/);
});

test("inbound media stores stable tenant-namespaced files, so retry does not duplicate attachments", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "crm-inbound-media-test-"));
    const calls: string[] = [];
    const loadedModule = loadTsModule("src/lib/tenant-inbound-media.ts", {
        "server-only": {}, "@/lib/chat-media-policy": policy,
        "@/lib/tenant-channels": { downloadTenantChannelMedia: async (tenantId: string) => { calls.push(tenantId); return { buffer: Buffer.from("audio"), mimeType: "audio/ogg" }; } },
    }, { process: { ...process, cwd: () => root } });
    const resolve = loadedModule.resolveTenantInboundMedia as (tenantId: string, eventId: string, p: QueuedWebhookPayload) => Promise<{ mediaUrl?: string }>;
    const p: QueuedWebhookPayload = { kind: "message", sourceType: "wuzapi", sourceId: "channel", messageType: "audio" };
    try {
        const a = await resolve("a", "event", p);
        const retry = await resolve("a", "event", p);
        const b = await resolve("b", "event", p);
        assert.equal(a.mediaUrl, retry.mediaUrl);
        assert.notEqual(a.mediaUrl, b.mediaUrl);
        assert.deepEqual(calls, ["a", "a", "b"]);
        assert.equal((await fs.readdir(path.join(root, "public", "uploads"))).length, 2);
    } finally { assert.ok(path.basename(root).startsWith("crm-inbound-media-test-")); await fs.rm(root, { recursive: true, force: true }); }
});
