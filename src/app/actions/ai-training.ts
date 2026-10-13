"use server";

import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/authz";
import { normalizeFaqQuestion } from "@/lib/ai/trained-faq-resolver";
import {
    canTrainAiMessage, FAQ_MAX_CHARACTERS, FAQ_MAX_COUNT,
    TRAINED_FAQ_TYPE, validateFaq, type TrainedFaq,
} from "@/lib/ai/trained-faq-policy";

async function authorizeTraining() {
    const session = await requirePermission("ai.manage");
    await requirePermission("chats.manage");
    if (!session?.user?.id) throw new Error("No autorizado.");
    return session;
}

async function loadBotMessage(messageId: string) {
    if (typeof messageId !== "string" || !messageId || messageId.length > 200) throw new Error("Mensaje inválido.");
    // prisma selects the authenticated tenant database; IDs from another business cannot resolve.
    const message = await prisma.message.findUnique({ where: { id: messageId } });
    if (!message || !canTrainAiMessage(message)) throw new Error("Sólo puedes entrenar respuestas enviadas por la IA.");
    return message;
}

export async function getAiTrainingDraft(messageId: string) {
    await authorizeTraining();
    const message = await loadBotMessage(messageId);
    const [saved, previous] = await Promise.all([
        prisma.knowledgeSource.findFirst({ where: { id: `trained-faq:${message.id}`, type: TRAINED_FAQ_TYPE } }),
        prisma.message.findFirst({
            where: { conversationId: message.conversationId, direction: "inbound", providerRevokedAt: null,
                OR: [{ createdAt: { lt: message.createdAt } }, { createdAt: message.createdAt, id: { lt: message.id } }],
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        }),
    ]);
    return {
        question: saved?.title || previous?.botInputText || previous?.content || "",
        answer: saved?.rawContent || message.content,
        originalAnswer: message.content,
        existing: Boolean(saved),
        revision: saved?.updatedAt.toISOString() ?? null,
    };
}

export async function getTrainedFaqs(): Promise<TrainedFaq[]> {
    await authorizeTraining();
    const rows = await prisma.knowledgeSource.findMany({
        where: { type: TRAINED_FAQ_TYPE }, orderBy: { updatedAt: "desc" },
        select: { id: true, title: true, rawContent: true, status: true, updatedAt: true },
    });
    return rows.map((row) => ({ id: row.id, question: row.title, answer: row.rawContent || "", active: row.status === "ready", revision: row.updatedAt.toISOString() }));
}

export async function saveTrainedFaq(input: { messageId?: string; faqId?: string; question: string; answer: string; active?: boolean; expectedRevision?: string | null }) {
    const session = await authorizeTraining();
    const { question, answer } = validateFaq(input.question, input.answer);
    const message = input.messageId ? await loadBotMessage(input.messageId) : null;
    const id = message ? `trained-faq:${message.id}` : input.faqId;
    if (typeof id !== "string" || !id.startsWith("trained-faq:") || id.length > 220) throw new Error("FAQ inválida.");
    if (input.active !== undefined && typeof input.active !== "boolean") throw new Error("Estado inválido.");

    await prisma.$transaction(async (tx) => {
        // Serialize capacity checks and upserts within this business database.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('experimental-trained-faqs'))::text`;
        const rows = await tx.knowledgeSource.findMany({ where: { type: TRAINED_FAQ_TYPE }, select: { id: true, title: true, rawContent: true, updatedAt: true } });
        const existing = rows.find((row) => row.id === id);
        if (!message && !existing) throw new Error("La FAQ no existe en este negocio.");
        if (existing && input.expectedRevision !== existing.updatedAt.toISOString()) {
            throw new Error("Esta FAQ cambió mientras la editabas. Cierra y vuelve a abrirla para cargar la última versión.");
        }
        if (!existing && input.expectedRevision) throw new Error("Esta FAQ fue eliminada. Recarga la lista antes de continuar.");
        if (!existing && rows.length >= FAQ_MAX_COUNT) throw new Error(`El experimento admite hasta ${FAQ_MAX_COUNT} FAQs. Edita o elimina una existente.`);
        const others = rows.filter((row) => row.id !== id);
        if (others.some((row) => normalizeFaqQuestion(row.title) === normalizeFaqQuestion(question))) {
            throw new Error("Ya existe esa pregunta. Edita la FAQ existente para evitar respuestas contradictorias.");
        }
        if (others.reduce((sum, row) => sum + row.title.length + (row.rawContent?.length || 0), question.length + answer.length) > FAQ_MAX_CHARACTERS) {
            throw new Error("La base experimental alcanzó su capacidad de texto. Acorta o elimina una FAQ.");
        }
        const data = { title: question, rawContent: answer, status: input.active === false ? "paused" : "ready", syncedAt: new Date() };
        await tx.knowledgeSource.upsert({
            where: { id }, update: data,
            create: { id, type: TRAINED_FAQ_TYPE, ...data, metadata: message ? {
                sourceMessageId: message.id, conversationId: message.conversationId, createdBy: session.user!.id!,
            } : undefined },
        });
    });
    return { success: true as const };
}

export async function deleteTrainedFaq(faqId: string, expectedRevision?: string) {
    await authorizeTraining();
    if (typeof faqId !== "string" || !faqId.startsWith("trained-faq:")) throw new Error("FAQ inválida.");
    if (!expectedRevision || !Number.isFinite(Date.parse(expectedRevision))) throw new Error("Recarga la FAQ antes de eliminarla.");
    await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('experimental-trained-faqs'))::text`;
        const deleted = await tx.knowledgeSource.deleteMany({ where: { id: faqId, type: TRAINED_FAQ_TYPE, updatedAt: new Date(expectedRevision) } });
        if (!deleted.count) throw new Error("La FAQ cambió o fue eliminada. Recarga la lista antes de continuar.");
    });
    return { success: true as const };
}

// Expected validation errors must be returned as data: React sanitizes thrown server errors
// in production, making an actionable conflict look like an opaque minified error.
function trainingFeedback(cause: unknown) {
    const message = cause instanceof Error ? cause.message : "";
    const known = /^(Esta FAQ cambió|Esta FAQ fue eliminada|La FAQ (?:no existe|cambió)|Recarga la FAQ|FAQ inválida|Mensaje inválido|Sólo puedes entrenar|Escribe la pregunta|Completa la pregunta|Máximo \d|Ya existe esa pregunta|El experimento admite|La base experimental)/;
    return { success: false as const, error: known.test(message) ? message : "No se pudo actualizar el entrenamiento. Recarga la página e inténtalo de nuevo." };
}

export async function saveTrainedFaqWithFeedback(input: Parameters<typeof saveTrainedFaq>[0]) {
    try { return await saveTrainedFaq(input); } catch (cause) { return trainingFeedback(cause); }
}

export async function deleteTrainedFaqWithFeedback(faqId: string, expectedRevision?: string) {
    try { return await deleteTrainedFaq(faqId, expectedRevision); } catch (cause) { return trainingFeedback(cause); }
}
