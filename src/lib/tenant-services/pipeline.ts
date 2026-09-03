import "server-only";
import type { Prisma } from "@prisma/client";
import {
    assertTenantPermission,
    TenantServiceError,
    type TenantServiceContext,
} from "@/lib/tenant-services/context";
import {
    asRecord,
    booleanValue,
    identifier,
    numberValue,
    optionalText,
    text,
} from "@/lib/tenant-services/validation";

const DEAL_INCLUDE = {
    contact: { select: { id: true, name: true, lastName: true, phone: true, email: true } },
    dealTags: { include: { tag: true } },
    intelligence: true,
};

export async function getPipelineSnapshot(context: TenantServiceContext) {
    assertTenantPermission(context, "pipeline.read");
    const [stages, tags, contacts] = await Promise.all([
        context.db.pipelineStage.findMany({
            orderBy: { order: "asc" },
            include: { deals: { orderBy: { updatedAt: "desc" }, include: DEAL_INCLUDE } },
        }),
        context.db.tag.findMany({ orderBy: { name: "asc" } }),
        context.db.contact.findMany({ orderBy: { updatedAt: "desc" }, take: 100, select: { id: true, name: true, lastName: true, phone: true } }),
    ]);
    return { stages, tags, contacts };
}

function stageData(rawInput: unknown, partial = false) {
    const input = asRecord(rawInput);
    const isIncoming = input.isIncoming === undefined && partial ? undefined : booleanValue(input.isIncoming, false);
    const isClosedWon = input.isClosedWon === undefined && partial ? undefined : booleanValue(input.isClosedWon, false);
    const isClosedLost = input.isClosedLost === undefined && partial ? undefined : booleanValue(input.isClosedLost, false);
    if ([isIncoming, isClosedWon, isClosedLost].filter(Boolean).length > 1) {
        throw new TenantServiceError("VALIDATION_ERROR", "Una etapa no puede ser de entrada, ganada y perdida al mismo tiempo.");
    }
    return {
        name: input.name === undefined && partial ? undefined : text(input.name, "Nombre", { required: true, max: 100 }),
        color: input.color === undefined && partial ? undefined : text(input.color, "Color", { max: 20, fallback: "#64748B" }) || "#64748B",
        order: input.order === undefined && partial ? undefined : numberValue(input.order, "Orden", { fallback: 0, integer: true, min: 0, max: 10000 }),
        isIncoming,
        isClosedWon,
        isClosedLost,
    };
}

async function clearExclusiveStageFlags(
    db: Prisma.TransactionClient,
    data: ReturnType<typeof stageData>,
    excludeId?: string,
) {
    const updates: Array<Prisma.PrismaPromise<Prisma.BatchPayload>> = [];
    if (data.isIncoming) updates.push(db.pipelineStage.updateMany({ where: { isIncoming: true, id: excludeId ? { not: excludeId } : undefined }, data: { isIncoming: false } }));
    if (data.isClosedWon) updates.push(db.pipelineStage.updateMany({ where: { isClosedWon: true, id: excludeId ? { not: excludeId } : undefined }, data: { isClosedWon: false } }));
    if (data.isClosedLost) updates.push(db.pipelineStage.updateMany({ where: { isClosedLost: true, id: excludeId ? { not: excludeId } : undefined }, data: { isClosedLost: false } }));
    await Promise.all(updates);
}

export async function createPipelineStage(context: TenantServiceContext, rawInput: unknown) {
    assertTenantPermission(context, "pipeline.write");
    const data = stageData(rawInput);
    if (!asRecord(rawInput).order && asRecord(rawInput).order !== 0) {
        const aggregate = await context.db.pipelineStage.aggregate({ _max: { order: true } });
        data.order = (aggregate._max.order ?? -1) + 1;
    }
    return context.db.$transaction(async (tx) => {
        await clearExclusiveStageFlags(tx, data);
        return tx.pipelineStage.create({ data: data as Prisma.PipelineStageUncheckedCreateInput });
    });
}

export async function updatePipelineStage(context: TenantServiceContext, rawId: unknown, rawInput: unknown) {
    assertTenantPermission(context, "pipeline.write");
    const id = identifier(rawId);
    const current = await context.db.pipelineStage.findUnique({ where: { id } });
    if (!current) throw new TenantServiceError("NOT_FOUND", "La etapa ya no existe.");
    const data = stageData(rawInput, true);
    return context.db.$transaction(async (tx) => {
        await clearExclusiveStageFlags(tx, data, id);
        return tx.pipelineStage.update({ where: { id }, data });
    });
}

export async function deletePipelineStage(context: TenantServiceContext, rawId: unknown) {
    assertTenantPermission(context, "pipeline.write");
    const id = identifier(rawId);
    const [stage, total] = await Promise.all([
        context.db.pipelineStage.findUnique({ where: { id }, include: { _count: { select: { deals: true } } } }),
        context.db.pipelineStage.count(),
    ]);
    if (!stage) throw new TenantServiceError("NOT_FOUND", "La etapa ya no existe.");
    if (total <= 1) throw new TenantServiceError("CONFLICT", "El pipeline debe conservar al menos una etapa.");
    if (stage._count.deals > 0) throw new TenantServiceError("CONFLICT", "Mueve los negocios de esta etapa antes de eliminarla.");
    await context.db.pipelineStage.delete({ where: { id } });
    return { id, deleted: true };
}

function dealData(rawInput: unknown, partial = false) {
    const input = asRecord(rawInput);
    const priority = input.priority === undefined && partial ? undefined : text(input.priority, "Prioridad", { max: 20, fallback: "medium" }) || "medium";
    if (priority && !["low", "medium", "high"].includes(priority)) {
        throw new TenantServiceError("VALIDATION_ERROR", "La prioridad no es válida.", { field: "priority" });
    }
    return {
        title: input.title === undefined && partial ? undefined : text(input.title, "Título", { required: true, max: 200 }),
        value: input.value === undefined && partial ? undefined : numberValue(input.value, "Valor", { fallback: 0, min: 0, max: 100000000 }),
        stageId: input.stageId === undefined && partial ? undefined : identifier(input.stageId, "Etapa"),
        source: input.source === undefined && partial ? undefined : text(input.source, "Origen", { max: 40, fallback: "manual" }) || "manual",
        notes: input.notes === undefined && partial ? undefined : optionalText(input.notes, "Notas", 5000),
        priority,
        contactId: input.contactId === undefined && partial ? undefined : optionalText(input.contactId, "Contacto", 100),
        assignedTo: input.assignedTo === undefined && partial ? undefined : optionalText(input.assignedTo, "Responsable", 160),
    };
}

async function validateDealRelations(context: TenantServiceContext, stageId?: string, contactId?: string | null) {
    const [stage, contact] = await Promise.all([
        stageId ? context.db.pipelineStage.findUnique({ where: { id: stageId }, select: { id: true } }) : null,
        contactId ? context.db.contact.findUnique({ where: { id: contactId }, select: { id: true } }) : null,
    ]);
    if (stageId && !stage) throw new TenantServiceError("VALIDATION_ERROR", "La etapa ya no existe.", { field: "stageId" });
    if (contactId && !contact) throw new TenantServiceError("VALIDATION_ERROR", "El contacto ya no existe.", { field: "contactId" });
}

export async function createDeal(context: TenantServiceContext, rawInput: unknown) {
    assertTenantPermission(context, "pipeline.write");
    const data = dealData(rawInput);
    await validateDealRelations(context, data.stageId, data.contactId);
    return context.db.deal.create({ data: data as Prisma.DealUncheckedCreateInput, include: DEAL_INCLUDE });
}

export async function updateDeal(context: TenantServiceContext, rawId: unknown, rawInput: unknown) {
    assertTenantPermission(context, "pipeline.write");
    const id = identifier(rawId);
    const current = await context.db.deal.findUnique({ where: { id } });
    if (!current) throw new TenantServiceError("NOT_FOUND", "El negocio ya no existe.");
    const data = dealData(rawInput, true);
    await validateDealRelations(context, data.stageId, data.contactId);
    return context.db.deal.update({ where: { id }, data, include: DEAL_INCLUDE });
}

export async function deleteDeal(context: TenantServiceContext, rawId: unknown) {
    assertTenantPermission(context, "pipeline.write");
    const id = identifier(rawId);
    const current = await context.db.deal.findUnique({ where: { id }, select: { id: true } });
    if (!current) throw new TenantServiceError("NOT_FOUND", "El negocio ya no existe.");
    await context.db.deal.delete({ where: { id } });
    return { id, deleted: true };
}
