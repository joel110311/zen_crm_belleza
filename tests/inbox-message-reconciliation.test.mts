import assert from "node:assert/strict";
import test from "node:test";
import { collapseMessageDuplicates, mergeFetchedMessages, replaceOptimisticMessage, type Message } from "../src/lib/inbox-messages.ts";

const message = (id: string, changes: Partial<Message> = {}): Message => ({
    id, content: "Confirmo mi cita", direction: "outbound", type: "text",
    senderType: "human", senderId: "agent", sourceType: "wuzapi", sourceId: "number-a",
    createdAt: new Date("2026-10-16T12:00:00Z"), ...changes,
});

test("pending sends reconcile in either arrival order, preserving server status and avoiding duplicate bubbles", () => {
    const pending = message("temp-one");
    const saved = message("saved", { status: "delivered" });
    for (const input of [[pending, saved], [saved, pending]]) {
        assert.deepEqual(collapseMessageDuplicates(input), [saved]);
    }
    assert.deepEqual(replaceOptimisticMessage([pending], pending.id, saved), [saved]);
});
test("identical persisted messages are separate sends; providers, senders, media and the 15-second window remain separate", () => {
    const saved = message("saved");
    const distinct = [
        message("second"), message("temp-provider", { sourceType: "meta" }),
        message("temp-number", { sourceId: "number-b" }), message("temp-bot", { senderType: "bot" }),
        message("temp-direction", { direction: "inbound" }), message("temp-type", { type: "image" }),
        message("temp-media", { mediaUrl: "/other.jpg" }), message("temp-file", { mediaFileName: "otro.pdf" }),
        message("temp-content", { content: "Otra respuesta" }), message("temp-later", { createdAt: new Date(saved.createdAt.getTime() + 15_001) }),
    ];
    for (const other of distinct) assert.equal(collapseMessageDuplicates([saved, other]).length, 2, other.id);
});
test("media matching keeps URL query parameters, normalizes origins and includes the exact time boundary", () => {
    const saved = message("saved", { mediaUrl: "https://crm.test/photo.jpg?size=1" });
    const pending = message("temp-one", { mediaUrl: " /photo.jpg?size=1 ", createdAt: new Date(saved.createdAt.getTime() + 15_000) });
    assert.deepEqual(collapseMessageDuplicates([pending, saved]), [saved]);
    assert.equal(collapseMessageDuplicates([saved, { ...pending, mediaUrl: "/photo.jpg?size=2" }]).length, 2);
});
test("replacement of a pending ID does not leave stale aliases or discard a later separate send", () => {
    const pending = message("temp-one"), first = message("saved-a"), second = message("saved-b");
    assert.deepEqual(collapseMessageDuplicates([pending, first, pending, second]), [first, second]);
    assert.deepEqual(collapseMessageDuplicates([pending, { ...pending, id: "temp-two" }, first]), [first]);
});
test("overlapping history pages update statuses and reactions, retain every distinct message, and sort deterministically", () => {
    const first = message("a"), second = message("b"), pending = message("temp-send");
    const updated = { ...second, status: "read", reaction: "❤️" };
    const incoming = message("new", { createdAt: new Date(first.createdAt.getTime() + 17_000), content: "Nuevo" });
    assert.deepEqual(mergeFetchedMessages([first, second], [updated, incoming]), [first, updated, incoming]);
    assert.equal(mergeFetchedMessages([pending], [message("saved")]).length, 1);
    assert.deepEqual(collapseMessageDuplicates([second, first, updated]), [first, updated]);
});
test("a 5,000-message history retains every persisted send and does not mutate the input", () => {
    const history = Array.from({ length: 5000 }, (_, index) => message(`saved-${index}`, { createdAt: new Date(1_700_000_000_000 + index * 17_000) }));
    const snapshot = JSON.stringify(history);
    assert.equal(collapseMessageDuplicates([...history, history[2500]]).length, 5000);
    assert.equal(JSON.stringify(history), snapshot);
});
