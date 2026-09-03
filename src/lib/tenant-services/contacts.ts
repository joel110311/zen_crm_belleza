import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
    assertTenantPermission,
    TenantServiceError,
    type TenantServiceContext,
} from "@/lib/tenant-services/context";
import {
    asRecord,
    emailValue,
    identifier,
    optionalText,
    stringArray,
    text,
} from "@/lib/tenant-services/validation";

const CONTACT_LIST_INCLUDE = {
    conversations: {
        orderBy: { updatedAt: "desc" as const },
        take: 1,
        select: { id: true, botActive: true, status: true, updatedAt: true },
    },
    deals: {
        orderBy: { updatedAt: "desc" as const },
        take: 1,
        include: {
            stage: { select: { id: true, name: true, color: true, isClosedWon: true, isClosedLost: true } },
            intelligence: { select: { score: true, interestStatus: true, currentStep: true } },
        },
    },
    appointments: {
        orderBy: { startTime: "desc" as const },
        take: 3,
        select: { id: true, title: true, startTime: true, endTime: true, status: true, confirmationStatus: true },
    },
    patients: { select: { id: true, patientNumber: true, firstName: true, lastName: true } },
    _count: { select: { appointments: true, conversations: true, deals: true, patients: true } },
} satisfies Prisma.ContactInclude;

function searchWhere(query: string): Prisma.ContactWhereInput {
    if (!query) return {};
    return {
        OR: [
            { name: { contains: query, mode: "insensitive" } },
            { lastName: { contains: query, mode: "insensitive" } },
            { email: { contains: query, mode: "insensitive" } },
            { phone: { contains: query, mode: "insensitive" } },
            { company: { contains: query, mode: "insensitive" } },
        ],
    };
}

export async function listContacts(context: TenantServiceContext, rawQuery?: string, rawPage?: string, rawPageSize?: string) {
    assertTenantPermission(context, "contacts.read");
    const query = (rawQuery || "").trim().slice(0, 160);
    const page = Math.max(1, Number.parseInt(rawPage || "1", 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(rawPageSize || "25", 10) || 25));
    const where = searchWhere(query);
    const [items, total] = await Promise.all([
        context.db.contact.findMany({
            where,
            orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
            skip: (page - 1) * pageSize,
            take: pageSize,
            include: CONTACT_LIST_INCLUDE,
        }),
        context.db.contact.count({ where }),
    ]);
    const visibleItems = context.role === "PROFESSIONAL"
        ? items.map((item) => ({ ...item, deals: [] }))
        : items;
    return { items: visibleItems, page, pageSize, total };
}

export async function getContact(context: TenantServiceContext, rawId: unknown) {
    assertTenantPermission(context, "contacts.read");
    const id = identifier(rawId);
    const contact = await context.db.contact.findUnique({
        where: { id },
        include: {
            ...CONTACT_LIST_INCLUDE,
            deals: { orderBy: { updatedAt: "desc" }, include: { stage: true, dealTags: { include: { tag: true } } } },
            appointments: { orderBy: { startTime: "desc" }, include: { specialist: true, service: true, patient: true } },
        },
    });
    if (!contact) throw new TenantServiceError("NOT_FOUND", "El contacto ya no existe.");
    return context.role === "PROFESSIONAL" ? { ...contact, deals: [] } : contact;
}

function contactData(rawInput: unknown, partial = false) {
    const input = asRecord(rawInput);
    return {
        name: input.name === undefined && partial ? undefined : text(input.name, "Nombre", { required: true, max: 160 }),
        lastName: input.lastName === undefined && partial ? undefined : optionalText(input.lastName, "Apellidos", 160),
        email: input.email === undefined && partial ? undefined : emailValue(input.email),
        phone: input.phone === undefined && partial ? undefined : text(input.phone, "Teléfono", { required: true, max: 40 }),
        company: input.company === undefined && partial ? undefined : optionalText(input.company, "Empresa", 160),
        role: input.role === undefined && partial ? undefined : optionalText(input.role, "Puesto", 160),
        status: input.status === undefined && partial ? undefined : text(input.status, "Estado", { max: 40, fallback: "customer" }) || "customer",
        tags: input.tags === undefined && partial ? undefined : stringArray(input.tags ?? ["Cliente"], "Etiquetas"),
    };
}

export async function createContact(context: TenantServiceContext, rawInput: unknown) {
    assertTenantPermission(context, "contacts.write");
    const data = contactData(rawInput);
    return context.db.$transaction(async (tx) => {
        const contact = await tx.contact.create({ data: data as Prisma.ContactUncheckedCreateInput });
        await tx.patient.create({
            data: {
                patientNumber: `CLI-${randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`,
                firstName: contact.name || "Cliente",
                lastName: contact.lastName || "",
                phone: contact.phone,
                email: contact.email,
                contactId: contact.id,
            },
        });
        return tx.contact.findUniqueOrThrow({ where: { id: contact.id }, include: CONTACT_LIST_INCLUDE });
    });
}

export async function updateContact(context: TenantServiceContext, rawId: unknown, rawInput: unknown) {
    assertTenantPermission(context, "contacts.write");
    const id = identifier(rawId);
    const current = await context.db.contact.findUnique({ where: { id } });
    if (!current) throw new TenantServiceError("NOT_FOUND", "El contacto ya no existe.");
    const data = contactData(rawInput, true);
    return context.db.$transaction(async (tx) => {
        await tx.contact.update({ where: { id }, data });
        await tx.patient.updateMany({
            where: { contactId: id },
            data: {
                firstName: data.name,
                lastName: data.lastName === null ? "" : data.lastName,
                phone: data.phone,
                email: data.email,
            },
        });
        return tx.contact.findUniqueOrThrow({ where: { id }, include: CONTACT_LIST_INCLUDE });
    });
}

export async function deleteContact(context: TenantServiceContext, rawId: unknown) {
    assertTenantPermission(context, "contacts.write");
    const id = identifier(rawId);
    const contact = await context.db.contact.findUnique({
        where: { id },
        include: { _count: { select: { appointments: true, conversations: true, deals: true, patients: true, cashMovements: true, paymentLinks: true } } },
    });
    if (!contact) throw new TenantServiceError("NOT_FOUND", "El contacto ya no existe.");
    const history = Object.values(contact._count).reduce((sum, count) => sum + count, 0);
    if (history > 0) {
        throw new TenantServiceError("CONFLICT", "El contacto tiene historial. Cámbialo a estado archivado para conservar sus datos.");
    }
    await context.db.contact.delete({ where: { id } });
    return { id, deleted: true };
}
