import assert from "node:assert/strict";
import test from "node:test";
import { loadTsModule } from "./helpers/load-ts-module.mts";
import * as resolver from "../src/lib/ai/trained-faq-resolver.ts";
import { buildTrainedFaqContext, type TrainedFaq } from "../src/lib/ai/trained-faq-policy.ts";

const faq = { id: "faq", question: "¿Precio del corte?", answer: "$250, incluye lavado", active: true };

test("exact questions preserve negations, numbers and approved facts without a provider call", async () => {
    const result = await resolver.resolveTrainedFaq({ faqs: [faq], question: "PRECIO del córte?", history: [], classify: async () => { throw Error("must not call model"); } });
    assert.equal(result.kind, "match");
    if (result.kind === "match") { assert.equal(result.faq.answer, faq.answer); assert.equal(result.method, "exact"); }
    assert.notEqual(resolver.normalizeFaqQuestion("No incluye lavado"), resolver.normalizeFaqQuestion("Incluye lavado"));
    assert.notEqual(resolver.normalizeFaqQuestion("250.50"), resolver.normalizeFaqQuestion("25050"));
    assert.equal(resolver.canSendApprovedAnswer("El corte cuesta $250.50. Puedes reservar tu cita con nuestro equipo."), true);
});

test("selector rejects injected IDs, inactive FAQs, unsolicited answers and duplicate questions", async () => {
    for (const value of ['null', '[]', '{"status":"match","id":"missing"}', '{"status":"none","id":"faq"}', '{"status":"match","id":"faq","answer":"x"}']) assert.equal(resolver.parseFaqSelection(value, [faq]).kind, "invalid");
    assert.equal(resolver.parseFaqSelection('{"status":"match","id":"faq"}', [{ ...faq, active: false }]).kind, "invalid");
    const conflict = await resolver.resolveTrainedFaq({ faqs: [faq, { ...faq, id: "other", answer: "$300" }], question: faq.question, history: [], classify: async () => { throw Error("must not choose arbitrarily"); } });
    assert.equal(conflict.kind, "ambiguous");
    for (const answer of ["Tu cita quedó registrada", "Hay cupos disponibles mañana", "Contacta al asesor Juan", "Escribe a +525500001111"]) assert.equal(resolver.canSendApprovedAnswer(answer), false);
});

function fixture() {
    const requests: { role: string; content: string }[][] = [];
    let faqs: TrainedFaq[] = [faq], selected = '{"status":"match","id":"faq"}', rag = 0, reads = 0, quotas = 0;
    const chatbot = loadTsModule("src/lib/ai/chatbot.ts", {
        "@/lib/billing/chatbot-usage": { assertChatbotUsageAvailable: async () => { quotas++; } },
        "@/lib/ai/trained-faq-resolver": resolver,
        "@/lib/ai/trained-faqs": { getTrainedFaqContext: async () => { reads++; const active = faqs.filter((f) => f.active); return { faqs: active, context: buildTrainedFaqContext(active), sources: active.map((f) => ({ title: `FAQ aprobada: ${f.question}`, uri: null })) }; } },
        "@/lib/db": { prisma: { conversation: { findUnique: async () => ({ contact: {}, assignedUser: null, messages: [] }) } } },
        "@/lib/ai/openai": { generateCompletion: async (messages: { role: string; content: string }[]) => { requests.push(messages); return messages[0].content.includes("Eres un clasificador") ? selected : "Respuesta normal"; } },
        "@/lib/brain/knowledge": { buildKnowledgeContext: async () => { rag++; return { context: "Precio antiguo $200", chunks: [] }; } },
        "@/lib/system-settings": { getSystemSettingsOrDefaults: async () => ({ openaiModel: "test-model" }) },
        "@/lib/calendar/business-hours": { normalizeBusinessHours: () => ({ timeZone: "America/Mexico_City" }), formatBusinessScheduleLines: () => "Lunes" },
        "@/lib/contact-name": { getContactFullName: () => "Cliente" },
        "@/lib/ai/beauty-business-context": { buildBeautyBusinessContext: async () => "Negocio" },
        "@/lib/ai/reply-format": { formatBotReplyForReadability: (text: string) => text },
    }) as { generateAssistantPreview: (input: { message: string }) => Promise<{ reply: string; trace: { knowledgeSources: { title: string }[] } }>; generateConversationReply: (id: string, message: string, instruction?: string) => Promise<string> };
    return { chatbot, requests, setFaqs: (v: TrainedFaq[]) => { faqs = v; }, setSelection: (v: string) => { selected = v; }, stats: () => ({ rag, reads, quotas }) };
}

test("preview and customer pipeline return the latest stored approved answer, without stale RAG or model rewriting", async () => {
    const f = fixture();
    assert.equal((await f.chatbot.generateAssistantPreview({ message: faq.question })).reply, faq.answer);
    assert.equal(f.requests.length, 0);
    f.setFaqs([{ ...faq, answer: "$280, incluye lavado y peinado" }]);
    assert.equal(await f.chatbot.generateConversationReply("conv", "¿Qué vale cortarme el cabello?", "Seguimiento comercial"), "$280, incluye lavado y peinado");
    assert.equal(f.requests.length, 1);
    assert.match(f.requests[0][1].content, /\$280/);
    assert.deepEqual(f.stats(), { rag: 0, reads: 2, quotas: 1 });
});

test("pausing removes the answer immediately, operational requests keep calendar rules, invalid matches ask for clarification", async () => {
    const f = fixture();
    f.setFaqs([{ ...faq, active: false }]);
    assert.equal((await f.chatbot.generateAssistantPreview({ message: faq.question })).reply, "Respuesta normal");
    assert.doesNotMatch(f.requests[0][0].content, /\$250/);
    f.setFaqs([{ ...faq, question: "Agenda mañana", answer: "Tu cita está confirmada" }]);
    await f.chatbot.generateConversationReply("conv", "Agenda mañana", "Consulta horas verificadas");
    assert.match(f.requests[1][0].content, /Nunca afirmes que una cita fue registrada/);
    assert.match(f.requests[1][0].content, /Consulta horas verificadas/);
    f.setFaqs([faq]);
    for (const value of ['{"status":"ambiguous"}', 'bad JSON', '{"status":"match","id":"other-tenant"}']) {
        f.setSelection(value);
        assert.match((await f.chatbot.generateAssistantPreview({ message: "¿Cuánto sale eso?" })).reply, /confirmas el servicio/);
    }
    assert.equal(f.stats().rag, 2);
});

test("unrelated questions retain normal conversation and provider failures propagate for retry", async () => {
    const f = fixture(); f.setSelection('{"status":"none"}');
    assert.equal((await f.chatbot.generateAssistantPreview({ message: "¿Venden esmalte azul?" })).reply, "Respuesta normal");
    assert.equal(f.requests.length, 2);
    await assert.rejects(resolver.resolveTrainedFaq({ faqs: [faq], question: "¿Cuánto sale?", history: [], classify: async () => { throw Error("provider unavailable"); } }), /provider unavailable/);
});
