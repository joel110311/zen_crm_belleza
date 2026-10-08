import test from "node:test";
import assert from "node:assert/strict";
import { persistWuzapiOutboundEcho, type OutboundEchoDependencies } from "../src/lib/wuzapi-outbound-echo.ts";
import { sendTrackedBotMessage } from "../src/lib/tracked-bot-delivery.ts";

type Message = { id: string; conversationId: string; content: string; direction: string; type: string; senderType: string | null; sourceType: string; providerMessageId: string | null; status: string; createdAt: Date; mediaFileName?: string | null };
function fixture() {
    const messages: Message[] = [];
    const conversation = { id: "original-chat", botActive: true, status: "active" };
    let contact: { id: string; name: string | null } | null = { id: "original-contact", name: "Cliente" };
    const resolved: unknown[] = [];
    const db = {
        conversation: {
            findUnique: async () => conversation,
            update: async ({ data }: { data: object }) => Object.assign(conversation, data),
        },
        contact: {
            create: async ({ data }: { data: { name?: string } }) => (contact = { id: "new-contact", name: data.name || null }),
            update: async ({ data }: { data: object }) => Object.assign(contact!, data),
        },
        message: {
            create: async ({ data }: { data: Partial<Message> }) => {
                const message = { providerMessageId: null, createdAt: new Date(), id: `message-${messages.length}`, ...data } as Message;
                messages.push(message); return message;
            },
            findFirst: async ({ where }: { where: { providerMessageId?: string | null; direction: string; conversationId?: string; sourceType: string; type?: string; content?: { in: string[] }; OR?: { status: string; createdAt: { gte: Date } }[] } }) => {
                return messages.find((m) => m.providerMessageId === where.providerMessageId && m.sourceType === where.sourceType && m.direction === where.direction
                    && (!where.conversationId || m.conversationId === where.conversationId)
                    && (!where.type || m.type === where.type)
                    && (!where.content || where.content.in.includes(m.content))
                    && (!where.OR || where.OR.some((w) => m.status === w.status && m.createdAt >= w.createdAt.gte))) || null;
            },
            update: async ({ where, data }: { where: { id: string }; data: object }) => Object.assign(messages.find((m) => m.id === where.id)!, data),
            updateMany: async ({ where, data }: { where: { id: string; status: string }; data: object }) => {
                const matching = messages.filter((m) => m.id === where.id && m.status === where.status);
                matching.forEach((m) => Object.assign(m, data)); return { count: matching.length };
            },
        },
    } as unknown as OutboundEchoDependencies["db"];
    const deps: OutboundEchoDependencies = {
        db,
        findContact: async (phones) => { resolved.push(phones); return contact; },
        findConversation: async (params) => { resolved.push(params); if (!messages.length && !contact?.name) conversation.botActive = params.defaults.botActive; return conversation; },
    };
    const echo = (providerMessageId = "phone-id", content = "Alan", media?: { type: string }) => persistWuzapiOutboundEcho({
        phoneCandidates: ["5214771737217"], content, sourceId: "instance-123", providerMessageId, media,
    }, deps);
    return { db, deps, echo, messages, conversation, resolved, noContact: () => { contact = null; } };
}

test("un envio desde celular reutiliza el chat, se registra humano y pausa la IA; reintento no duplica", async () => {
    const f = fixture();
    const result = await f.echo();
    assert.equal(result.conversationId, "original-chat");
    assert.equal(f.messages[0].direction, "outbound");
    assert.equal(f.messages[0].senderType, "human");
    assert.equal(f.conversation.botActive, false);
    assert.deepEqual(f.resolved[0], ["5214771737217"]);
    assert.deepEqual(f.resolved[1], { contactId: "original-contact", sourceType: "wuzapi", sourceId: "instance-123", defaults: { botActive: false } });
    await f.echo();
    assert.equal(f.messages.length, 1);
});
test("nuevo contacto iniciado desde el celular queda con chatbot deshabilitado", async () => {
    const f = fixture(); f.noContact();
    await f.echo();
    assert.equal(f.conversation.botActive, false);
    assert.equal(f.messages.length, 1);
});
test("eco inmediato de un bot sin ID todavia confirma el pendiente y no pausa ni duplica", async () => {
    const f = fixture();
    await sendTrackedBotMessage({
        db: f.db, data: { conversationId: "original-chat", content: "Hola", type: "text", sourceType: "wuzapi" },
        send: async () => {
            assert.equal(f.messages.length, 1);
            assert.equal(f.messages[0].senderType, "bot");
            assert.equal(f.messages[0].status, "sending");
            await f.echo("bot-id", "Hola");
            return { Id: "bot-id" };
        },
    });
    assert.equal(f.messages.length, 1);
    assert.equal(f.conversation.botActive, true);
    assert.equal(f.messages[0].providerMessageId, "bot-id");
    f.messages[0].status = "read";
    await f.echo("bot-id", "Hola");
    assert.equal(f.messages[0].status, "read");
    assert.equal(f.conversation.botActive, true);
});
test("eco de media automatica reconoce placeholders en español y conserva modo bot", async () => {
    const f = fixture();
    await sendTrackedBotMessage({
        db: f.db, data: { conversationId: "original-chat", content: "[image]", type: "image", sourceType: "wuzapi", mediaUrl: "/foto.jpg" },
        send: async () => { await f.echo("image-id", "[Imagen]", { type: "image" }); return { Id: "image-id" }; },
    });
    assert.equal(f.messages.length, 1);
    assert.equal(f.conversation.botActive, true);
});
test("pendiente fallido no se confunde con un mensaje humano posterior de igual texto", async () => {
    const f = fixture();
    await assert.rejects(sendTrackedBotMessage({
        db: f.db, data: { conversationId: "original-chat", content: "Alan", type: "text", sourceType: "wuzapi" },
        send: async () => { throw new Error("transport failed"); },
    }));
    assert.equal(f.messages.length, 1);
    assert.equal(f.messages[0].status, "failed");
    await f.echo();
    assert.equal(f.messages.length, 2);
    assert.equal(f.messages[1].senderType, "human");
    assert.equal(f.conversation.botActive, false);
});
test("no envia respuesta generada si el humano ya pauso el chat", async () => {
    const f = fixture(); f.conversation.botActive = false;
    const result = await sendTrackedBotMessage({
        db: f.db, data: { conversationId: "original-chat", content: "Hola", type: "text" },
        send: async () => { assert.fail("no debe enviar"); },
    });
    assert.equal(result, null);
    assert.equal(f.messages.length, 0);
});
