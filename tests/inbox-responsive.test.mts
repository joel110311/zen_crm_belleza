import assert from "node:assert/strict";
import test from "node:test";
import {
  switchConversationDraft,
  forwardMessagePayload,
  isActiveConversationResult,
  recoverFailedConversationDraft,
  matchesConversationSearch,
} from "../src/lib/inbox-workspace.ts";
const empty: { text: string; file: unknown; reply: unknown } = {
  text: "",
  file: null,
  reply: null,
};
test("switching clients does not carry a draft to a different recipient", () => {
  const cache = new Map();
  const ana = {
    text: "Cita de Ana",
    file: { url: "/media/ana.pdf" },
    reply: { id: "ana-message" },
  };
  assert.deepEqual(
    switchConversationDraft(cache, "ana", "maria", ana, empty),
    empty,
  );
  const maria = { text: "Cita de María", file: null, reply: null };
  assert.deepEqual(
    switchConversationDraft(cache, "maria", "ana", maria, empty),
    ana,
  );
  assert.deepEqual(cache.get("maria"), maria);
});
test("returning to the list preserves a draft for its conversation", () => {
  const cache = new Map();
  const draft = { text: "Pendiente", file: null, reply: null };
  assert.equal(switchConversationDraft(cache, "a", null, draft, empty), empty);
  assert.equal(switchConversationDraft(cache, null, "a", empty, empty), draft);
});
test("a cleared or sent draft does not reappear when returning to the conversation", () => {
  const cache = new Map([["a", { text: "Anterior", file: null, reply: null }]]);
  switchConversationDraft(cache, "a", "b", empty, empty);
  assert.equal(switchConversationDraft(cache, "b", "a", empty, empty), empty);
});
test("separate mounted workspaces cannot share their draft cache", () => {
  const first = new Map();
  switchConversationDraft(
    first,
    "same-id",
    null,
    { text: "Primer negocio" },
    { text: "" },
  );
  assert.deepEqual(
    switchConversationDraft(
      new Map(),
      null,
      "same-id",
      { text: "" },
      { text: "" },
    ),
    { text: "" },
  );
});
test("forwarding addresses the target conversation and its provider, not the source channel", () => {
  assert.deepEqual(
    forwardMessagePayload(
      { id: "target-meta", sourceType: "meta", sourceId: "official-number" },
      "Respuesta",
    ),
    {
      conversationId: "target-meta",
      content: "Respuesta",
      direction: "outbound",
      sourceType: "meta",
      sourceId: "official-number",
    },
  );
  assert.equal(
    forwardMessagePayload({ id: "target-qr", sourceType: "wuzapi" }, "Mensaje")
      .sourceId,
    null,
  );
});
test("responses from an older request cannot populate another or closed conversation", () => {
  assert.equal(isActiveConversationResult("a", "a"), true);
  assert.equal(isActiveConversationResult("b", "a"), false);
  assert.equal(isActiveConversationResult(null, "a"), false);
});

test("failed sends recover the original draft when no newer input exists", () => {
  const attempt = {
    text: "Respuesta pendiente",
    file: null,
    reply: { id: "original" },
  };
  assert.equal(recoverFailedConversationDraft(empty, attempt), attempt);
});
test("failed sends preserve newer typing, attachments or reply intent", () => {
  const attempted = { text: "Anterior", file: null, reply: null };
  for (const current of [
    { text: "Texto nuevo", file: null, reply: null },
    { text: "", file: { url: "/new.pdf" }, reply: null },
    { text: "", file: null, reply: { id: "new" } },
  ])
    assert.equal(recoverFailedConversationDraft(current, attempted), current);
});

test("conversation search ignores accents and phone formatting", () => {
  assert.equal(
    matchesConversationSearch(
      { name: "María López", phone: "525500002001" },
      "",
      "maria",
    ),
    true,
  );
  assert.equal(
    matchesConversationSearch(
      { name: "María López", phone: "525500002001" },
      "",
      "+52 550 000 2001",
    ),
    true,
  );
});
test("conversation search includes previews without treating mixed text as a phone query", () => {
  assert.equal(
    matchesConversationSearch(
      { name: "Ana", phone: "525500002001" },
      "Revisar manicure",
      "manicure",
    ),
    true,
  );
  assert.equal(
    matchesConversationSearch(
      { name: "Ana", phone: "525500002001" },
      "",
      "servicio 2001",
    ),
    false,
  );
});
test("blank searches include all conversations and unmatched queries include none", () => {
  assert.equal(matchesConversationSearch({}, "", "  "), true);
  assert.equal(matchesConversationSearch({}, "", "cliente inexistente"), false);
});
