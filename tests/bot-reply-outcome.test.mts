import assert from "node:assert/strict";
import test from "node:test";

import {
    hasNewSentCustomerBotText,
    isSentCustomerBotText,
    resolveBotBatchCompletion,
} from "../src/lib/bot-reply-outcome.ts";
import { hasExplicitCompanyDisclosure } from "../src/lib/contact-enrichment-guards.ts";

test("an internal system note never counts as a customer reply", () => {
    assert.equal(isSentCustomerBotText({
        id: "system-note",
        direction: "outbound",
        type: "system",
        senderType: "system",
        status: "sent",
    }), false);
});

test("a newly sent bot text counts as a customer reply", () => {
    const before = {
        id: "old-reply",
        direction: "outbound",
        type: "text",
        senderType: "bot",
        status: "sent",
    };
    const after = { ...before, id: "new-reply" };

    assert.equal(hasNewSentCustomerBotText(before, after), true);
    assert.equal(hasNewSentCustomerBotText(after, after), false);
});

test("delivery receipts do not hide an already sent bot reply", () => {
    assert.equal(isSentCustomerBotText({
        id: "delivered-reply",
        direction: "outbound",
        type: "text",
        senderType: "bot",
        status: "delivered",
    }), true);
    assert.equal(isSentCustomerBotText({
        id: "read-reply",
        direction: "outbound",
        type: "text",
        senderType: "bot",
        status: "read",
    }), true);
});

test("a newer pending inbound supersedes an unanswered batch", () => {
    assert.equal(resolveBotBatchCompletion({
        sentCustomerReply: false,
        botActive: true,
        hasNewerPendingInbound: true,
    }), "superseded");
});

test("an unanswered active batch must retry", () => {
    assert.equal(resolveBotBatchCompletion({
        sentCustomerReply: false,
        botActive: true,
        hasNewerPendingInbound: false,
    }), "retry");
});

test("an intentionally disabled bot may close the batch", () => {
    assert.equal(resolveBotBatchCompletion({
        sentCustomerReply: false,
        botActive: false,
        hasNewerPendingInbound: false,
    }), "disabled");
});

test("a product choice and location are not treated as a company", () => {
    assert.equal(hasExplicitCompanyDisclosure("Audiorítmica\nEstado de México"), false);
});

test("an explicitly disclosed company is eligible for enrichment", () => {
    assert.equal(hasExplicitCompanyDisclosure("Mi empresa se llama Eventos Diana"), true);
    assert.equal(hasExplicitCompanyDisclosure("Trabajo en Eventos Diana"), true);
});
