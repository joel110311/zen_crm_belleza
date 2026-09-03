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
    dateValue,
    emailValue,
    identifier,
    optionalText,
    text,
} from "@/lib/tenant-services/validation";

const PATIENT_DETAIL_INCLUDE = {
    contact: true,
    consultations: {
        orderBy: { createdAt: "desc" as const },
        include: {
            parent: { select: { id: true, diagnosis: true, chiefComplaint: true, treatmentPlan: true, createdAt: true } },
            evolutionNotes: { orderBy: { createdAt: "desc" as const } },
            appointment: {
                select: {
                    id: true, title: true, startTime: true, endTime: true, status: true,
                    specialist: { select: { id: true, name: true, displayName: true, specialty: true } },
                },
            },
            specialist: { select: { id: true, name: true, displayName: true, specialty: true, professionalTitle: true, professionalLicense: true } },
        },
    },
    appointments: { orderBy: { startTime: "desc" as const }, take: 30, include: { specialist: true, service: true } },
    evolutionNotes: { orderBy: { createdAt: "desc" as const } },
    budgets: { orderBy: { createdAt: "desc" as const } },
    clinicalAnalyses: { orderBy: { createdAt: "desc" as const } },
} satisfies Prisma.PatientInclude;

const PATIENT_LIST_INCLUDE = {
    contact: { select: { id: true, status: true, tags: true } },
    appointments: {
        orderBy: { startTime: "desc" as const },
        take: 1,
        select: { id: true, startTime: true, endTime: true, status: true, confirmationStatus: true },
    },
    _count: { select: { consultations: true, appointments: true } },
} satisfies Prisma.PatientInclude;

function searchWhere(query: string): Prisma.PatientWhereInput {
    if (!query) return {};
    return {
        OR: [
            { firstName: { contains: query, mode: "insensitive" } },
            { lastName: { contains: query, mode: "insensitive" } },
            { phone: { contains: query, mode: "insensitive" } },
            { email: { contains: query, mode: "insensitive" } },
            { idNumber: { contains: query, mode: "insensitive" } },
            { patientNumber: { contains: query, mode: "insensitive" } },
        ],
    };
}

export async function listPatients(context: TenantServiceContext, rawQuery?: string, rawPage?: string, rawPageSize?: string) {
    assertTenantPermission(context, "patients.read");
    const query = (rawQuery || "").trim().slice(0, 160);
    const page = Math.max(1, Number.parseInt(rawPage || "1", 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(rawPageSize || "25", 10) || 25));
    const where = searchWhere(query);
    const [items, total] = await Promise.all([
        context.db.patient.findMany({
            where,
            orderBy: [{ lastVisitAt: "desc" }, { createdAt: "desc" }],
            skip: (page - 1) * pageSize,
            take: pageSize,
            include: PATIENT_LIST_INCLUDE,
        }),
        context.db.patient.count({ where }),
    ]);
    return { items, page, pageSize, total };
}

export async function getPatient(context: TenantServiceContext, rawId: unknown) {
    assertTenantPermission(context, "patients.read");
    const id = identifier(rawId);
    const patient = await context.db.patient.findUnique({ where: { id }, include: PATIENT_DETAIL_INCLUDE });
    if (!patient) throw new TenantServiceError("NOT_FOUND", "El paciente ya no existe.");
    return patient;
}

function patientData(rawInput: unknown, partial = false) {
    const input = asRecord(rawInput);
    return {
        firstName: input.firstName === undefined && partial ? undefined : text(input.firstName, "Nombre", { required: true, max: 160 }),
        lastName: input.lastName === undefined && partial ? undefined : text(input.lastName, "Apellidos", { max: 160 }),
        phone: input.phone === undefined && partial ? undefined : text(input.phone, "Teléfono", { required: true, max: 40 }),
        email: input.email === undefined && partial ? undefined : emailValue(input.email),
        address: input.address === undefined && partial ? undefined : optionalText(input.address, "Dirección", 500),
        dob: input.dob === undefined && partial ? undefined : dateValue(input.dob, "Fecha de nacimiento"),
        sex: input.sex === undefined && partial ? undefined : optionalText(input.sex, "Sexo", 40),
        idType: input.idType === undefined && partial ? undefined : optionalText(input.idType, "Tipo de identificación", 40),
        idNumber: input.idNumber === undefined && partial ? undefined : optionalText(input.idNumber, "Identificación", 100),
        allergies: input.allergies === undefined && partial ? undefined : optionalText(input.allergies, "Alergias", 5000),
        pathologicalHistory: input.pathologicalHistory === undefined && partial ? undefined : optionalText(input.pathologicalHistory, "Antecedentes patológicos", 10000),
        nonPathologicalHistory: input.nonPathologicalHistory === undefined && partial ? undefined : optionalText(input.nonPathologicalHistory, "Antecedentes no patológicos", 10000),
        familyHistory: input.familyHistory === undefined && partial ? undefined : optionalText(input.familyHistory, "Antecedentes familiares", 10000),
        surgicalHistory: input.surgicalHistory === undefined && partial ? undefined : optionalText(input.surgicalHistory, "Antecedentes quirúrgicos", 10000),
        currentMedications: input.currentMedications === undefined && partial ? undefined : optionalText(input.currentMedications, "Medicamentos", 5000),
        notes: input.notes === undefined && partial ? undefined : optionalText(input.notes, "Notas", 10000),
    };
}

async function upsertContact(db: Prisma.TransactionClient, data: {
    firstName: string;
    lastName: string;
    phone: string | null;
    email: string | null;
}) {
    if (!data.phone) return null;
    return db.contact.upsert({
        where: { phone: data.phone },
        create: {
            phone: data.phone,
            name: data.firstName,
            lastName: data.lastName || null,
            email: data.email,
            status: "customer",
            tags: ["Cliente"],
        },
        update: {
            name: data.firstName,
            lastName: data.lastName || null,
            email: data.email,
            status: "customer",
        },
        select: { id: true },
    });
}

export async function createPatient(context: TenantServiceContext, rawInput: unknown) {
    assertTenantPermission(context, "patients.write");
    const data = patientData(rawInput);
    return context.db.$transaction(async (tx) => {
        const contact = await tx.contact.upsert({
            where: { phone: data.phone! },
            create: { phone: data.phone!, name: data.firstName, lastName: data.lastName || null, email: data.email, status: "customer", tags: ["Cliente"] },
            update: { name: data.firstName, lastName: data.lastName || null, email: data.email, status: "customer" },
            select: { id: true },
        });
        const existing = await tx.patient.findFirst({ where: { contactId: contact.id }, select: { id: true } });
        if (existing) throw new TenantServiceError("CONFLICT", "Ya existe un paciente con este teléfono.");
        const patient = await tx.patient.create({
            data: {
                ...data,
                patientNumber: `P-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`,
                contactId: contact.id,
            } as Prisma.PatientUncheckedCreateInput,
        });
        return tx.patient.findUniqueOrThrow({ where: { id: patient.id }, include: PATIENT_DETAIL_INCLUDE });
    });
}

export async function updatePatient(context: TenantServiceContext, rawId: unknown, rawInput: unknown) {
    assertTenantPermission(context, "patients.write");
    const id = identifier(rawId);
    const current = await context.db.patient.findUnique({ where: { id } });
    if (!current) throw new TenantServiceError("NOT_FOUND", "El paciente ya no existe.");
    const data = patientData(rawInput, true);
    const merged = {
        firstName: data.firstName ?? current.firstName,
        lastName: data.lastName ?? current.lastName,
        phone: data.phone ?? current.phone,
        email: data.email === undefined ? current.email : data.email,
    };
    return context.db.$transaction(async (tx) => {
        const contact = merged.phone ? await upsertContact(tx, merged) : null;
        return tx.patient.update({
            where: { id },
            data: { ...data, contactId: contact?.id ?? current.contactId },
            include: PATIENT_DETAIL_INCLUDE,
        });
    });
}

export async function deletePatient(context: TenantServiceContext, rawId: unknown) {
    assertTenantPermission(context, "patients.write");
    const id = identifier(rawId);
    const patient = await context.db.patient.findUnique({
        where: { id },
        include: {
            _count: {
                select: {
                    appointments: true, consultations: true, evolutionNotes: true, budgets: true,
                    clinicalAnalyses: true, cashMovements: true, paymentLinks: true,
                },
            },
        },
    });
    if (!patient) throw new TenantServiceError("NOT_FOUND", "El paciente ya no existe.");
    const history = Object.values(patient._count).reduce((sum, count) => sum + count, 0);
    if (history > 0) {
        throw new TenantServiceError("CONFLICT", "El paciente tiene expediente o movimientos históricos y no se puede eliminar.");
    }
    await context.db.patient.delete({ where: { id } });
    return { id, deleted: true };
}
