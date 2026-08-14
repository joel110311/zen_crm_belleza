"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { generateCompletion } from "@/lib/ai/openai";
import { requirePermission } from "@/lib/authz";
import { findOrCreateActiveConversationForContact } from "@/lib/outbound-messages";
import { buildPhoneMatchClauses } from "@/lib/phone";
import { getSystemSettingsOrDefaults } from "@/lib/system-settings";
import { buildOperationContext } from "@/lib/operation-context";
import { operationDateTimeToUtc } from "@/lib/operation-dates";

const PATIENT_DETAIL_INCLUDE = {
    contact: true,
    consultations: {
        orderBy: { createdAt: "desc" },
        include: {
            parent: {
                select: {
                    id: true,
                    diagnosis: true,
                    chiefComplaint: true,
                    treatmentPlan: true,
                    createdAt: true,
                },
            },
            evolutionNotes: {
                orderBy: { createdAt: "desc" },
            },
            appointment: {
                select: {
                    id: true,
                    title: true,
                    startTime: true,
                    endTime: true,
                    status: true,
                    specialistId: true,
                    specialistName: true,
                    specialist: {
                        select: {
                            id: true,
                            name: true,
                            displayName: true,
                            specialty: true,
                            professionalTitle: true,
                            professionalLicense: true,
                            photoUrl: true,
                        },
                    },
                },
            },
            specialist: {
                select: {
                    id: true,
                    name: true,
                    displayName: true,
                    specialty: true,
                    professionalTitle: true,
                    professionalLicense: true,
                    photoUrl: true,
                },
            },
        },
    },
    appointments: {
        orderBy: { startTime: "desc" },
        take: 20,
    },
    evolutionNotes: {
        orderBy: { createdAt: "desc" },
    },
    budgets: {
        orderBy: { createdAt: "desc" },
    },
    clinicalAnalyses: {
        orderBy: { createdAt: "desc" },
    },
} as const;

const PATIENT_LIST_INCLUDE = {
    appointments: {
        orderBy: { startTime: "desc" },
        take: 1,
        select: {
            id: true,
            startTime: true,
            endTime: true,
            status: true,
            confirmationStatus: true,
        },
    },
    _count: {
        select: {
            consultations: true,
            appointments: true,
        },
    },
} as const;

type PatientFormInput = {
    id?: string;
    firstName: string;
    lastName: string;
    phone?: string;
    email?: string;
    address?: string;
    dob?: string | Date | null;
    sex?: string;
    idType?: string;
    idNumber?: string;
    allergies?: string;
    pathologicalHistory?: string;
    nonPathologicalHistory?: string;
    familyHistory?: string;
    surgicalHistory?: string;
    currentMedications?: string;
    notes?: string;
};

type ConsultationInput = {
    patientId: string;
    type?: string;
    appointmentId?: string;
    parentId?: string;
    chiefComplaint: string;
    notes?: string;
    diagnosis?: string;
    treatmentPlan?: string;
    vitalSigns?: Record<string, unknown>;
    medications?: unknown[];
    studies?: unknown;
    studyRequests?: unknown[];
    bmi?: number | null;
    specialistId?: string;
    doctorName?: string;
    professionalTitle?: string;
    professionalLicense?: string;
    clinicName?: string;
};

type BudgetItemInput = {
    id?: string;
    code?: string;
    name?: string;
    description?: string;
    quantity?: number;
    price?: number;
    unitPrice?: number;
};

type BudgetInput = {
    id?: string;
    patientId: string;
    title: string;
    status?: string;
    items: BudgetItemInput[];
    discount?: number;
    notes?: string;
    validUntil?: string | Date | null;
    payments?: unknown[];
    plan?: unknown;
};

type AnalysisInput = {
    id?: string;
    patientId: string;
    kind?: "result" | "request";
    title: string;
    category?: string;
    results?: string;
    studies?: unknown[];
    resultDate?: string | Date | null;
    notes?: string;
    files?: unknown[];
};

type EvolutionNoteInput = {
    id?: string;
    patientId: string;
    consultationId?: string;
    note: string;
    doctorName?: string;
};

type BudgetPaymentInput = {
    budgetId: string;
    patientId: string;
    amount: number;
    currency?: string;
    method?: string;
    date?: string | Date;
};

function cleanText(value?: string | null) {
    return value?.trim() || undefined;
}

function nullableText(value?: string | null) {
    return value?.trim() || null;
}

function parseOptionalDate(value?: string | Date | null, timeZone?: string) {
    if (!value) return null;
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) && timeZone) {
        return operationDateTimeToUtc(value.trim(), "12:00", timeZone);
    }
    const parsed = value instanceof Date ? value : new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function getOperationTimeZone() {
    const settings = await getSystemSettingsOrDefaults();
    return buildOperationContext(settings).timeZone;
}

const CONSULTATION_SPECIALIST_SELECT = {
    id: true,
    name: true,
    displayName: true,
    specialty: true,
    professionalTitle: true,
    professionalLicense: true,
    photoUrl: true,
} satisfies Prisma.SpecialistSelect;

type ConsultationSpecialist = Prisma.SpecialistGetPayload<{
    select: typeof CONSULTATION_SPECIALIST_SELECT;
}>;

function specialistSnapshot(specialist?: ConsultationSpecialist | null) {
    if (!specialist) return null;
    return {
        id: specialist.id,
        name: specialist.displayName || specialist.name,
        title: specialist.professionalTitle || specialist.specialty || "Medico Oftalmologo",
        license: specialist.professionalLicense || null,
    };
}

async function resolveConsultationSpecialist(input: {
    specialistId?: string | null;
    appointmentId?: string | null;
}, currentUserId?: string | null) {
    const explicitSpecialistId = cleanText(input.specialistId);
    const appointment = cleanText(input.appointmentId)
        ? await prisma.appointment.findUnique({
            where: { id: cleanText(input.appointmentId) },
            select: {
                specialistId: true,
                specialist: { select: CONSULTATION_SPECIALIST_SELECT },
            },
        })
        : null;

    if (explicitSpecialistId) {
        const specialist = await prisma.specialist.findUnique({
            where: { id: explicitSpecialistId },
            select: CONSULTATION_SPECIALIST_SELECT,
        });
        if (specialist) return specialist;
    }

    if (appointment?.specialist) return appointment.specialist;

    if (appointment?.specialistId) {
        const specialist = await prisma.specialist.findUnique({
            where: { id: appointment.specialistId },
            select: CONSULTATION_SPECIALIST_SELECT,
        });
        if (specialist) return specialist;
    }

    if (currentUserId) {
        const specialist = await prisma.specialist.findFirst({
            where: { userId: currentUserId, isActive: true },
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
            select: CONSULTATION_SPECIALIST_SELECT,
        });
        if (specialist) return specialist;
    }

    return prisma.specialist.findFirst({
        where: { isActive: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: CONSULTATION_SPECIALIST_SELECT,
    });
}

function buildPatientSearchWhere(query?: string) {
    const value = query?.trim();
    if (!value) return {};

    return {
        OR: [
            { firstName: { contains: value, mode: "insensitive" as const } },
            { lastName: { contains: value, mode: "insensitive" as const } },
            { phone: { contains: value, mode: "insensitive" as const } },
            { email: { contains: value, mode: "insensitive" as const } },
            { idNumber: { contains: value, mode: "insensitive" as const } },
            { patientNumber: { contains: value, mode: "insensitive" as const } },
        ],
    };
}

async function generatePatientNumber() {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const suffix = Math.random().toString(36).slice(2, 10).toUpperCase();
        const candidate = `P-${suffix}`;
        const existing = await prisma.patient.findUnique({
            where: { patientNumber: candidate },
            select: { id: true },
        });
        if (!existing) return candidate;
    }

    return `P-${Date.now().toString(36).toUpperCase()}`;
}

async function findMatchingContactByPhone(phone?: string | null) {
    const normalizedPhone = cleanText(phone);
    if (!normalizedPhone) return null;

    const exact = await prisma.contact.findUnique({
        where: { phone: normalizedPhone },
        select: { id: true },
    });
    if (exact) return exact;

    const phoneClauses = buildPhoneMatchClauses([normalizedPhone]);
    if (phoneClauses.length === 0) return null;

    return prisma.contact.findFirst({
        where: { OR: phoneClauses },
        select: { id: true },
        orderBy: { updatedAt: "desc" },
    });
}

function normalizeBudgetItems(items: BudgetItemInput[]) {
    return (items || [])
        .map((item) => {
            const description = cleanText(item.description || item.name);
            const quantity = Number(item.quantity || 1);
            const unitPrice = Number(item.unitPrice ?? item.price ?? 0);

            return {
                id: cleanText(item.id),
                code: cleanText(item.code),
                name: description || "",
                description: description || "",
                quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
                unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
                price: Number.isFinite(unitPrice) ? unitPrice : 0,
            };
        })
        .filter((item) => item.description);
}

function budgetTotal(items: ReturnType<typeof normalizeBudgetItems>, discount = 0, taxRate = 0) {
    const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    const safeDiscount = Number.isFinite(discount) ? discount : 0;
    const taxableBase = Math.max(subtotal - safeDiscount, 0);
    const safeTaxRate = Number.isFinite(taxRate) && taxRate > 0 ? taxRate : 0;
    const tax = taxableBase * (safeTaxRate / 100);
    return {
        subtotal,
        discount: safeDiscount,
        tax,
        total: taxableBase + tax,
    };
}

async function recalculatePatientBalance(patientId: string) {
    const budgets = await prisma.patientBudget.findMany({
        where: {
            patientId,
            status: { in: ["accepted", "partial"] },
        },
        select: {
            total: true,
            payments: true,
        },
    });

    const balance = budgets.reduce<number>((sum, budget) => {
        const payments = Array.isArray(budget.payments) ? budget.payments : [];
        const paid = payments.reduce<number>((paidSum, payment) => {
            if (!payment || typeof payment !== "object") return paidSum;
            const amount = Number((payment as { amount?: unknown }).amount || 0);
            return paidSum + (Number.isFinite(amount) ? amount : 0);
        }, 0);
        return sum + Math.max(budget.total - paid, 0);
    }, 0);

    await prisma.patient.update({
        where: { id: patientId },
        data: { balance },
    });
}

function revalidatePatientSurfaces(patientId?: string) {
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/patients");
    revalidatePath("/dashboard/calendar");
    if (patientId) {
        revalidatePath(`/dashboard/patients/${patientId}`);
    }
}

export async function getPatients(query?: string) {
    await requirePermission("patients.manage");

    return prisma.patient.findMany({
        where: buildPatientSearchWhere(query),
        orderBy: [
            { lastVisitAt: "desc" },
            { createdAt: "desc" },
        ],
        include: PATIENT_LIST_INCLUDE,
    });
}

export async function getPatientsForPicker(query?: string) {
    await requirePermission("patients.manage");

    return prisma.patient.findMany({
        where: buildPatientSearchWhere(query),
        take: 25,
        orderBy: [
            { lastVisitAt: "desc" },
            { createdAt: "desc" },
        ],
        select: {
            id: true,
            patientNumber: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
            dob: true,
        },
    });
}

export async function getPatient(id: string) {
    await requirePermission("patients.manage");

    return prisma.patient.findUnique({
        where: { id },
        include: PATIENT_DETAIL_INCLUDE,
    });
}

export async function getPatientWorkspace(query?: string, selectedPatientId?: string) {
    await requirePermission("patients.manage");

    const patients = await getPatients(query);
    const selectedId = selectedPatientId || patients[0]?.id;
    const selectedPatient = selectedId ? await getPatient(selectedId) : null;

    return {
        patients,
        selectedPatient,
    };
}

export async function preparePatientChat(patientId: string) {
    await requirePermission("chats.manage");

    if (!patientId) {
        return { success: false, error: "Paciente invalido." };
    }

    try {
        const patient = await prisma.patient.findUnique({
            where: { id: patientId },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                phone: true,
                email: true,
                contactId: true,
                contact: {
                    select: { id: true },
                },
            },
        });

        if (!patient) {
            return { success: false, error: "Paciente no encontrado." };
        }

        const phone = cleanText(patient.phone);
        if (!phone) {
            return { success: false, error: "El paciente no tiene telefono registrado." };
        }

        let contactId = patient.contactId || patient.contact?.id || null;
        if (!contactId) {
            const matchingContact = await findMatchingContactByPhone(phone);
            if (matchingContact) {
                contactId = matchingContact.id;
            }
        }

        if (!contactId) {
            const contact = await prisma.contact.create({
                data: {
                    phone,
                    name: cleanText(patient.firstName),
                    lastName: cleanText(patient.lastName),
                    email: nullableText(patient.email),
                    status: "customer",
                },
                select: { id: true },
            });
            contactId = contact.id;
        }

        if (patient.contactId !== contactId) {
            await prisma.patient.update({
                where: { id: patient.id },
                data: { contactId },
            });
        }

        const conversation = await findOrCreateActiveConversationForContact(contactId);
        revalidatePath("/dashboard/inbox");

        return {
            success: true,
            conversationId: conversation.id,
            contactId,
        };
    } catch (error) {
        console.error("Failed to prepare patient chat:", error);
        return { success: false, error: "No se pudo preparar el chat del paciente." };
    }
}

export async function savePatient(input: PatientFormInput) {
    await requirePermission("patients.manage");

    const firstName = cleanText(input.firstName);
    const lastName = cleanText(input.lastName) || "";
    const phone = cleanText(input.phone);

    if (!firstName || !phone) {
        return { success: false, error: "El nombre y el teléfono son obligatorios." };
    }

    try {
        const operationTimeZone = await getOperationTimeZone();
        const contact = await prisma.contact.upsert({
            where: { phone },
            create: {
                phone,
                name: firstName,
                lastName: lastName || null,
                status: "customer",
                tags: ["Cliente"],
            },
            update: {
                name: firstName,
                lastName: lastName || null,
                status: "customer",
            },
            select: { id: true },
        });
        const data = {
            firstName,
            lastName,
            phone,
            email: nullableText(input.email),
            address: nullableText(input.address),
            dob: parseOptionalDate(input.dob, operationTimeZone),
            sex: nullableText(input.sex),
            idType: nullableText(input.idType),
            idNumber: nullableText(input.idNumber),
            allergies: nullableText(input.allergies),
            pathologicalHistory: nullableText(input.pathologicalHistory),
            nonPathologicalHistory: nullableText(input.nonPathologicalHistory),
            familyHistory: nullableText(input.familyHistory),
            surgicalHistory: nullableText(input.surgicalHistory),
            currentMedications: nullableText(input.currentMedications),
            notes: nullableText(input.notes),
            contactId: contact?.id || null,
        };

        const patient = input.id
            ? await prisma.patient.update({
                where: { id: input.id },
                data,
                include: PATIENT_DETAIL_INCLUDE,
            })
            : await prisma.patient.create({
                data: {
                    ...data,
                    patientNumber: await generatePatientNumber(),
                },
                include: PATIENT_DETAIL_INCLUDE,
            });

        revalidatePatientSurfaces(patient.id);
        return { success: true, patient };
    } catch (error) {
        console.error("Failed to save patient:", error);
        return { success: false, error: "No se pudo guardar el paciente." };
    }
}

export async function deletePatient(id: string) {
    await requirePermission("patients.manage");

    try {
        await prisma.patient.delete({ where: { id } });
        revalidatePatientSurfaces(id);
        return { success: true };
    } catch (error) {
        console.error("Failed to delete patient:", error);
        return { success: false, error: "No se pudo eliminar el paciente." };
    }
}

export async function savePatientHistory(patientId: string, data: Partial<PatientFormInput>) {
    await requirePermission("patients.manage");

    try {
        const patient = await prisma.patient.update({
            where: { id: patientId },
            data: {
                allergies: nullableText(data.allergies),
                pathologicalHistory: nullableText(data.pathologicalHistory),
                nonPathologicalHistory: nullableText(data.nonPathologicalHistory),
                familyHistory: nullableText(data.familyHistory),
                surgicalHistory: nullableText(data.surgicalHistory),
                currentMedications: nullableText(data.currentMedications),
                notes: nullableText(data.notes),
            },
            include: PATIENT_DETAIL_INCLUDE,
        });
        revalidatePatientSurfaces(patientId);
        return { success: true, patient };
    } catch (error) {
        console.error("Failed to save patient history:", error);
        return { success: false, error: "No se pudieron guardar los antecedentes." };
    }
}

export async function saveConsultation(input: ConsultationInput) {
    const session = await requirePermission("clinical.manage");

    if (!input.patientId || !cleanText(input.chiefComplaint)) {
        return { success: false, error: "Selecciona paciente y captura el motivo de consulta." };
    }

    try {
        const currentUserId = (session?.user as { id?: string } | undefined)?.id;
        const specialist = await resolveConsultationSpecialist(input, currentUserId);
        const resolvedSpecialist = specialistSnapshot(specialist);
        const consultation = await prisma.$transaction(async (tx) => {
            const created = await tx.patientConsultation.create({
                data: {
                    patientId: input.patientId,
                    type: cleanText(input.type) || "consultation",
                    appointmentId: cleanText(input.appointmentId),
                    specialistId: resolvedSpecialist?.id || null,
                    parentId: cleanText(input.parentId),
                    chiefComplaint: cleanText(input.chiefComplaint) || "Consulta",
                    notes: nullableText(input.notes),
                    diagnosis: nullableText(input.diagnosis),
                    treatmentPlan: nullableText(input.treatmentPlan),
                    vitalSigns: (input.vitalSigns || {}) as Prisma.InputJsonValue,
                    medications: (input.medications || []) as Prisma.InputJsonValue,
                    studies: (input.studies || {}) as Prisma.InputJsonValue,
                    studyRequests: (input.studyRequests || []) as Prisma.InputJsonValue,
                    bmi: typeof input.bmi === "number" ? input.bmi : null,
                    doctorName: resolvedSpecialist?.name || nullableText(input.doctorName),
                    professionalTitle: resolvedSpecialist?.title || nullableText(input.professionalTitle),
                    professionalLicense: resolvedSpecialist?.license || nullableText(input.professionalLicense),
                    clinicName: nullableText(input.clinicName),
                },
                include: {
                    specialist: { select: CONSULTATION_SPECIALIST_SELECT },
                    appointment: {
                        select: {
                            id: true,
                            title: true,
                            startTime: true,
                            endTime: true,
                            status: true,
                            specialistId: true,
                            specialistName: true,
                            specialist: { select: CONSULTATION_SPECIALIST_SELECT },
                        },
                    },
                },
            });

            await tx.patient.update({
                where: { id: input.patientId },
                data: { lastVisitAt: created.createdAt },
            });

            if (input.appointmentId) {
                await tx.appointment.update({
                    where: { id: input.appointmentId },
                    data: { status: "completed", patientId: input.patientId },
                });
            }

            return created;
        });

        revalidatePatientSurfaces(input.patientId);
        return { success: true, consultation };
    } catch (error) {
        console.error("Failed to save consultation:", error);
        return { success: false, error: "No se pudo guardar la consulta." };
    }
}

export async function saveEvolutionNote(input: EvolutionNoteInput) {
    const session = await requirePermission("clinical.manage");

    if (!input.patientId || !cleanText(input.note)) {
        return { success: false, error: "La nota no puede estar vacia." };
    }

    try {
        const currentUserId = (session?.user as { id?: string } | undefined)?.id;
        const specialist = await resolveConsultationSpecialist({}, currentUserId);
        const resolvedSpecialist = specialistSnapshot(specialist);
        const data = {
            patientId: input.patientId,
            consultationId: cleanText(input.consultationId) || null,
            note: cleanText(input.note) || "",
            doctorName: resolvedSpecialist?.name || nullableText(input.doctorName),
        };

        const note = input.id
            ? await prisma.patientEvolutionNote.update({
                where: { id: input.id },
                data,
            })
            : await prisma.patientEvolutionNote.create({ data });

        revalidatePatientSurfaces(input.patientId);
        return { success: true, note };
    } catch (error) {
        console.error("Failed to save evolution note:", error);
        return { success: false, error: "No se pudo guardar la nota de evolucion." };
    }
}

export async function deleteEvolutionNote(id: string, patientId: string) {
    await requirePermission("clinical.manage");

    try {
        await prisma.patientEvolutionNote.delete({ where: { id } });
        revalidatePatientSurfaces(patientId);
        return { success: true };
    } catch (error) {
        console.error("Failed to delete evolution note:", error);
        return { success: false, error: "No se pudo eliminar la nota." };
    }
}

export async function saveBudget(input: BudgetInput) {
    await requirePermission("billing.manage");

    const items = normalizeBudgetItems(input.items);

    if (!input.patientId || !cleanText(input.title) || items.length === 0) {
        return { success: false, error: "Captura titulo y al menos un concepto." };
    }

    const status = input.status || "pending";

    try {
        const settings = await getSystemSettingsOrDefaults();
        const taxRate = settings.posTaxEnabled ? Number(settings.posTaxRate || 0) : 0;
        const totals = budgetTotal(items, Number(input.discount || 0), taxRate);
        const inputPlan = input.plan && typeof input.plan === "object" && !Array.isArray(input.plan)
            ? input.plan as Record<string, unknown>
            : {};
        const planBreakdown = inputPlan.breakdown && typeof inputPlan.breakdown === "object" && !Array.isArray(inputPlan.breakdown)
            ? inputPlan.breakdown as Record<string, unknown>
            : {};
        const operationTimeZone = await getOperationTimeZone();
        const data = {
            patientId: input.patientId,
            title: cleanText(input.title) || "Presupuesto",
            status,
            items: items as Prisma.InputJsonValue,
            subtotal: totals.subtotal,
            discount: totals.discount,
            total: totals.total,
            payments: (input.payments || []) as Prisma.InputJsonValue,
            plan: {
                ...inputPlan,
                taxEnabled: taxRate > 0,
                taxRate,
                breakdown: {
                    ...planBreakdown,
                    subtotal: totals.subtotal,
                    discount: totals.discount,
                    tax: totals.tax,
                    total: totals.total,
                },
            } as Prisma.InputJsonValue,
            notes: nullableText(input.notes),
            validUntil: parseOptionalDate(input.validUntil, operationTimeZone),
            acceptedAt: status === "accepted" ? new Date() : null,
        };

        const budget = input.id
            ? await prisma.patientBudget.update({ where: { id: input.id }, data })
            : await prisma.patientBudget.create({ data });

        await recalculatePatientBalance(input.patientId);
        revalidatePatientSurfaces(input.patientId);
        return { success: true, budget };
    } catch (error) {
        console.error("Failed to save budget:", error);
        return { success: false, error: "No se pudo guardar el presupuesto." };
    }
}

export async function updateBudgetStatus(id: string, patientId: string, status: string) {
    await requirePermission("billing.manage");

    try {
        const budget = await prisma.patientBudget.update({
            where: { id },
            data: {
                status,
                acceptedAt: status === "accepted" ? new Date() : status === "pending" ? null : undefined,
            },
        });
        await recalculatePatientBalance(patientId);
        revalidatePatientSurfaces(patientId);
        return { success: true, budget };
    } catch (error) {
        console.error("Failed to update budget status:", error);
        return { success: false, error: "No se pudo actualizar el presupuesto." };
    }
}

export async function addBudgetPayment(input: BudgetPaymentInput) {
    await requirePermission("billing.manage");

    if (!input.budgetId || !input.patientId || !Number.isFinite(Number(input.amount)) || Number(input.amount) <= 0) {
        return { success: false, error: "Monto invalido." };
    }

    try {
        const operationTimeZone = await getOperationTimeZone();
        const budget = await prisma.patientBudget.findUnique({ where: { id: input.budgetId } });
        if (!budget) return { success: false, error: "Presupuesto no encontrado." };

        const currentPayments = Array.isArray(budget.payments) ? budget.payments : [];
        const nextPayments = [
            ...currentPayments,
            {
                id: `PAY-${Date.now()}`,
                amount: Number(input.amount),
                currency: cleanText(input.currency) || undefined,
                method: cleanText(input.method) || "Efectivo",
                date: (parseOptionalDate(input.date, operationTimeZone) || new Date()).toISOString(),
            },
        ];

        const totalPaid = nextPayments.reduce<number>((sum, payment) => {
            if (!payment || typeof payment !== "object") return sum;
            return sum + Number((payment as { amount?: unknown }).amount || 0);
        }, 0);

        const status = totalPaid >= budget.total ? "paid" : "partial";
        const updated = await prisma.patientBudget.update({
            where: { id: input.budgetId },
            data: {
                payments: nextPayments as Prisma.InputJsonValue,
                status,
            },
        });

        await recalculatePatientBalance(input.patientId);
        revalidatePatientSurfaces(input.patientId);
        return { success: true, budget: updated };
    } catch (error) {
        console.error("Failed to add budget payment:", error);
        return { success: false, error: "No se pudo registrar el pago." };
    }
}

export async function deleteBudget(id: string, patientId: string) {
    await requirePermission("billing.manage");

    try {
        await prisma.patientBudget.delete({ where: { id } });
        await recalculatePatientBalance(patientId);
        revalidatePatientSurfaces(patientId);
        return { success: true };
    } catch (error) {
        console.error("Failed to delete budget:", error);
        return { success: false, error: "No se pudo eliminar el presupuesto." };
    }
}

export async function saveClinicalAnalysis(input: AnalysisInput) {
    await requirePermission("clinical.manage");

    if (!input.patientId || !cleanText(input.title)) {
        return { success: false, error: input.kind === "request" ? "Selecciona al menos un estudio." : "Captura el nombre del estudio." };
    }

    try {
        const operationTimeZone = await getOperationTimeZone();
        const data = {
            patientId: input.patientId,
            kind: input.kind || "result",
            title: cleanText(input.title) || "Estudio clinico",
            category: nullableText(input.category),
            results: nullableText(input.results),
            studies: (input.studies || []) as Prisma.InputJsonValue,
            resultDate: parseOptionalDate(input.resultDate, operationTimeZone),
            notes: nullableText(input.notes),
            files: (input.files || []) as Prisma.InputJsonValue,
        };

        const analysis = input.id
            ? await prisma.patientClinicalAnalysis.update({ where: { id: input.id }, data })
            : await prisma.patientClinicalAnalysis.create({ data });

        revalidatePatientSurfaces(input.patientId);
        return { success: true, analysis };
    } catch (error) {
        console.error("Failed to save clinical analysis:", error);
        return { success: false, error: "No se pudo guardar el analisis." };
    }
}

export async function deleteClinicalAnalysis(id: string, patientId: string) {
    await requirePermission("clinical.manage");

    try {
        await prisma.patientClinicalAnalysis.delete({ where: { id } });
        revalidatePatientSurfaces(patientId);
        return { success: true };
    } catch (error) {
        console.error("Failed to delete clinical analysis:", error);
        return { success: false, error: "No se pudo eliminar el analisis." };
    }
}

export async function summarizeConsultationTranscript(transcript: string) {
    await requirePermission("clinical.manage");

    const cleanTranscript = cleanText(transcript);
    if (!cleanTranscript) {
        return { success: false, error: "No hay transcripcion para resumir." };
    }

    try {
        const content = await generateCompletion([
            {
                role: "system",
                content: [
                    "Eres asistente clinico para oftalmologia.",
                    "No diagnostiques de forma autonoma.",
                    "Devuelve JSON valido con estas llaves: motivo_principal, nota_evolucion, signos_vitales, diagnostico, tratamiento, educacion_paciente.",
                    "Si no hay datos para una llave, usa cadena vacia u objeto vacio.",
                ].join(" "),
            },
            {
                role: "user",
                content: cleanTranscript,
            },
        ], 0.1);

        const text = content || "";
        try {
            return { success: true, summary: JSON.parse(text) };
        } catch {
            return { success: true, summary: text };
        }
    } catch (error) {
        console.error("Failed to summarize consultation transcript:", error);
        return { success: false, error: "No se pudo generar el resumen con IA." };
    }
}
