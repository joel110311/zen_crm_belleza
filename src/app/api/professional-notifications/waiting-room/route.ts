import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getSessionAccessSubject, getSessionUserId, ensureAuthenticatedResponse } from "@/lib/authz";
import { hasAnyPermission, normalizeRole } from "@/lib/permissions";
import { getSystemSettingsOrDefaults } from "@/lib/system-settings";
import { buildOperationContext } from "@/lib/operation-context";
import { businessDayBounds } from "@/lib/calendar/business-hours";
import { getActiveTenantRuntimeContext } from "@/lib/active-tenant-context";

function sessionUserName(session: unknown) {
    return (session as { user?: { name?: string | null } } | null)?.user?.name?.trim() || "";
}

function patientDisplayName(appointment: {
    title: string;
    patient?: { firstName: string; lastName?: string | null } | null;
    contact?: { name?: string | null; lastName?: string | null; phone?: string | null } | null;
}) {
    if (appointment.patient) {
        return [appointment.patient.firstName, appointment.patient.lastName].filter(Boolean).join(" ");
    }
    return [appointment.contact?.name, appointment.contact?.lastName].filter(Boolean).join(" ") ||
        appointment.contact?.phone ||
        appointment.title;
}

export async function GET() {
    const session = await auth();
    const unauthorized = ensureAuthenticatedResponse(session);
    if (unauthorized) return unauthorized;

    const authScope = (session?.user as { authScope?: unknown } | undefined)?.authScope;
    if (authScope === "control" && !(await getActiveTenantRuntimeContext("read"))) {
        return NextResponse.json({
            timeZone: "America/Mexico_City",
            locale: "es-MX",
            notifications: [],
        });
    }

    const subject = getSessionAccessSubject(session);
    if (!hasAnyPermission(subject, ["calendar.manage", "clinical.manage", "reception.manage"])) {
        return NextResponse.json({ error: "No tienes permiso para ver sala de espera." }, { status: 403 });
    }

    const userId = getSessionUserId(session);
    const role = normalizeRole(subject?.role);
    const canSeeAll = role === "ADMINISTRADOR" || hasAnyPermission(subject, ["reception.manage", "specialists.manage"]);
    const professionalName = sessionUserName(session);
    const settings = await getSystemSettingsOrDefaults();
    const operationContext = buildOperationContext(settings);
    const { start, end } = businessDayBounds(new Date(), operationContext.timeZone);

    const assignedToCurrentUser = userId
        ? {
            OR: [
                { userId },
                { specialist: { userId } },
                ...(professionalName ? [{ specialistName: { equals: professionalName, mode: "insensitive" as const } }] : []),
            ],
        }
        : {};

    const appointments = await prisma.appointment.findMany({
        where: {
            status: "waiting",
            startTime: { gte: start, lt: end },
            ...(canSeeAll ? {} : assignedToCurrentUser),
        },
        orderBy: [
            { arrivalAt: "desc" },
            { startTime: "asc" },
        ],
        take: 8,
        select: {
            id: true,
            title: true,
            startTime: true,
            endTime: true,
            arrivalAt: true,
            specialistName: true,
            patientId: true,
            patient: {
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    phone: true,
                },
            },
            contact: {
                select: {
                    name: true,
                    lastName: true,
                    phone: true,
                },
            },
            specialist: {
                select: {
                    id: true,
                    name: true,
                    displayName: true,
                    userId: true,
                },
            },
        },
    });

    const appointmentRequests = await prisma.appointment.findMany({
        where: {
            source: "portal",
            status: "scheduled",
            confirmationStatus: "pending",
            startTime: { gte: new Date() },
            ...(canSeeAll ? {} : assignedToCurrentUser),
        },
        orderBy: [
            { createdAt: "desc" },
            { startTime: "asc" },
        ],
        take: 8,
        select: {
            id: true,
            title: true,
            startTime: true,
            endTime: true,
            createdAt: true,
            specialistName: true,
            patientId: true,
            patient: {
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    phone: true,
                },
            },
            contact: {
                select: {
                    name: true,
                    lastName: true,
                    phone: true,
                },
            },
            specialist: {
                select: {
                    id: true,
                    name: true,
                    displayName: true,
                    userId: true,
                },
            },
        },
    });

    return NextResponse.json({
        timeZone: operationContext.timeZone,
        locale: operationContext.locale,
        notifications: [
            ...appointmentRequests.map((appointment) => ({
                type: "appointment_request",
                id: appointment.id,
                title: appointment.title,
                patientId: appointment.patientId || appointment.patient?.id || null,
                patientName: patientDisplayName(appointment),
                phone: appointment.patient?.phone || appointment.contact?.phone || null,
                specialistName: appointment.specialist?.displayName || appointment.specialist?.name || appointment.specialistName || null,
                startTime: appointment.startTime.toISOString(),
                endTime: appointment.endTime.toISOString(),
                arrivalAt: null,
                createdAt: appointment.createdAt.toISOString(),
            })),
            ...appointments.map((appointment) => ({
                type: "waiting_room",
                id: appointment.id,
                title: appointment.title,
                patientId: appointment.patientId || appointment.patient?.id || null,
                patientName: patientDisplayName(appointment),
                phone: appointment.patient?.phone || appointment.contact?.phone || null,
                specialistName: appointment.specialist?.displayName || appointment.specialist?.name || appointment.specialistName || null,
                startTime: appointment.startTime.toISOString(),
                endTime: appointment.endTime.toISOString(),
                arrivalAt: appointment.arrivalAt?.toISOString() || null,
                createdAt: null,
            })),
        ],
    });
}
