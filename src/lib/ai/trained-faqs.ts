import "server-only";
import { prisma } from "@/lib/db";
import { buildTrainedFaqContext, TRAINED_FAQ_TYPE } from "@/lib/ai/trained-faq-policy";

// Read on every generation, including the playground. Do not cache across tenants/requests.
export async function getTrainedFaqContext() {
    const rows = await prisma.knowledgeSource.findMany({
        where: { type: TRAINED_FAQ_TYPE, status: "ready" },
        select: { id: true, title: true, rawContent: true },
        orderBy: { id: "asc" },
    });
    const faqs = rows.map((row) => ({
            id: row.id, question: row.title, answer: row.rawContent || "", active: true,
        }));
    return {
        faqs,
        context: buildTrainedFaqContext(faqs),
        sources: rows.map((row) => ({ title: `FAQ aprobada: ${row.title}`, uri: null })),
    };
}
