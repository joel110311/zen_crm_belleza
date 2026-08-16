"use server";

import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { getBusinessHoursConfig, getAvailableSlotsForDate, createManagedAppointment } from "@/lib/calendar/appointments";
import { zonedDateTimeToUtc } from "@/lib/calendar/business-hours";
import { buildOperationContext, normalizePhoneForOperation, parsePhoneByCountry } from "@/lib/operation-context";
import { getSystemSettingsOrDefaults } from "@/lib/system-settings";
import { getEducationArticles } from "@/app/actions/education";
import { consumeRateLimit, getRequestIp } from "@/lib/security";

type PortalBookingInput = {
    slug: string;
    specialistId: string;
    serviceId?: string;
    date: string;
    time: string;
    durationMinutes?: number;
    firstName: string;
    lastName: string;
    phone: string;
    email?: string;
    reason?: string;
    isFirstVisit?: boolean;
    sendReminders?: boolean;
    paymentMethod?: string;
};

function cleanText(value?: string | null) {
    return value?.trim() || "";
}

function makePatientNumber() {
    return `CLI-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
}

function makePublicToken() {
    return crypto.randomUUID().replace(/-/g, "");
}

const DEFAULT_PORTAL_SLUG = "belleza";

function portalSlugMatches(expected?: string | null, requested?: string) {
    return (expected || DEFAULT_PORTAL_SLUG).trim().toLowerCase() === (requested || DEFAULT_PORTAL_SLUG).trim().toLowerCase();
}

function isGenericPersonName(value?: string | null) {
    const normalized = cleanText(value).toLocaleLowerCase("es-MX");
    return !normalized || ["cliente", "contacto", "usuario", "sin nombre"].includes(normalized);
}

function resolvePortalColor(value?: string | null) {
    return !value || value.toUpperCase() === "#2563EB" ? "#4B5F25" : value;
}

function resolvePortalName(value?: string | null) {
    return !value || /oftalm/i.test(value) ? "Zen CRM Belleza" : value;
}

function resolvePortalIntro(value?: string | null) {
    return !value || /oftalm/i.test(value) ? "Aparta el horario para tu próximo servicio." : value;
}

function resolvePortalPaymentInstructions(value?: string | null) {
    return value && /recepcion|consulta oftalm|antes de tu cita/i.test(value)
        ? "El método de pago o apartado se confirmará al reservar."
        : value || null;
}

function resolveBusinessSubtitle(value?: string | null) {
    return !value || /oftalm|cl[ií]nica/i.test(value) ? "Servicios de belleza" : value;
}

async function ensurePortalEnabled(slug: string) {
    const settings = await getSystemSettingsOrDefaults();
    if (!settings.portalEnabled || !portalSlugMatches(settings.portalSlug, slug)) {
        return null;
    }
    return settings;
}

export async function getPortalData(slug = DEFAULT_PORTAL_SLUG) {
    const settings = await getSystemSettingsOrDefaults();
    if (!portalSlugMatches(settings.portalSlug, slug)) return null;

    const presentation = {
        enabled: Boolean(settings.portalEnabled),
        clinicName: resolvePortalName(settings.clinicName || settings.portalClinicName),
        intro: resolvePortalIntro(settings.portalIntro),
        primaryColor: resolvePortalColor(settings.portalPrimaryColor),
        paymentInstructions: resolvePortalPaymentInstructions(settings.portalPaymentInstructions),
        logoUrl: settings.clinicLogoUrl || settings.brandLogoUrl || null,
        logoScale: settings.clinicLogoScale || 100,
        subtitle: resolveBusinessSubtitle(settings.clinicSubtitle),
        address: settings.clinicAddress || null,
        slug: settings.portalSlug || DEFAULT_PORTAL_SLUG,
        defaultDurationMinutes: settings.appointmentDurationMinutes || 30,
        remindersEnabled: Boolean(settings.appointmentRemindersEnabled && settings.reminderWhatsAppEnabled),
        operationContext: buildOperationContext(settings),
    };

    if (!presentation.enabled) {
        return {
            ...presentation,
            specialists: [],
            services: [],
            articles: [],
        };
    }

    let specialists = await prisma.specialist.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: {
            id: true,
            name: true,
            displayName: true,
            specialty: true,
            color: true,
            room: true,
            bio: true,
            defaultDurationMinutes: true,
            googleCalendarSource: {
                select: {
                    calendarId: true,
                    summary: true,
                    backgroundColor: true,
                },
            },
        },
    });

    if (specialists.length === 0) {
        const created = await prisma.specialist.create({
            data: {
                name: "Profesional de belleza",
                displayName: "Profesional de belleza",
                specialty: "Belleza",
                color: resolvePortalColor(settings.portalPrimaryColor),
                defaultDurationMinutes: settings.appointmentDurationMinutes || 30,
                isActive: true,
            },
            select: {
                id: true,
                name: true,
                displayName: true,
                specialty: true,
                color: true,
                room: true,
                bio: true,
                defaultDurationMinutes: true,
                googleCalendarSource: {
                    select: {
                        calendarId: true,
                        summary: true,
                        backgroundColor: true,
                    },
                },
            },
        });
        specialists = [created];
    }

    const services = await prisma.service.findMany({
        where: { isActive: true, category: { isActive: true } },
        orderBy: [{ isFeatured: "desc" }, { category: { sortOrder: "asc" } }, { sortOrder: "asc" }, { name: "asc" }],
        select: {
            id: true,
            name: true,
            description: true,
            price: true,
            currency: true,
            durationMinutes: true,
            imageUrl: true,
            showPrice: true,
            category: { select: { name: true } },
            specialists: {
                where: { specialist: { isActive: true } },
                select: { specialistId: true },
            },
        },
    });

    const articles = await getEducationArticles(false);

    return {
        ...presentation,
        specialists,
        services,
        articles,
    };
}

export async function getPortalAvailability(slug: string, specialistId: string, date: string, durationMinutes?: number) {
    const requestHeaders = await headers();
    const rateLimit = consumeRateLimit(`portal-availability:${getRequestIp(requestHeaders)}`, {
        limit: 120,
        windowMs: 60 * 1000,
    });
    if (!rateLimit.allowed) {
        return { success: false, error: "Demasiadas consultas. Intenta de nuevo en un minuto.", slots: [] as string[] };
    }

    const settings = await ensurePortalEnabled(slug);
    if (!settings) {
        return { success: false, error: "El portal no esta disponible.", slots: [] as string[] };
    }

    const specialist = await prisma.specialist.findFirst({
        where: {
            id: specialistId,
            isActive: true,
        },
        include: { googleCalendarSource: true },
    });

    if (!specialist) {
        return { success: false, error: "Selecciona un especialista valido.", slots: [] as string[] };
    }

    const config = await getBusinessHoursConfig();
    const safeDurationMinutes = Math.min(480, Math.max(15, durationMinutes || specialist.defaultDurationMinutes || settings.appointmentDurationMinutes || 30));
    const durationMs = safeDurationMinutes * 60 * 1000;
    const result = await getAvailableSlotsForDate(date, durationMs, config, {
        specialistId: specialist.id,
        calendarIds: specialist.googleCalendarSource?.calendarId
            ? [specialist.googleCalendarSource.calendarId]
            : undefined,
        limit: 24,
    });

    return {
        success: true,
        isOpen: result.isOpen,
        schedule: result.schedule,
        slots: result.slots.map((slot) => slot.toISOString()),
    };
}

export async function bookPortalAppointment(input: PortalBookingInput) {
    const requestHeaders = await headers();
    const ip = getRequestIp(requestHeaders);
    const requestLimit = consumeRateLimit(`portal-booking:${ip}`, { limit: 8, windowMs: 10 * 60 * 1000 });
    if (!requestLimit.allowed) {
        return { success: false, error: "Has realizado demasiados intentos. Espera unos minutos antes de volver a reservar." };
    }

    const settings = await ensurePortalEnabled(input.slug);
    if (!settings) {
        return { success: false, error: "El portal no esta disponible." };
    }

    const firstName = cleanText(input.firstName);
    const lastName = cleanText(input.lastName);
    const phone = normalizePhoneForOperation(input.phone, settings.phoneDefaultCountry);
    const specialistId = cleanText(input.specialistId);
    const serviceId = cleanText(input.serviceId);
    const selectedService = serviceId
        ? await prisma.service.findFirst({
            where: { id: serviceId, isActive: true, category: { isActive: true } },
            include: { specialists: { select: { specialistId: true } } },
        })
        : null;
    const reason = selectedService?.name || cleanText(input.reason) || "Servicio de belleza";
    const allowedPaymentMethods = new Set(["efectivo", "tarjeta", "transferencia"]);
    const paymentMethod = allowedPaymentMethods.has(cleanText(input.paymentMethod))
        ? cleanText(input.paymentMethod)
        : "efectivo";

    if (!firstName || !phone || !specialistId || !input.date || !input.time) {
        return { success: false, error: "Completa nombre, teléfono, profesional, fecha y hora." };
    }
    if (firstName.length > 80 || lastName.length > 100 || cleanText(input.email).length > 254 || cleanText(input.reason).length > 500) {
        return { success: false, error: "Uno de los datos ingresados supera la longitud permitida." };
    }

    const phoneDigits = phone.replace(/\D/g, "");
    if (phoneDigits.length < 8 || phoneDigits.length > 15) {
        return { success: false, error: "Ingresa un número de teléfono válido." };
    }

    const phoneLimit = consumeRateLimit(`portal-booking-phone:${phoneDigits}`, { limit: 4, windowMs: 30 * 60 * 1000 });
    if (!phoneLimit.allowed) {
        return { success: false, error: "Ese teléfono alcanzó el límite temporal de reservaciones. Intenta más tarde." };
    }

    const specialist = await prisma.specialist.findFirst({
        where: {
            id: specialistId,
            isActive: true,
        },
        include: { googleCalendarSource: true },
    });

    if (!specialist) {
        return { success: false, error: "El especialista seleccionado no esta disponible." };
    }
    const assignedSpecialistIds = selectedService?.specialists.map((entry) => entry.specialistId) || [];
    if (selectedService && assignedSpecialistIds.length > 0 && !assignedSpecialistIds.includes(specialist.id)) {
        return { success: false, error: "El profesional seleccionado no realiza este servicio." };
    }

    const config = await getBusinessHoursConfig();
    const startTime = zonedDateTimeToUtc(input.date, input.time, config.timeZone);
    if (Number.isNaN(startTime.getTime())) {
        return { success: false, error: "La fecha u hora no son validas." };
    }

    const durationMinutes = Math.min(480, Math.max(15, selectedService?.durationMinutes || input.durationMinutes || specialist.defaultDurationMinutes || settings.appointmentDurationMinutes || 30));
    const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);
    const makeVirtual = Boolean(settings.googleMeetEnabled && settings.googleMeetDefaultVirtual);
    const remindersEnabled = Boolean(settings.appointmentRemindersEnabled && settings.reminderWhatsAppEnabled);
    const parsedPhone = parsePhoneByCountry(phone, settings.phoneDefaultCountry);
    const phoneCandidates = Array.from(new Set([
        phone,
        parsedPhone.fullNumber,
        parsedPhone.nationalNumber,
        parsedPhone.country.code === "MX" && parsedPhone.nationalNumber.length === 10
            ? `521${parsedPhone.nationalNumber}`
            : "",
    ].filter(Boolean)));

    try {
        const { patient, contact } = await prisma.$transaction(async (tx) => {
            const existingContact = await tx.contact.findFirst({
                where: {
                    OR: [
                        { phone: { in: phoneCandidates } },
                        ...(parsedPhone.nationalNumber.length >= 8
                            ? [{ phone: { endsWith: parsedPhone.nationalNumber } }]
                            : []),
                    ],
                },
                orderBy: { updatedAt: "desc" },
            });

            const contact = existingContact
                ? await tx.contact.update({
                    where: { id: existingContact.id },
                    data: {
                        name: isGenericPersonName(existingContact.name) ? firstName : undefined,
                        lastName: isGenericPersonName(existingContact.name) || !existingContact.lastName?.trim()
                            ? lastName || undefined
                            : undefined,
                        email: existingContact.email?.trim() ? undefined : cleanText(input.email) || undefined,
                        status: "customer",
                    },
                })
                : await tx.contact.create({
                    data: {
                    phone,
                    name: firstName,
                    lastName,
                    email: cleanText(input.email) || null,
                    status: "customer",
                    tags: ["Cliente"],
                },
                });

            const existingPatient = await tx.patient.findFirst({
                where: {
                    OR: [
                        { contactId: contact.id },
                        { phone: { in: phoneCandidates } },
                        ...(parsedPhone.nationalNumber.length >= 8
                            ? [{ phone: { endsWith: parsedPhone.nationalNumber } }]
                            : []),
                    ],
                },
                orderBy: { updatedAt: "desc" },
            });

            const patient = existingPatient
                ? await tx.patient.update({
                    where: { id: existingPatient.id },
                    data: {
                        firstName: isGenericPersonName(existingPatient.firstName) ? firstName : undefined,
                        lastName: isGenericPersonName(existingPatient.firstName) || !existingPatient.lastName?.trim()
                            ? lastName
                            : undefined,
                        email: cleanText(input.email) || existingPatient.email,
                        contactId: contact.id,
                    },
                })
                : await tx.patient.create({
                    data: {
                        patientNumber: makePatientNumber(),
                        firstName,
                        lastName,
                        phone,
                        email: cleanText(input.email) || null,
                        contactId: contact.id,
                    },
                });

            return { patient, contact };
        });

        const appointment = await createManagedAppointment({
            title: reason,
            startTime,
            endTime,
            notes: cleanText(input.reason) || undefined,
            contactId: contact.id,
            patientId: patient.id,
            specialistId: specialist.id,
            serviceId: selectedService?.id,
            appointmentType: selectedService?.name || "Servicio",
            source: "portal",
            isFirstVisit: Boolean(input.isFirstVisit),
            confirmationStatus: "pending",
            remindersOptOut: remindersEnabled ? input.sendReminders === false : true,
            publicToken: makePublicToken(),
            visitMode: makeVirtual ? "virtual" : "presencial",
            meetStatus: makeVirtual ? "requested" : "none",
            googleCalendarId: specialist.googleCalendarSource?.calendarId || undefined,
            googleCalendarName: specialist.googleCalendarSource?.summary || undefined,
            googleCalendarColor: specialist.googleCalendarSource?.backgroundColor || specialist.color || undefined,
            specialistName: specialist.displayName || specialist.name,
            paymentStatus: selectedService && selectedService.price > 0 ? "pending" : "unpaid",
            paymentAmount: selectedService?.price || 0,
            paymentCurrency: selectedService?.currency || settings.paymentDefaultCurrency || "MXN",
            paymentMethod,
            blockingCalendarIds: specialist.googleCalendarSource?.calendarId
                ? [specialist.googleCalendarSource.calendarId]
                : undefined,
        });

        revalidatePath("/dashboard/calendar");
        revalidatePath("/dashboard/reception");
        revalidatePath("/dashboard/patients");

        return {
            success: true,
            appointmentId: appointment.id,
            token: appointment.publicToken,
            clientName: [contact.name, contact.lastName].filter(Boolean).join(" ").trim() || firstName,
        };
    } catch (error) {
        console.error("Failed to book portal appointment:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "No se pudo agendar la cita.",
        };
    }
}
