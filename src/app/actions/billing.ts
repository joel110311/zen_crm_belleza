"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import {
    findOrCreateActiveConversationForContact,
    sendOutboundConversationMessage,
} from "@/lib/outbound-messages";
import { getSystemSettingsOrDefaults } from "@/lib/system-settings";
import { getSessionUserId, requireAnyPermission, requirePermission } from "@/lib/authz";
import { buildOperationContext } from "@/lib/operation-context";
import { businessDateRangeBounds, businessDayBounds, zonedDateTimeToUtc } from "@/lib/calendar/business-hours";

type CashMovementInput = {
    id?: string;
    type?: "income" | "expense" | "adjustment";
    concept: string;
    amount: number;
    currency?: string;
    paymentMethod?: string;
    occurredAt?: string | Date;
    appointmentId?: string;
    patientId?: string;
    contactId?: string;
    specialistId?: string;
    notes?: string;
};

type PaymentLinkInput = {
    id?: string;
    appointmentId?: string;
    patientId?: string;
    contactId?: string;
    specialistId?: string;
    title: string;
    amount: number;
    currency?: string;
    provider?: "manual" | "mercadopago";
    url?: string;
    expiresAt?: string | Date | null;
    notes?: string;
};

function cleanText(value?: string | null) {
    return value?.trim() || undefined;
}

function nullableText(value?: string | null) {
    return value?.trim() || null;
}

function parseDate(value?: string | Date | null, timeZone?: string) {
    if (!value) return new Date();

    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) && timeZone) {
        return zonedDateTimeToUtc(value.trim(), "12:00", timeZone);
    }

    const parsed = value instanceof Date ? value : new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function amountValue(value: unknown) {
    const amount = Number(value);
    return Number.isFinite(amount) ? Math.max(0, amount) : 0;
}

function revalidateBilling() {
    revalidatePath("/dashboard/billing");
    revalidatePath("/dashboard/reception");
    revalidatePath("/dashboard/calendar");
    revalidatePath("/dashboard/reports");
}

async function resolveRecordedById(session: unknown) {
    const sessionUserId = getSessionUserId(session);
    if (sessionUserId) return sessionUserId;

    const fallbackUser = await prisma.user.findFirst({
        orderBy: { createdAt: "asc" },
        select: { id: true },
    });
    return fallbackUser?.id ?? null;
}

async function ensureContactFromAppointment(appointmentId?: string) {
    if (!appointmentId) return null;

    const appointment = await prisma.appointment.findUnique({
        where: { id: appointmentId },
        include: {
            contact: true,
            patient: true,
        },
    });

    if (!appointment) return null;
    if (appointment.contact) return appointment.contact;
    const phone = appointment.patient?.phone?.trim();
    if (!phone) return null;

    const contact = await prisma.contact.upsert({
        where: { phone },
        create: {
            phone,
            name: appointment.patient?.firstName || null,
            lastName: appointment.patient?.lastName || null,
            email: appointment.patient?.email || null,
            status: "customer",
        },
        update: {
            name: appointment.patient?.firstName || undefined,
            lastName: appointment.patient?.lastName || undefined,
            email: appointment.patient?.email || undefined,
            status: "customer",
        },
    });

    await prisma.$transaction([
        prisma.appointment.update({
            where: { id: appointment.id },
            data: { contactId: contact.id },
        }),
        ...(appointment.patientId
            ? [
                prisma.patient.update({
                    where: { id: appointment.patientId },
                    data: { contactId: contact.id },
                }),
            ]
            : []),
    ]);

    return contact;
}

export async function getBillableServices() {
    await requirePermission("billing.manage");

    const services = await prisma.service.findMany({
        where: {
            isActive: true,
            category: { isActive: true },
        },
        orderBy: [
            { category: { sortOrder: "asc" } },
            { sortOrder: "asc" },
            { name: "asc" },
        ],
        select: {
            id: true,
            name: true,
            description: true,
            price: true,
            currency: true,
            durationMinutes: true,
            category: { select: { name: true } },
        },
    });

    return services.map((service) => ({
        id: service.id,
        name: service.name,
        description: service.description,
        category: service.category.name,
        price: service.price,
        currency: service.currency,
        durationMinutes: service.durationMinutes,
    }));
}

export async function getCashDesk(date?: string | Date) {
    await requirePermission("billing.manage");

    const settings = await getSystemSettingsOrDefaults();
    const operationContext = buildOperationContext(settings);
    const { start, end, dateKey, timeZone } = businessDayBounds(date, operationContext.timeZone);

    const lastClosure = await prisma.cashClosure.findFirst({
        where: { dateKey },
        orderBy: { closedAt: "desc" },
        include: {
            closedBy: { select: { id: true, name: true, email: true } },
        },
    });
    const openFrom = lastClosure?.closedAt || start;

    const [movements, pendingLinks, paidAppointments, openMovements] = await Promise.all([
        prisma.cashMovement.findMany({
            where: {
                occurredAt: { gte: start, lt: end },
                status: { not: "cancelled" },
            },
            orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
            include: {
                appointment: {
                    select: { id: true, title: true, startTime: true },
                },
                patient: {
                    select: { id: true, firstName: true, lastName: true, phone: true },
                },
                specialist: {
                    select: { id: true, name: true, displayName: true },
                },
                recordedBy: {
                    select: { id: true, name: true, email: true },
                },
            },
        }),
        prisma.paymentLink.findMany({
            where: {
                status: { in: ["pending", "sent"] },
            },
            orderBy: { createdAt: "desc" },
            take: 20,
            include: {
                appointment: { select: { id: true, title: true, startTime: true } },
                patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
            },
        }),
        prisma.appointment.count({
            where: {
                startTime: { gte: start, lt: end },
                paymentStatus: "paid",
            },
        }),
        prisma.cashMovement.findMany({
            where: {
                occurredAt: { gte: openFrom, lt: end },
                status: { not: "cancelled" },
            },
            select: {
                id: true,
                type: true,
                amount: true,
                recordedBy: {
                    select: { id: true, name: true, email: true },
                },
            },
        }),
    ]);

    const income = movements
        .filter((movement) => movement.type === "income")
        .reduce((sum, movement) => sum + movement.amount, 0);
    const expense = movements
        .filter((movement) => movement.type === "expense")
        .reduce((sum, movement) => sum + movement.amount, 0);
    const openIncome = openMovements
        .filter((movement) => movement.type === "income")
        .reduce((sum, movement) => sum + movement.amount, 0);
    const openExpense = openMovements
        .filter((movement) => movement.type === "expense")
        .reduce((sum, movement) => sum + movement.amount, 0);
    const methodSummary = movements.reduce<Record<string, { income: number; expense: number; count: number }>>((summary, movement) => {
        const key = movement.paymentMethod || "sin_metodo";
        summary[key] ??= { income: 0, expense: 0, count: 0 };
        summary[key].count += 1;
        if (movement.type === "income") summary[key].income += movement.amount;
        if (movement.type === "expense") summary[key].expense += movement.amount;
        return summary;
    }, {});
    const conceptSummary = movements.reduce<Record<string, { income: number; expense: number; count: number }>>((summary, movement) => {
        const key = movement.concept || "Sin concepto";
        summary[key] ??= { income: 0, expense: 0, count: 0 };
        summary[key].count += 1;
        if (movement.type === "income") summary[key].income += movement.amount;
        if (movement.type === "expense") summary[key].expense += movement.amount;
        return summary;
    }, {});
    const userSummary = movements.reduce<Record<string, { name: string; income: number; expense: number; count: number }>>((summary, movement) => {
        const key = movement.recordedBy?.id || "sin_usuario";
        const name = movement.recordedBy?.name || movement.recordedBy?.email || "Sin usuario asignado";
        summary[key] ??= { name, income: 0, expense: 0, count: 0 };
        summary[key].count += 1;
        if (movement.type === "income") summary[key].income += movement.amount;
        if (movement.type === "expense") summary[key].expense += movement.amount;
        return summary;
    }, {});
    const openUserSummary = openMovements.reduce<Record<string, { name: string; income: number; expense: number; count: number }>>((summary, movement) => {
        const key = movement.recordedBy?.id || "sin_usuario";
        const name = movement.recordedBy?.name || movement.recordedBy?.email || "Sin usuario asignado";
        summary[key] ??= { name, income: 0, expense: 0, count: 0 };
        summary[key].count += 1;
        if (movement.type === "income") summary[key].income += movement.amount;
        if (movement.type === "expense") summary[key].expense += movement.amount;
        return summary;
    }, {});

    return {
        date: start.toISOString(),
        dateKey,
        timeZone,
        operationContext,
        pos: {
            taxEnabled: settings.posTaxEnabled,
            taxRate: settings.posTaxRate,
            ticketEnabled: settings.posTicketEnabled,
            ticketShowUnitPrice: settings.posTicketShowUnitPrice,
            ticketFullDescription: settings.posTicketFullDescription,
            ticketHeader: settings.posTicketHeader,
            ticketFooter: settings.posTicketFooter,
        },
        income,
        expense,
        balance: income - expense,
        count: movements.length,
        methodSummary,
        conceptSummary,
        userSummary,
        paidAppointments,
        movements,
        pendingLinks,
        lastClosure,
        openFrom: openFrom.toISOString(),
        openIncome,
        openExpense,
        openBalance: openIncome - openExpense,
        openMovementCount: openMovements.length,
        openUserSummary,
    };
}

export async function saveCashMovement(input: CashMovementInput) {
    const session = await requirePermission("billing.manage");
    const recordedById = await resolveRecordedById(session);

    const concept = cleanText(input.concept);
    const amount = amountValue(input.amount);
    if (!concept || amount <= 0) {
        return { success: false, error: "Captura concepto y monto valido." };
    }

    try {
        const settings = await getSystemSettingsOrDefaults();
        const operationContext = buildOperationContext(settings);
        const data = {
            type: input.type || "income",
            concept,
            amount,
            currency: cleanText(input.currency) || settings.paymentDefaultCurrency || "MXN",
            paymentMethod: cleanText(input.paymentMethod) || "efectivo",
            occurredAt: parseDate(input.occurredAt, operationContext.timeZone),
            appointmentId: nullableText(input.appointmentId),
            patientId: nullableText(input.patientId),
            contactId: nullableText(input.contactId),
            specialistId: nullableText(input.specialistId),
            notes: nullableText(input.notes),
        };

        const existingMovement = input.id
            ? await prisma.cashMovement.findUnique({
                where: { id: input.id },
                select: { recordedById: true },
            })
            : null;

        const movement = input.id
            ? await prisma.cashMovement.update({
                where: { id: input.id },
                data: {
                    ...data,
                    ...(!existingMovement?.recordedById && recordedById ? { recordedById } : {}),
                },
            })
            : await prisma.cashMovement.create({ data: { ...data, recordedById } });

        revalidateBilling();
        return { success: true, movement };
    } catch (error) {
        console.error("Failed to save cash movement:", error);
        return { success: false, error: "No se pudo guardar el movimiento de caja." };
    }
}

export async function deleteCashMovement(id: string) {
    await requirePermission("billing.manage");

    try {
        await prisma.cashMovement.update({
            where: { id },
            data: { status: "cancelled" },
        });
        revalidateBilling();
        return { success: true };
    } catch (error) {
        console.error("Failed to cancel cash movement:", error);
        return { success: false, error: "No se pudo cancelar el movimiento." };
    }
}

export async function registerAppointmentPayment(appointmentId: string, amount: number, paymentMethod = "efectivo") {
    const session = await requirePermission("billing.manage");
    const recordedById = await resolveRecordedById(session);

    const safeAmount = amountValue(amount);
    if (!appointmentId || safeAmount <= 0) {
        return { success: false, error: "Selecciona cita y monto valido." };
    }

    try {
        const settings = await getSystemSettingsOrDefaults();
        const appointment = await prisma.appointment.findUnique({
            where: { id: appointmentId },
            include: {
                patient: true,
                contact: true,
                specialist: true,
            },
        });

        if (!appointment) {
            return { success: false, error: "La cita no existe." };
        }

        const concept = `Cobro: ${appointment.title}`;
        const currency = appointment.paymentCurrency || settings.paymentDefaultCurrency || "MXN";

        const movement = await prisma.$transaction(async (tx) => {
            const existingMovement = await tx.cashMovement.findFirst({
                where: {
                    appointmentId: appointment.id,
                    type: "income",
                    status: { not: "cancelled" },
                },
                orderBy: { occurredAt: "desc" },
            });

            if (existingMovement) {
                if (!existingMovement.recordedById && recordedById) {
                    await tx.cashMovement.update({
                        where: { id: existingMovement.id },
                        data: { recordedById },
                    });
                }
                await tx.appointment.update({
                    where: { id: appointment.id },
                    data: {
                        paymentStatus: "paid",
                        paymentAmount: appointment.paymentAmount || existingMovement.amount,
                        paymentCurrency: appointment.paymentCurrency || existingMovement.currency,
                    },
                });
                return existingMovement;
            }

            const movement = await tx.cashMovement.create({
                data: {
                    type: "income",
                    concept,
                    amount: safeAmount,
                    currency,
                    paymentMethod,
                    appointmentId: appointment.id,
                    patientId: appointment.patientId,
                    contactId: appointment.contactId,
                    specialistId: appointment.specialistId,
                    recordedById,
                    notes: "Cobro registrado desde agenda/recepcion.",
                },
            });

            await tx.appointment.update({
                where: { id: appointment.id },
                data: {
                    paymentStatus: "paid",
                    paymentAmount: safeAmount,
                    paymentCurrency: currency,
                },
            });

            await tx.paymentLink.updateMany({
                where: {
                    appointmentId: appointment.id,
                    status: { in: ["pending", "sent"] },
                },
                data: {
                    status: "paid",
                    paidAt: new Date(),
                },
            });

            return movement;
        });

        revalidateBilling();
        return { success: true, movement };
    } catch (error) {
        console.error("Failed to register appointment payment:", error);
        return { success: false, error: "No se pudo registrar el cobro de la cita." };
    }
}

export async function markAppointmentNoCharge(appointmentId: string) {
    await requireAnyPermission(["billing.manage", "reception.manage"]);

    if (!appointmentId) {
        return { success: false, error: "Selecciona una cita valida." };
    }

    try {
        const appointment = await prisma.appointment.findUnique({
            where: { id: appointmentId },
            select: {
                id: true,
                paymentStatus: true,
            },
        });

        if (!appointment) {
            return { success: false, error: "La cita no existe." };
        }

        if (appointment.paymentStatus === "paid") {
            const existingMovement = await prisma.cashMovement.findFirst({
                where: {
                    appointmentId: appointment.id,
                    type: "income",
                    status: { not: "cancelled" },
                },
            });
            if (existingMovement) {
                return { success: false, error: "La cita ya tiene un pago registrado en caja." };
            }
        }

        await prisma.appointment.update({
            where: { id: appointment.id },
            data: {
                paymentStatus: "unpaid",
                paymentAmount: 0,
                paymentLinkUrl: null,
            },
        });

        revalidateBilling();
        return { success: true };
    } catch (error) {
        console.error("Failed to close appointment without charge:", error);
        return { success: false, error: "No se pudo cerrar la cita sin cobro." };
    }
}

export async function closeCashDesk(date?: string | Date, notes?: string) {
    const session = await requirePermission("billing.manage");
    const closedById = await resolveRecordedById(session);

    try {
        const settings = await getSystemSettingsOrDefaults();
        const operationContext = buildOperationContext(settings);
        const { start, end, dateKey, timeZone } = businessDayBounds(date, operationContext.timeZone);
        const lastClosure = await prisma.cashClosure.findFirst({
            where: { dateKey },
            orderBy: { closedAt: "desc" },
        });
        const from = lastClosure?.closedAt || start;
        const to = new Date();
        const boundedTo = to > end ? end : to;

        if (boundedTo <= from) {
            return { success: false, error: "No hay periodo abierto para cortar." };
        }

        const movements = await prisma.cashMovement.findMany({
            where: {
                occurredAt: { gte: from, lt: boundedTo },
                status: { not: "cancelled" },
            },
            select: {
                type: true,
                amount: true,
            },
        });
        const income = movements
            .filter((movement) => movement.type === "income")
            .reduce((sum, movement) => sum + movement.amount, 0);
        const expense = movements
            .filter((movement) => movement.type === "expense")
            .reduce((sum, movement) => sum + movement.amount, 0);

        const closure = await prisma.cashClosure.create({
            data: {
                dateKey,
                timeZone,
                from,
                to: boundedTo,
                income,
                expense,
                balance: income - expense,
                movementCount: movements.length,
                notes: nullableText(notes),
                closedById,
            },
            include: {
                closedBy: { select: { id: true, name: true, email: true } },
            },
        });

        revalidateBilling();
        return { success: true, closure };
    } catch (error) {
        console.error("Failed to close cash desk:", error);
        return { success: false, error: "No se pudo realizar el corte de caja." };
    }
}

export async function markAppointmentDebt(appointmentId: string, amount: number) {
    await requireAnyPermission(["billing.manage", "reception.manage"]);

    const safeAmount = amountValue(amount);
    if (!appointmentId || safeAmount <= 0) {
        return { success: false, error: "Captura el monto que quedara como adeudo." };
    }

    try {
        const settings = await getSystemSettingsOrDefaults();
        const appointment = await prisma.appointment.findUnique({
            where: { id: appointmentId },
            select: {
                id: true,
                paymentCurrency: true,
            },
        });

        if (!appointment) {
            return { success: false, error: "La cita no existe." };
        }

        await prisma.appointment.update({
            where: { id: appointment.id },
            data: {
                paymentStatus: "pending",
                paymentAmount: safeAmount,
                paymentCurrency: appointment.paymentCurrency || settings.paymentDefaultCurrency || "MXN",
            },
        });

        revalidateBilling();
        return { success: true };
    } catch (error) {
        console.error("Failed to mark appointment debt:", error);
        return { success: false, error: "No se pudo dejar el adeudo de la cita." };
    }
}

export async function createPaymentLink(input: PaymentLinkInput) {
    await requirePermission("billing.manage");

    const title = cleanText(input.title);
    const amount = amountValue(input.amount);
    if (!title || amount <= 0) {
        return { success: false, error: "Captura titulo y monto valido." };
    }

    try {
        const settings = await getSystemSettingsOrDefaults();
        const operationContext = buildOperationContext(settings);
        const contact = input.contactId
            ? await prisma.contact.findUnique({ where: { id: input.contactId } })
            : await ensureContactFromAppointment(input.appointmentId);

        const link = await prisma.paymentLink.create({
            data: {
                provider: input.provider || "manual",
                title,
                amount,
                currency: cleanText(input.currency) || settings.paymentDefaultCurrency || "MXN",
                url: nullableText(input.url),
                appointmentId: nullableText(input.appointmentId),
                patientId: nullableText(input.patientId),
                contactId: contact?.id || nullableText(input.contactId),
                specialistId: nullableText(input.specialistId),
                expiresAt: input.expiresAt ? parseDate(input.expiresAt, operationContext.timeZone) : null,
                notes: nullableText(input.notes),
            },
            include: {
                appointment: true,
                patient: true,
                contact: true,
            },
        });

        if (link.appointmentId) {
            await prisma.appointment.update({
                where: { id: link.appointmentId },
                data: {
                    paymentStatus: "pending",
                    paymentAmount: amount,
                    paymentCurrency: link.currency,
                    paymentLinkUrl: link.url,
                },
            });
        }

        revalidateBilling();
        return { success: true, link };
    } catch (error) {
        console.error("Failed to create payment link:", error);
        return { success: false, error: "No se pudo crear el link de pago." };
    }
}

export async function markPaymentLinkPaid(id: string, paymentMethod = "link") {
    const session = await requirePermission("billing.manage");
    const recordedById = await resolveRecordedById(session);

    try {
        const link = await prisma.paymentLink.findUnique({
            where: { id },
            include: {
                appointment: true,
            },
        });
        if (!link) return { success: false, error: "El link no existe." };

        const movement = await prisma.$transaction(async (tx) => {
            const movement = await tx.cashMovement.create({
                data: {
                    type: "income",
                    concept: `Pago link: ${link.title}`,
                    amount: link.amount,
                    currency: link.currency,
                    paymentMethod,
                    appointmentId: link.appointmentId,
                    patientId: link.patientId,
                    contactId: link.contactId,
                    specialistId: link.specialistId,
                    recordedById,
                    notes: link.url || link.provider,
                },
            });

            await tx.paymentLink.update({
                where: { id },
                data: {
                    status: "paid",
                    paidAt: new Date(),
                },
            });

            if (link.appointmentId) {
                await tx.appointment.update({
                    where: { id: link.appointmentId },
                    data: {
                        paymentStatus: "paid",
                        paymentAmount: link.amount,
                        paymentCurrency: link.currency,
                    },
                });
            }

            return movement;
        });

        revalidateBilling();
        return { success: true, movement };
    } catch (error) {
        console.error("Failed to mark payment link paid:", error);
        return { success: false, error: "No se pudo marcar el link como pagado." };
    }
}

export async function sendPaymentLink(id: string) {
    await requirePermission("billing.manage");

    try {
        const link = await prisma.paymentLink.findUnique({
            where: { id },
            include: {
                appointment: true,
                patient: true,
                contact: true,
            },
        });

        if (!link) return { success: false, error: "El link no existe." };
        if (!link.url) return { success: false, error: "Este link no tiene URL para enviar." };

        const contact = link.contact || await ensureContactFromAppointment(link.appointmentId || undefined);
        if (!contact?.id) return { success: false, error: "No hay contacto con WhatsApp para enviar el link." };

        const patientName = [link.patient?.firstName, link.patient?.lastName].filter(Boolean).join(" ") || "cliente";
        const message = [
            `Hola ${patientName}, te compartimos tu link de pago de Zen CRM Oftalmo.`,
            `${link.title}: ${link.currency} ${link.amount.toFixed(2)}.`,
            link.url,
        ].join("\n");

        const conversation = await findOrCreateActiveConversationForContact(contact.id);
        await sendOutboundConversationMessage({
            conversationId: conversation.id,
            content: message,
            type: "text",
            preserveBotActive: true,
            senderType: "system",
        });

        await prisma.paymentLink.update({
            where: { id },
            data: {
                status: "sent",
                sentAt: new Date(),
            },
        });

        revalidateBilling();
        return { success: true };
    } catch (error) {
        console.error("Failed to send payment link:", error);
        return { success: false, error: "No se pudo enviar el link de pago." };
    }
}

export async function getBillingReport(dateFrom?: string | Date, dateTo?: string | Date) {
    await requirePermission("reports.view");

    const settings = await getSystemSettingsOrDefaults();
    const operationContext = buildOperationContext(settings);
    const { start, end, fromKey, toKey, timeZone } = businessDateRangeBounds(
        dateFrom,
        dateTo,
        operationContext.timeZone,
    );

    const [movements, appointmentsByStatus, appointmentsByPayment] = await Promise.all([
        prisma.cashMovement.findMany({
            where: {
                occurredAt: { gte: start, lt: end },
                status: { not: "cancelled" },
            },
            orderBy: { occurredAt: "asc" },
            include: {
                patient: { select: { firstName: true, lastName: true } },
                specialist: { select: { name: true, displayName: true } },
                appointment: { select: { title: true, startTime: true } },
            },
        }),
        prisma.appointment.groupBy({
            by: ["status"],
            where: { startTime: { gte: start, lt: end } },
            _count: true,
        }),
        prisma.appointment.groupBy({
            by: ["paymentStatus"],
            where: { startTime: { gte: start, lt: end } },
            _count: true,
            _sum: { paymentAmount: true },
        }),
    ]);

    const income = movements
        .filter((movement) => movement.type === "income")
        .reduce((sum, movement) => sum + movement.amount, 0);
    const expense = movements
        .filter((movement) => movement.type === "expense")
        .reduce((sum, movement) => sum + movement.amount, 0);

    return {
        from: start.toISOString(),
        to: end.toISOString(),
        fromKey,
        toKey,
        timeZone,
        income,
        expense,
        balance: income - expense,
        movements,
        appointmentsByStatus,
        appointmentsByPayment,
    };
}
