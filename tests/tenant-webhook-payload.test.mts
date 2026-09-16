import test from "node:test";
import assert from "node:assert/strict";
import { normalizeWuzapiWebhook } from "../src/lib/tenant-webhook-payload.ts";

test("normaliza texto PascalCase de WuzAPI sin crear placeholders", () => {
    const normalized = normalizeWuzapiWebhook({
        event: {
            Info: {
                ID: "wamid-1",
                IsFromMe: false,
                SenderAlt: "5214794559238@s.whatsapp.net",
                Timestamp: 1_789_500_000,
            },
            PushName: "Cliente",
            Message: {
                EphemeralMessage: {
                    Message: {
                        ExtendedTextMessage: { Text: "Hola" },
                    },
                },
            },
        },
    }, "tenant-instance", "fallback");

    assert.equal(normalized.payload.kind, "message");
    assert.equal(normalized.payload.content, "Hola");
    assert.equal(normalized.payload.phone, "5214794559238");
});

test("ignora eventos de protocolo en vez de mostrarlos como mensajes", () => {
    const normalized = normalizeWuzapiWebhook({
        event: {
            Info: {
                ID: "wamid-2",
                IsFromMe: false,
                SenderAlt: "5214794559238@s.whatsapp.net",
            },
            Message: { ProtocolMessage: { Type: "REVOKE" } },
        },
    }, "tenant-instance", "fallback");

    assert.equal(normalized.payload.kind, "ignored");
});

test("ignora mensajes de grupos aunque SenderAlt sea un telefono directo", () => {
    const normalized = normalizeWuzapiWebhook({
        event: {
            Info: {
                ID: "wamid-group-1",
                IsFromMe: false,
                Chat: "120363000000000000@g.us",
                SenderAlt: "5214794559238@s.whatsapp.net",
            },
            PushName: "Participante",
            Message: { Conversation: "Mensaje del grupo" },
        },
    }, "tenant-instance", "fallback");

    assert.equal(normalized.payload.kind, "ignored");
});

test("descarta el identificador LID y conserva el telefono real del chat", () => {
    const normalized = normalizeWuzapiWebhook({
        event: {
            Info: {
                ID: "wamid-lid-1",
                IsFromMe: false,
                Chat: "5212210148898@s.whatsapp.net",
                SenderAlt: "52221014889899989@lid",
            },
            PushName: "Cliente nuevo",
            Message: { Conversation: "Hola" },
        },
    }, "tenant-instance", "fallback");

    assert.equal(normalized.payload.kind, "message");
    assert.equal(normalized.payload.phone, "5212210148898");
    assert.equal(normalized.payload.content, "Hola");
});

test("acepta JID estructurado y omite LID estructurado", () => {
    const normalized = normalizeWuzapiWebhook({
        event: {
            Info: {
                ID: "wamid-jid-object-1",
                IsFromMe: false,
                Chat: { User: "5213348113566", Server: "s.whatsapp.net" },
                SenderAlt: { User: "999999999999999", Server: "lid" },
            },
            Message: { Conversation: "Buenas tardes" },
        },
    }, "tenant-instance", "fallback");

    assert.equal(normalized.payload.kind, "message");
    assert.equal(normalized.payload.phone, "5213348113566");
});
