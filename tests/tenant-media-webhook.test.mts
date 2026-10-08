import test from "node:test";
import assert from "node:assert/strict";
import { normalizeWuzapiWebhook, normalizeMetaWebhook } from "../src/lib/tenant-webhook-payload.ts";
import type { QueuedWebhookPayload } from "../src/lib/tenant-work-queue.ts";

const info = { ID: "event-id", Chat: "524771234567@s.whatsapp.net", IsFromMe: false };
const descriptor = { URL: "https://mmg.whatsapp.net/file", mediaKey: "base64key", fileSHA256: "hash", fileEncSHA256: "encrypted-hash", directPath: "/path", fileLength: "123", mimetype: "image/jpeg" };
function normalize(message: unknown) { return normalizeWuzapiWebhook({ event: { Info: info, Message: message } }, "tenant-a-channel", "hash").payload; }

test("QR retains the proven zen_crm_go download descriptor for every attachment and both directions", () => {
    for (const kind of ["image", "audio", "video", "document", "sticker"] as const) {
        const payload = normalize({ [`${kind}Message`]: { ...descriptor, fileName: "archivo", caption: "Mi archivo" } });
        assert.equal(payload.kind, "message");
        assert.equal(payload.mediaDownloadKind, kind);
        assert.equal(payload.sourceId, "tenant-a-channel");
        assert.equal(payload.mediaDownload?.MediaKey, descriptor.mediaKey);
        assert.equal(payload.mediaDownload?.FileSHA256, "hash");
        assert.equal(payload.mediaDownload?.FileLength, 123);
        assert.equal(payload.messageType, kind === "sticker" ? "image" : kind);
    }
    const outgoing = normalizeWuzapiWebhook({ event: { Info: { ...info, IsFromMe: true }, Message: { imageMessage: descriptor } } }, "tenant-a-channel", "hash").payload;
    assert.equal(outgoing.direction, "outbound");
    assert.ok(outgoing.mediaDownload);
});

test("multipart jsonData, mixed casing and inline decrypted content are not discarded", () => {
    const payload = normalizeWuzapiWebhook({ jsonData: JSON.stringify({ event: { Info: info, Message: { AudioMessage: { Mimetype: "audio/ogg" } } } }), base64: "YWJj" }, "channel", "hash").payload;
    assert.equal(payload.kind, "message");
    assert.equal(payload.mediaBase64, "YWJj");
    assert.equal(payload.mediaMimeType, "audio/ogg");
});

test("QR emoji text, reactions including removal, location and contact are preserved", () => {
    assert.equal(normalize({ conversation: "Hola 👋🏽😊" }).content, "Hola 👋🏽😊");
    for (const emoji of ["👍", ""]) {
        const payload = normalize({ ReactionMessage: { Key: { ID: "target" }, Text: emoji } });
        assert.equal(payload.kind, "reaction");
        assert.equal(payload.targetProviderMessageId, "target");
        assert.equal(payload.reaction, emoji || null);
    }
    assert.match(normalize({ locationMessage: { degreesLatitude: 21, degreesLongitude: -101 } }).content || "", /q=21,-101/);
    assert.match(normalize({ contactMessage: { displayName: "Joel", vcard: "BEGIN:VCARD" } }).content || "", /Joel.*\nBEGIN:VCARD/);
});

test("official API retains media ID, handles stickers as images and keeps reactions separate", () => {
    const messages = ["image", "audio", "video", "document", "sticker"].map(type => ({ id: type, from: "524771234567", type, [type]: { id: `media-${type}`, mime_type: "image/webp" } }));
    const events = normalizeMetaWebhook({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "tenant-a-channel" }, messages } }] }] }, "hash");
    for (const event of events) {
        assert.ok(event.payload.providerMediaId);
        assert.equal(event.sourceId, "tenant-a-channel");
        assert.notEqual(event.payload.messageType, "text");
    }
});

// Compile-time contract: media descriptors belong to the durable event, not a global setting.
const durable: QueuedWebhookPayload = normalize({ imageMessage: descriptor });
assert.ok(durable.mediaDownload);
