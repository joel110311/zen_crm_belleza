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
