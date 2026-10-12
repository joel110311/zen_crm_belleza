import assert from "node:assert/strict";
import test from "node:test";
import { loadTsModule } from "./helpers/load-ts-module.mts";
import { requireProviderMessageId } from "../src/lib/whatsapp-audio.ts";

test("exhausted chatbot blocks the actual outbound send while manual replies still work", async () => {
    let exhausted = true;
    let providerCalls = 0;
    let meteredCalls = 0;
    const states: string[] = [];
    const mod = loadTsModule("src/lib/outbound-messages.ts", {
        "@/lib/db": { prisma: {
            conversation: { findUnique: async () => ({ id: "chat", sourceType: "wuzapi", sourceId: "channel", contact: { phone: "524771234567" } }), update: async () => ({}) },
            message: { create: async () => ({ id: "message" }), updateMany: async ({ data }: { data: { status: string } }) => { states.push(data.status); }, update: async () => ({ id: "message" }) },
        } },
        "@/lib/media-data-url": {}, "@/lib/media-url": {}, "@/lib/source-conversations": {},
        "@/lib/message-source": { normalizeMessageSourceType: () => "wuzapi" },
        "@/lib/system-settings": { getSystemSettingsOrDefaults: async () => ({}) },
        "@/lib/channel-delivery": { sendChannelText: async () => { providerCalls++; return { Id: "provider" }; } },
        "@/lib/billing/chatbot-usage": { withChatbotReplyUsage: async (id: string, send: () => Promise<unknown>) => {
            assert.equal(id, "message"); meteredCalls++;
            if (exhausted) throw new Error("Cupo agotado");
            return send();
        } },
        "@/lib/user-assignment": { resolveAssignableTenantUserId: async () => null },
        "@/lib/whatsapp-audio": { requireProviderMessageId },
    });
    const send = mod.sendOutboundConversationMessage as (props: { conversationId: string; content: string; senderType: string }) => Promise<unknown>;
    await assert.rejects(() => send({ conversationId: "chat", content: "Automático", senderType: "bot" }), /Cupo agotado/);
    assert.equal(providerCalls, 0);
    assert.deepEqual(states, ["failed"]);
    await send({ conversationId: "chat", content: "Manual", senderType: "human" });
    assert.equal(providerCalls, 1);
    assert.equal(meteredCalls, 1);
    exhausted = false;
    await send({ conversationId: "chat", content: "Automático", senderType: "bot" });
    assert.equal(providerCalls, 2);
    assert.equal(meteredCalls, 2);
});

test("tracked automation passes its persisted message ID to the metered sender", async () => {
    const mod = loadTsModule("src/lib/tracked-bot-delivery.ts", { "./whatsapp-audio.ts": { requireProviderMessageId } });
    let botActive = true;
    let created = false;
    let sends = 0;
    const props = {
        db: {
            conversation: { findUnique: async () => ({ botActive, status: "active", sourceType: "wuzapi" }) },
            message: { create: async () => { created = true; return { id: "persisted-id" }; }, updateMany: async () => ({}), update: async () => ({}) },
        },
        data: { conversationId: "chat", content: "Hola" },
        send: async (id: string) => { assert.ok(created); assert.equal(id, "persisted-id"); sends++; return { Id: "provider" }; },
    };
    const send = mod.sendTrackedBotMessage as (value: typeof props) => Promise<unknown>;
    await send(props);
    botActive = false;
    assert.equal(await send(props), null);
    assert.equal(sends, 1);
});
