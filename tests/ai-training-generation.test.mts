import assert from "node:assert/strict";
import test from "node:test";
import { loadTsModule } from "./helpers/load-ts-module.mts";
import { buildTrainedFaqContext } from "../src/lib/ai/trained-faq-policy.ts";

test("both the customer pipeline and playground include fresh approved FAQs before calling the model", async () => {
    const requests: { role: string; content: string }[][] = [];
    let answer = "$250, incluye lavado";
    let faqReads = 0;
    let quotaChecks = 0;
    const chatbot = loadTsModule("src/lib/ai/chatbot.ts", {
        "@/lib/billing/chatbot-usage": { assertChatbotUsageAvailable: async () => { quotaChecks++; } },
        "@/lib/ai/trained-faq-resolver": { resolveTrainedFaq: async () => ({ kind: "operational" }) },
        "@/lib/ai/trained-faqs": { getTrainedFaqContext: async () => {
            faqReads++;
            return { context: buildTrainedFaqContext([{ id: "faq", question: "¿Precio del corte?", answer, active: true }]), sources: [{ title: "FAQ aprobada: ¿Precio del corte?", uri: null }] };
        } },
        "@/lib/db": { prisma: { conversation: { findUnique: async () => ({ contact: { name: "Cliente", phone: "123" }, assignedUser: null, messages: [] }) } } },
        "@/lib/ai/openai": { generateCompletion: async (messages: { role: string; content: string }[]) => { requests.push(messages); return "Respuesta del modelo"; } },
        "@/lib/brain/knowledge": { buildKnowledgeContext: async () => ({ context: "Fuente antigua: el corte cuesta $200", chunks: [] }) },
        "@/lib/system-settings": { getSystemSettingsOrDefaults: async () => ({ agentPrompt: "Ayuda al cliente", openaiModel: "test-model", agentTemperature: 0.3 }) },
        "@/lib/calendar/business-hours": { normalizeBusinessHours: () => ({ timeZone: "America/Mexico_City" }), formatBusinessScheduleLines: () => "Lunes a viernes" },
        "@/lib/contact-name": { getContactFullName: () => "Cliente" },
        "@/lib/ai/beauty-business-context": { buildBeautyBusinessContext: async () => "Negocio de prueba" },
        "@/lib/ai/reply-format": { formatBotReplyForReadability: (text: string) => text },
    }) as {
        generateAssistantPreview: (input: { message: string }) => Promise<{ reply: string; trace: { knowledgeSources: { title: string }[]; operationalActionsExecuted: boolean } }>;
        generateConversationReply: (id: string, message: string, instruction: string) => Promise<string>;
    };
    const preview = await chatbot.generateAssistantPreview({ message: "¿Qué vale cortarme el cabello?" });
    assert.match(requests[0][0].content, /\$250, incluye lavado/);
    assert.match(requests[0][0].content, /prioridad sobre el RAG general/);
    assert.match(requests[0][0].content, /Fuente antigua/);
    assert.ok(preview.trace.knowledgeSources.some((source) => source.title.startsWith("FAQ aprobada:")));
    assert.equal(preview.trace.operationalActionsExecuted, false);
    answer = "$280, incluye lavado y peinado";
    await chatbot.generateConversationReply("conversation", "¿Cuánto sale el corte?", "Consulta horarios verificados antes de ofrecer una cita.");
    assert.match(requests[1][0].content, /\$280, incluye lavado y peinado/);
    assert.doesNotMatch(requests[1][0].content, /\$250/);
    assert.match(requests[1][0].content, /Consulta horarios verificados/);
    assert.match(requests[1][0].content, /Nunca afirmes que una cita fue registrada/);
    assert.equal(faqReads, 2);
    assert.equal(quotaChecks, 1);
    assert.equal(requests[1].at(-1)?.content, "¿Cuánto sale el corte?");
});
