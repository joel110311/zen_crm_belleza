import assert from "node:assert/strict";
import test from "node:test";
import { loadTsModule } from "./helpers/load-ts-module.mts";
import * as policy from "../src/lib/ai/trained-faq-policy.ts";

type Source = { id: string; type: string; title: string; rawContent: string; status: string };
type SaveInput = { messageId?: string; faqId?: string; question: string; answer: string; active?: boolean };
type Actions = {
    getAiTrainingDraft: (id: string) => Promise<{ question: string; answer: string; originalAnswer: string }>;
    saveTrainedFaq: (input: SaveInput) => Promise<unknown>;
    getTrainedFaqs: () => Promise<policy.TrainedFaq[]>;
    deleteTrainedFaq: (id: string) => Promise<unknown>;
};

function fixture() {
    let permitted = true;
    let tenant = "a";
    const stores: Record<string, Source[]> = { a: [], b: [] };
    const reads: string[] = [];
    const message = { id: "bot", conversationId: "conv", direction: "outbound", senderType: "bot", content: "Respuesta antigua", status: "sent", providerRevokedAt: null, createdAt: new Date("2026-10-12T12:00:00Z") };
    const source = {
        findFirst: async ({ where }: { where: { id: string; type: string } }) => stores[tenant].find((row) => row.id === where.id && row.type === where.type) || null,
        findMany: async ({ where }: { where: { type: string; status?: string } }) => stores[tenant].filter((row) => row.type === where.type && (!where.status || row.status === where.status)),
        upsert: async ({ where, create, update }: { where: { id: string }; create: Source; update: Partial<Source> }) => {
            const existing = stores[tenant].find((row) => row.id === where.id);
            if (existing) Object.assign(existing, update); else stores[tenant].push(create);
        },
        deleteMany: async ({ where }: { where: { id: string; type: string } }) => { stores[tenant] = stores[tenant].filter((row) => row.id !== where.id || row.type !== where.type); },
    };
    const db = {
        knowledgeSource: source,
        message: {
            findUnique: async ({ where }: { where: { id: string } }) => { reads.push(tenant); return tenant === "a" && where.id === "bot" ? message : null; },
            findFirst: async ({ where, orderBy }: { where: { conversationId: string; direction: string; providerRevokedAt: null; OR: unknown[] }; orderBy: unknown[] }) => {
                assert.equal(where.conversationId, "conv"); assert.equal(where.direction, "inbound");
                assert.equal(where.providerRevokedAt, null); assert.equal(where.OR.length, 2); assert.equal(orderBy.length, 2);
                return { content: "Pregunta del cliente", botInputText: "Pregunta del cliente transcrita" };
            },
        },
        $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ knowledgeSource: source, $queryRaw: async (strings: TemplateStringsArray) => { assert.match(strings.join(""), /pg_advisory_xact_lock/); } }),
    };
    const mockedPolicy = policy;
    const actions = loadTsModule("src/app/actions/ai-training.ts", {
        "@/lib/db": { prisma: db }, "@/lib/ai/trained-faq-policy": mockedPolicy,
        "@/lib/authz": { requirePermission: async (permission: string) => {
            assert.ok(["ai.manage", "chats.manage"].includes(permission));
            if (!permitted) throw new Error("Unauthorized");
            return { user: { id: "admin" } };
        } },
    }) as Actions;
    const context = loadTsModule("src/lib/ai/trained-faqs.ts", {
        "server-only": {}, "@/lib/db": { prisma: db }, "@/lib/ai/trained-faq-policy": mockedPolicy,
    }) as { getTrainedFaqContext: () => Promise<{ context: string; sources: unknown[] }> };
    return { actions, context, stores, message, reads, deny: () => { permitted = false; }, tenantB: () => { tenant = "b"; } };
}

test("approved FAQs remain available to the assistant in production", async () => {
    const original = process.env.NODE_ENV;
    const testEnvironment = process.env as Record<string, string | undefined>;
    try {
        testEnvironment.NODE_ENV = "production";
        const f = fixture();
        await f.actions.saveTrainedFaq({ messageId: "bot", question: "Producción", answer: "Respuesta aprobada" });
        assert.match((await f.context.getTrainedFaqContext()).context, /Respuesta aprobada/);
    } finally { if (original === undefined) delete testEnvironment.NODE_ENV; else testEnvironment.NODE_ENV = original; }
});

test("only sent bot replies can be trained, never human/inbound/failed/revoked/empty", () => {
    const bot = { direction: "outbound", senderType: "bot", content: "Hola", status: "sent" };
    assert.equal(policy.canTrainAiMessage(bot), true);
    for (const patch of [{ direction: "inbound" }, { senderType: "human" }, { senderType: null }, { status: "failed" }, { status: "sending" }, { providerRevokedAt: new Date() }, { content: " " }]) {
        assert.equal(policy.canTrainAiMessage({ ...bot, ...patch }), false);
    }
});

test("server rejects unauthorized actions before reading a message or writing knowledge", async () => {
    const f = fixture(); f.deny();
    await assert.rejects(f.actions.getAiTrainingDraft("bot"), /Unauthorized/);
    assert.equal(f.reads.length, 0);
    await assert.rejects(f.actions.saveTrainedFaq({ messageId: "bot", question: "Q", answer: "A" }), /Unauthorized/);
    await assert.rejects(f.actions.getTrainedFaqs(), /Unauthorized/);
    await assert.rejects(f.actions.deleteTrainedFaq("trained-faq:bot"), /Unauthorized/);
    assert.equal(f.stores.a.length, 0);
    assert.equal(f.reads.length, 0);
});

test("draft uses the actual preceding customer input and refuses forged bot IDs", async () => {
    const f = fixture();
    const draft = await f.actions.getAiTrainingDraft("bot");
    assert.equal(draft.question, "Pregunta del cliente transcrita");
    assert.equal(draft.answer, "Respuesta antigua");
    await assert.rejects(f.actions.getAiTrainingDraft("missing"), /Sólo puedes/);
    f.message.senderType = "human";
    await assert.rejects(f.actions.saveTrainedFaq({ messageId: "bot", question: "Q", answer: "A" }), /Sólo puedes/);
});

test("save is idempotent, persists a FAQ without rewriting history, and seeds later edits", async () => {
    const f = fixture();
    await f.actions.saveTrainedFaq({ messageId: "bot", question: " ¿Precio? ", answer: " $250 e incluye lavado. " });
    await f.actions.saveTrainedFaq({ messageId: "bot", question: "¿Precio?", answer: "$260 e incluye lavado." });
    assert.equal(f.stores.a.length, 1);
    assert.equal(f.message.content, "Respuesta antigua");
    assert.equal((await f.actions.getAiTrainingDraft("bot")).answer, "$260 e incluye lavado.");
    assert.match((await f.context.getTrainedFaqContext()).context, /\$260 e incluye lavado/);
});

test("editing, pausing, reactivating and deleting affect the very next context read", async () => {
    const f = fixture();
    await f.actions.saveTrainedFaq({ messageId: "bot", question: "Corte", answer: "$250" });
    const id = "trained-faq:bot";
    await f.actions.saveTrainedFaq({ faqId: id, question: "Corte", answer: "$300", active: false });
    assert.equal((await f.context.getTrainedFaqContext()).context, "");
    assert.equal((await f.actions.getTrainedFaqs())[0].active, false);
    await f.actions.saveTrainedFaq({ faqId: id, question: "Corte", answer: "$300", active: true });
    assert.match((await f.context.getTrainedFaqContext()).context, /\$300/);
    await f.actions.deleteTrainedFaq(id);
    assert.equal((await f.actions.getTrainedFaqs()).length, 0);
});

test("active tenant isolation applies to draft, edits, list, context and delete", async () => {
    const f = fixture();
    await f.actions.saveTrainedFaq({ messageId: "bot", question: "Private A", answer: "Only A" });
    f.tenantB();
    await assert.rejects(f.actions.getAiTrainingDraft("bot"), /Sólo puedes/);
    await assert.rejects(f.actions.saveTrainedFaq({ faqId: "trained-faq:bot", question: "Overwrite", answer: "B" }), /no existe/);
    assert.equal((await f.actions.getTrainedFaqs()).length, 0);
    assert.equal((await f.context.getTrainedFaqContext()).context, "");
    await f.actions.deleteTrainedFaq("trained-faq:bot");
    assert.equal(f.stores.a.length, 1);
});

test("experimental capacity and ambiguous duplicate questions are rejected instead of silently omitting FAQs", async () => {
    const f = fixture();
    f.stores.a.push({ id: "trained-faq:other", type: policy.TRAINED_FAQ_TYPE, title: "Precio", rawContent: "$200", status: "ready" });
    await assert.rejects(f.actions.saveTrainedFaq({ messageId: "bot", question: " precio ", answer: "$300" }), /Ya existe/);
    for (let i = 1; i < policy.FAQ_MAX_COUNT; i++) f.stores.a.push({ id: `trained-faq:${i}`, type: policy.TRAINED_FAQ_TYPE, title: `Q${i}`, rawContent: "A", status: "ready" });
    await assert.rejects(f.actions.saveTrainedFaq({ messageId: "bot", question: "New", answer: "A" }), /hasta 50/);
    await assert.rejects(f.actions.saveTrainedFaq({ faqId: "trained-faq:other", question: " ", answer: "A" }), /Completa/);
    await assert.rejects(f.actions.saveTrainedFaq({ faqId: "trained-faq:other", question: "Q", answer: "A".repeat(4001) }), /Máximo/);
});

test("FAQ context preserves approved data, recognizes paraphrases and respects calendar safeguards", () => {
    const context = policy.buildTrainedFaqContext([{ id: "1", question: "Precio del corte", answer: "$250\nIncluye lavado.", active: true }, { id: "2", question: "Old", answer: "No usar", active: false }]);
    assert.match(context, /preguntas similares aunque usen otras palabras/);
    assert.match(context, /prioridad sobre el RAG/);
    assert.match(context, /disponibilidad verificada/);
    assert.match(context, /\$250/); assert.doesNotMatch(context, /No usar/);
});
