import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadTsModule } from "./helpers/load-ts-module.mts";
import * as audioPolicy from "../src/lib/whatsapp-audio.ts";
import * as mediaPolicy from "../src/lib/chat-media-policy.ts";

test("MP3 is non-PTT; Ogg voice notes explicitly declare Opus; success requires a real provider ID", () => {
    assert.deepEqual(audioPolicy.whatsappAudioOptions("data:audio/mpeg;base64,YWJj"), { PTT: false, MimeType: "audio/mpeg" });
    assert.deepEqual(audioPolicy.whatsappAudioOptions("data:audio/ogg;base64,YWJj", "audio/ogg"), { PTT: true, MimeType: "audio/ogg; codecs=opus" });
    assert.equal(audioPolicy.requireProviderMessageId({ Id: "native-id" }), "native-id");
    for (const result of [null, undefined, {}, { Id: null }, { Id: " " }]) assert.throws(() => audioPolicy.requireProviderMessageId(result), /no confirmó/);
});

test("resolving an owned MP3 preserves its bytes and never reconverts it to a voice note", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "crm-mp3-resolution-test-"));
    const filename = `private-t-${mediaPolicy.tenantMediaNamespace("a")}-audio.mp3`;
    const bytes = Buffer.from("test-mp3-payload");
    let ownerChecks = 0;
    try {
        await fs.mkdir(path.join(root, "public", "uploads"), { recursive: true });
        await fs.writeFile(path.join(root, "public", "uploads", filename), bytes);
        const loaded = loadTsModule("src/lib/media-data-url.ts", {
            "@/lib/chat-media-policy": mediaPolicy,
            "@/lib/local-media-access": { assertLocalMediaOwnership: async () => { ownerChecks++; } },
            "@/lib/ffmpeg-runtime": { runMediaFfmpeg: () => { throw new Error("MP3 must not be reconverted"); } },
        }, { process: { ...process, cwd: () => root } });
        const resolve = loaded.resolveMediaToDataUrl as (url: string, mime: string) => Promise<{ dataUrl: string; mimeType: string }>;
        const result = await resolve(`/api/media/${filename}`, "audio/mpeg");
        assert.equal(result.mimeType, "audio/mpeg");
        assert.equal(result.dataUrl, `data:audio/mpeg;base64,${bytes.toString("base64")}`);
        assert.equal(ownerChecks, 1);
    } finally { assert.ok(path.basename(root).startsWith("crm-mp3-resolution-test-")); await fs.rm(root, { recursive: true, force: true }); }
});

test("outbound messages remain failed, not sent, if WhatsApp rejects or does not acknowledge them", async () => {
    const updates: Array<{ status?: string; providerMessageId?: string }> = [];
    let result: { Id?: string | null } | null = { Id: null };
    let phone: string | null = "524771234567";
    let sends = 0;
    const loaded = loadTsModule("src/lib/outbound-messages.ts", {
        "@/lib/db": { prisma: {
            conversation: { findUnique: async () => ({ id: "chat", contact: { phone }, sourceType: "wuzapi", sourceId: "channel" }), update: async () => ({}) },
            message: { create: async () => ({ id: "message" }), update: async ({ data }: { data: { status?: string; providerMessageId?: string } }) => { updates.push(data); return { id: "message", ...data }; } },
        } },
        "@/lib/media-data-url": { resolveMediaToDataUrl: async () => ({ dataUrl: "data:audio/mpeg;base64,YWJj", mimeType: "audio/mpeg", fileName: "audio.mp3" }) },
        "@/lib/media-url": {},
        "@/lib/message-source": { normalizeMessageSourceType: () => "wuzapi" },
        "@/lib/system-settings": { getSystemSettingsOrDefaults: async () => ({}) },
        "@/lib/source-conversations": {},
        "@/lib/channel-delivery": { sendChannelMedia: async () => { sends++; return result; } },
        "@/lib/billing/chatbot-usage": {},
        "@/lib/user-assignment": { resolveAssignableTenantUserId: async () => null },
        "@/lib/whatsapp-audio": audioPolicy,
    });
    const send = loaded.sendOutboundConversationMessage as (params: Record<string, unknown>) => Promise<unknown>;
    const params = { conversationId: "chat", type: "audio", mediaUrl: "/api/media/audio.mp3", mediaType: "audio/mpeg" };
    await assert.rejects(send(params), /no confirmó/);
    assert.equal(JSON.stringify(updates), JSON.stringify([{ status: "failed" }]));
    updates.length = 0; result = { Id: "native-id" };
    await send(params);
    assert.equal(JSON.stringify(updates), JSON.stringify([{ status: "sent", providerMessageId: "native-id" }]));
    updates.length = 0; phone = null;
    await assert.rejects(send(params), /teléfono válido/);
    assert.equal(JSON.stringify(updates), JSON.stringify([{ status: "failed" }]));
    assert.equal(sends, 2, "missing phone must never issue a WhatsApp send");
});
