import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";

function fields<T>(...names: (keyof T)[]): Record<string, true> {
    return Object.fromEntries(names.map(name => [name, true]));
}

// Explicit field lists: never export passwords, provider credentials, booking capabilities,
// raw webhooks or platform billing secrets. New fields are not included automatically.
const DATASETS = {
    user: fields<Prisma.UserSelect>("id", "name", "email", "role", "createdAt", "updatedAt"),
    contact: fields<Prisma.ContactSelect>("id", "name", "lastName", "phone", "email", "company", "role", "tags", "status", "sourceType", "createdAt", "updatedAt"),
    conversation: fields<Prisma.ConversationSelect>("id", "contactId", "assignedUserId", "status", "sourceType", "botActive", "createdAt", "updatedAt"),
    message: fields<Prisma.MessageSelect>("id", "conversationId", "content", "type", "direction", "status", "senderType", "mediaType", "mediaFileName", "providerRevokedAt", "createdAt"),
    appointment: fields<Prisma.AppointmentSelect>("id", "title", "startTime", "endTime", "status", "notes", "contactId", "specialistId", "serviceId", "specialistName", "confirmationStatus", "paymentStatus", "paymentAmount", "paymentCurrency", "paymentMethod", "cancellationReason", "createdAt", "updatedAt"),
    specialist: fields<Prisma.SpecialistSelect>("id", "name", "displayName", "specialty", "email", "phone", "bio", "room", "isActive", "userId", "createdAt", "updatedAt"),
    serviceCategory: fields<Prisma.ServiceCategorySelect>("id", "name", "createdAt", "updatedAt"),
    service: fields<Prisma.ServiceSelect>("id", "name", "description", "categoryId", "price", "currency", "durationMinutes", "preparationRequirements", "isActive", "createdAt", "updatedAt"),
    cashMovement: fields<Prisma.CashMovementSelect>("id", "type", "concept", "amount", "currency", "paymentMethod", "status", "occurredAt", "notes", "appointmentId", "contactId", "specialistId", "recordedById", "createdAt", "updatedAt"),
    cashClosure: fields<Prisma.CashClosureSelect>("id", "dateKey", "timeZone", "from", "to", "closedAt", "income", "expense", "balance", "movementCount", "notes", "closedById", "createdAt", "updatedAt"),
    pipelineStage: fields<Prisma.PipelineStageSelect>("id", "name", "color", "order", "isIncoming", "isClosedWon", "isClosedLost", "createdAt", "updatedAt"),
    deal: fields<Prisma.DealSelect>("id", "title", "value", "stageId", "source", "notes", "priority", "contactId", "assignedTo", "createdAt", "updatedAt"),
    knowledgeSource: fields<Prisma.KnowledgeSourceSelect>("id", "title", "type", "sourceUri", "rawContent", "status", "createdAt", "updatedAt"),
};

type ExportRow = { id: string } & Record<string, unknown>;
type ExportDelegate = { findMany: (input: Record<string, unknown>) => Promise<ExportRow[]> };

/** Pull-based streaming keeps exports bounded and stops querying when the download is canceled. */
export function workspaceExportStream(db: PrismaClient, manifest: Record<string, unknown>, authorize: () => Promise<unknown>) {
    const encoder = new TextEncoder();
    async function* records() {
        yield { dataset: "manifest", formatVersion: 1, ...manifest, datasets: Object.keys(DATASETS), attachmentsIncluded: false };
        for (const [dataset, select] of Object.entries(DATASETS)) {
            let cursor: string | undefined;
            while (true) {
                await authorize();
                const rows = await (db as unknown as Record<string, ExportDelegate>)[dataset].findMany({
                    select, orderBy: { id: "asc" }, take: 250,
                    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
                });
                for (const record of rows) yield { dataset, record };
                if (rows.length < 250) break;
                cursor = rows[rows.length - 1].id;
            }
        }
        yield { dataset: "complete", exportedAt: new Date().toISOString() };
    }
    const iterator = records();
    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            try {
                const next = await iterator.next();
                if (next.done) controller.close();
                else controller.enqueue(encoder.encode(`${JSON.stringify(next.value)}\n`));
            } catch { controller.error(new Error("No se pudo completar la exportación. Descarga el archivo nuevamente.")); }
        },
        async cancel() { await iterator.return(undefined); },
    });
}
