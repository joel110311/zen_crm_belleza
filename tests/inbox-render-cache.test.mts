import test from "node:test";
import assert from "node:assert/strict";
import { inboxRenderHarness } from "./helpers/inbox-render-harness.mts";

test("typing and attachment state do not reconstruct 5,000 chat rows or 1,000 existing message rows", () => {
    const harness = inboxRenderHarness("src/app/dashboard/inbox/page.tsx", 5000, 1000);
    harness.render(); assert.ok(harness.counters.phoneFormats >= 5000); assert.ok(harness.counters.dateFormats >= 1000);
    for (const text of ["H", "Ho", "Hola"]) {
        harness.state.inputText = text; harness.render();
        assert.ok(harness.counters.phoneFormats <= 1); assert.equal(harness.counters.dateFormats, 0);
    }
    harness.state.pendingFile = { url: "/test.pdf", fileName: "test.pdf", mimeType: "application/pdf", mediaCategory: "document" };
    harness.render(); assert.ok(harness.counters.phoneFormats <= 1); assert.equal(harness.counters.dateFormats, 0);
});
test("search, incoming messages and unread badges still invalidate their affected rows", () => {
    const harness = inboxRenderHarness("src/app/dashboard/inbox/page.tsx", 300, 75); harness.render();
    harness.state.searchQuery = "Cliente 20"; harness.render(); assert.ok(harness.counters.phoneFormats > 0);
    harness.state.unreadCounts = { "c-20": 3 }; harness.render(); assert.ok(harness.counters.phoneFormats > 0);
    harness.state.messages = [...harness.state.messages as unknown[], { ...(harness.state.messages as object[])[0], id: "new", content: "Nuevo mensaje", createdAt: new Date() }];
    harness.render(); assert.ok(harness.counters.dateFormats >= 76);
});
