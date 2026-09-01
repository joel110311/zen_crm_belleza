import Link from "next/link";
import type { ComponentType } from "react";
import type { Prisma } from "@prisma/client";
import {
    ArrowUpRight,
    Building2,
    CalendarCheck2,
    CalendarDays,
    ChevronLeft,
    ChevronRight,
    Clock,
    MapPin,
    Plus,
    Search,
    Scissors,
    Sparkles,
    TrendingUp,
    Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DirectChatUnreadBadge } from "@/components/dashboard/direct-chat-unread-badge";
import { AppointmentQuickActions } from "@/components/dashboard/appointment-quick-actions";
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { getContactFullName } from "@/lib/contact-name";
import { getSystemSettingsOrDefaults } from "@/lib/system-settings";
import { buildOperationContext } from "@/lib/operation-context";
import { businessBoundsForDate, businessDayBounds, formatTimeLabel, normalizeBusinessHours, zonedDateTimeToUtc } from "@/lib/calendar/business-hours";
import { getOperationDateKey } from "@/lib/operation-dates";
import { normalizeRole } from "@/lib/permissions";

export const dynamic = "force-dynamic";

type DashboardSearchParams = {
    tab?: string | string[];
    query?: string | string[];
    month?: string | string[];
};

type AppointmentTab = "upcoming" | "today";
type DashboardOperationContext = ReturnType<typeof buildOperationContext>;
type BusinessProfile = {
    name: string;
    subtitle: string;
    address: string;
    logoUrl: string;
    isOpen: boolean;
    isOpenDay: boolean;
    hoursLabel: string;
};

function pickParam(value?: string | string[]) {
    return Array.isArray(value) ? value[0] || "" : value || "";
}

function getPatientName(patient?: { firstName?: string | null; lastName?: string | null } | null) {
    return [patient?.firstName, patient?.lastName].filter(Boolean).join(" ").trim() || "Cliente";
}

function getInitials(name: string) {
    return name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join("") || "ES";
}

function getTodayRange(timeZone: string) {
    const now = new Date();
    const { start, end } = businessDayBounds(now, timeZone);
    return { now, start, end };
}

function getCurrentMonthRange(timeZone: string) {
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
    }).formatToParts(now);
    const year = Number(parts.find((part) => part.type === "year")?.value || now.getFullYear());
    const month = Number(parts.find((part) => part.type === "month")?.value || now.getMonth() + 1);
    const nextYear = month === 12 ? year + 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    const key = (value: number) => String(value).padStart(2, "0");

    return {
        start: zonedDateTimeToUtc(`${year}-${key(month)}-01`, "00:00", timeZone),
        end: zonedDateTimeToUtc(`${nextYear}-${key(nextMonth)}-01`, "00:00", timeZone),
    };
}

function formatDate(date: Date | null | undefined, operationContext: DashboardOperationContext, options?: Intl.DateTimeFormatOptions) {
    if (!date) return "-";
    return new Intl.DateTimeFormat(operationContext.locale, {
        timeZone: operationContext.timeZone,
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        ...options,
    }).format(date);
}

function formatTime(date: Date, operationContext: DashboardOperationContext) {
    return new Intl.DateTimeFormat(operationContext.locale, {
        timeZone: operationContext.timeZone,
        hour: "2-digit",
        minute: "2-digit",
    }).format(date);
}

function formatCurrency(value: number | null | undefined, operationContext: DashboardOperationContext) {
    return new Intl.NumberFormat(operationContext.locale, {
        style: "currency",
        currency: operationContext.defaultCurrency,
        maximumFractionDigits: 0,
    }).format(value || 0);
}

function buildSearchWhere(query: string): Prisma.AppointmentWhereInput | undefined {
    const value = query.trim();
    if (!value) return undefined;

    const contains = { contains: value, mode: "insensitive" as const };
    return {
        OR: [
            { title: contains },
            { notes: contains },
            { appointmentType: contains },
            { patient: { is: { OR: [{ firstName: contains }, { lastName: contains }, { phone: contains }, { patientNumber: contains }] } } },
            { contact: { is: { OR: [{ name: contains }, { lastName: contains }, { phone: contains }] } } },
            { specialist: { is: { OR: [{ name: contains }, { displayName: contains }, { specialty: contains }, { room: contains }] } } },
        ],
    };
}

async function getLinkedSpecialist(userId?: string, userEmail?: string | null) {
    const select = {
        id: true,
        name: true,
        displayName: true,
        specialty: true,
        email: true,
        phone: true,
        color: true,
        room: true,
        bio: true,
        photoUrl: true,
        defaultDurationMinutes: true,
        googleCalendarSource: {
            select: {
                summary: true,
                calendarId: true,
            },
        },
        _count: {
            select: {
                appointments: true,
                cashMovements: true,
            },
        },
    } satisfies Prisma.SpecialistSelect;

    const preferredWhere: Prisma.SpecialistWhereInput[] = [];
    if (userId) preferredWhere.push({ userId });
    if (userEmail) preferredWhere.push({ email: userEmail });

    if (preferredWhere.length > 0) {
        const linked = await prisma.specialist.findFirst({
            where: { isActive: true, OR: preferredWhere },
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
            select,
        });
        if (linked) return linked;
    }

    return null;
}

async function getDashboardData(params: {
    appointmentTab: AppointmentTab;
    query: string;
    linkedSpecialist: Awaited<ReturnType<typeof getLinkedSpecialist>>;
    specialistId?: string;
    operationContext: DashboardOperationContext;
}) {
    const { now, start, end } = getTodayRange(params.operationContext.timeZone);
    const monthRange = getCurrentMonthRange(params.operationContext.timeZone);
    const searchWhere = buildSearchWhere(params.query);
    const specialistWhere = params.specialistId ? { specialistId: params.specialistId } : {};
    const contactWhere: Prisma.ContactWhereInput = params.specialistId
        ? { appointments: { some: { specialistId: params.specialistId } } }
        : {};
    const appointmentWhere: Prisma.AppointmentWhereInput = {
        status: { not: "cancelled" },
        ...(params.appointmentTab === "today"
            ? { startTime: { gte: start, lt: end } }
            : { endTime: { gt: now } }),
        ...specialistWhere,
        ...(searchWhere || {}),
    };

    const [
        team,
        totalClients,
        appointmentsToday,
        upcomingAppointments,
        canceledAppointments,
        incomeToday,
        totalIncome,
        newClientsThisMonth,
        appointmentsThisMonth,
        directChats,
        appointmentRows,
    ] = await Promise.all([
        prisma.specialist.findMany({
            where: { isActive: true },
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
            select: {
                id: true,
                name: true,
                displayName: true,
                specialty: true,
                color: true,
                photoUrl: true,
                _count: {
                    select: {
                        appointments: {
                            where: {
                                status: { not: "cancelled" },
                                startTime: { gte: start, lt: end },
                            },
                        },
                    },
                },
            },
        }),
        prisma.contact.count({ where: contactWhere }),
        prisma.appointment.count({
            where: {
                status: { not: "cancelled" },
                startTime: { gte: start, lt: end },
                ...specialistWhere,
            },
        }),
        prisma.appointment.count({
            where: {
                status: { not: "cancelled" },
                startTime: { gte: now },
                ...specialistWhere,
            },
        }),
        prisma.appointment.count({
            where: {
                OR: [{ status: "cancelled" }, { cancelledAt: { not: null } }],
                ...specialistWhere,
            },
        }),
        prisma.cashMovement.aggregate({
            where: {
                type: "income",
                status: "confirmed",
                occurredAt: { gte: start, lt: end },
                ...specialistWhere,
            },
            _sum: { amount: true },
        }),
        prisma.cashMovement.aggregate({
            where: {
                type: "income",
                status: "confirmed",
                ...specialistWhere,
            },
            _sum: { amount: true },
        }),
        prisma.contact.count({
            where: {
                createdAt: { gte: monthRange.start, lt: monthRange.end },
                ...contactWhere,
            },
        }),
        prisma.appointment.count({
            where: {
                status: { not: "cancelled" },
                startTime: { gte: monthRange.start, lt: monthRange.end },
                ...specialistWhere,
            },
        }),
        prisma.conversation.findMany({
            where: { status: "active", isGroup: false },
            take: 30,
            orderBy: { updatedAt: "desc" },
            include: {
                contact: {
                    select: {
                        name: true,
                        lastName: true,
                        phone: true,
                        whatsappAvatarUrl: true,
                    },
                },
                messages: {
                    take: 1,
                    orderBy: { createdAt: "desc" },
                    select: {
                        content: true,
                        direction: true,
                        createdAt: true,
                    },
                },
            },
        }),
        prisma.appointment.findMany({
            where: appointmentWhere,
            take: 50,
            orderBy: { startTime: "asc" },
            include: {
                patient: {
                    select: {
                        id: true,
                        patientNumber: true,
                        firstName: true,
                        lastName: true,
                        phone: true,
                        contactId: true,
                        _count: { select: { appointments: true } },
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
                        name: true,
                        displayName: true,
                        color: true,
                        room: true,
                    },
                },
                cashMovements: {
                    where: { status: { not: "cancelled" } },
                    select: {
                        amount: true,
                        type: true,
                        status: true,
                    },
                },
            },
        }),
    ]);

    const appointmentsWithNext = await Promise.all(
        appointmentRows.map(async (appointment) => {
            const nextAppointment = appointment.patientId
                ? await prisma.appointment.findFirst({
                    where: {
                        id: { not: appointment.id },
                        patientId: appointment.patientId,
                        status: { not: "cancelled" },
                        startTime: { gt: appointment.startTime },
                    },
                    orderBy: { startTime: "asc" },
                    select: { startTime: true },
                })
                : null;

            const paidAmount = appointment.cashMovements
                .filter((movement) => movement.type === "income" && movement.status === "confirmed")
                .reduce((sum, movement) => sum + movement.amount, 0);

            return {
                ...appointment,
                nextAppointment,
                paidAmount,
                isUpcoming: appointment.startTime.getTime() >= now.getTime(),
            };
        }),
    );

    return {
        specialist: params.linkedSpecialist,
        team,
        directChats,
        appointments: appointmentsWithNext,
        stats: {
            totalClients,
            appointmentsToday,
            upcomingAppointments,
            canceledAppointments,
            incomeToday: incomeToday._sum.amount || 0,
            totalIncome: totalIncome._sum.amount || 0,
            newClientsThisMonth,
            appointmentsThisMonth,
        },
    };
}

export default async function DashboardPage({
    searchParams,
}: {
    searchParams?: Promise<DashboardSearchParams>;
}) {
    const [resolvedSearchParams, session, settings] = await Promise.all([searchParams, auth(), getSystemSettingsOrDefaults()]);
    const operationContext = buildOperationContext(settings);
    const query = pickParam(resolvedSearchParams?.query).trim();
    const rawTab = pickParam(resolvedSearchParams?.tab);
    const monthParam = pickParam(resolvedSearchParams?.month);
    const appointmentTab: AppointmentTab = rawTab === "today" ? "today" : "upcoming";
    const sessionUser = session?.user as { id?: string; email?: string | null; name?: string | null; role?: string | null } | undefined;
    const userName = sessionUser?.name || "Joel Venegas";
    const linkedSpecialist = await getLinkedSpecialist(sessionUser?.id, sessionUser?.email);
    const personalMode = normalizeRole(sessionUser?.role) === "PROFESIONAL" && Boolean(linkedSpecialist);
    const businessHours = normalizeBusinessHours(settings);
    const todayBusinessBounds = businessBoundsForDate(new Date(), businessHours);
    const isBusinessOpen = todayBusinessBounds.isOpen
        && new Date() >= todayBusinessBounds.start
        && new Date() < todayBusinessBounds.end;
    const data = await getDashboardData({
        appointmentTab,
        query,
        linkedSpecialist,
        specialistId: personalMode ? linkedSpecialist?.id : undefined,
        operationContext,
    });
    const businessProfile = {
        name: operationContext.clinicName,
        subtitle: operationContext.clinicSubtitle,
        address: operationContext.clinicAddress,
        logoUrl: operationContext.clinicLogoUrl,
        isOpen: isBusinessOpen,
        isOpenDay: todayBusinessBounds.isOpen,
        hoursLabel: todayBusinessBounds.isOpen
            ? `${formatTimeLabel(todayBusinessBounds.schedule.start, operationContext.locale)} – ${formatTimeLabel(todayBusinessBounds.schedule.end, operationContext.locale)}`
            : "Cerrado hoy",
    };

    return (
        <>
            <MobileDashboard
                data={data}
                operationContext={operationContext}
                userName={userName}
                appointmentTab={appointmentTab}
                query={query}
                personalMode={personalMode}
                businessProfile={businessProfile}
            />

            <DesktopDashboard
                data={data}
                operationContext={operationContext}
                userName={userName}
                appointmentTab={appointmentTab}
                query={query}
                monthParam={monthParam}
                personalMode={personalMode}
                businessProfile={businessProfile}
            />
        </>
    );
}

function DesktopDashboard({
    data,
    operationContext,
    userName,
    appointmentTab,
    query,
    monthParam,
    personalMode,
    businessProfile,
}: {
    data: Awaited<ReturnType<typeof getDashboardData>>;
    operationContext: DashboardOperationContext;
    userName: string;
    appointmentTab: AppointmentTab;
    query: string;
    monthParam: string;
    personalMode: boolean;
    businessProfile: BusinessProfile;
}) {
    return (
        <div className="hidden space-y-4 pb-8 lg:block">
            <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-12">
                <div className="xl:col-span-3 xl:row-span-2">
                    {personalMode && data.specialist ? (
                        <SpecialistProfileCard specialist={data.specialist} fallbackName={userName} />
                    ) : (
                        <BusinessProfileCard business={businessProfile} team={data.team} appointmentsToday={data.stats.appointmentsToday} />
                    )}
                </div>
                <div className="xl:col-span-6">
                    <DashboardFocusBanner
                        appointments={data.appointments}
                        operationContext={operationContext}
                        stats={data.stats}
                    />
                </div>
                <div className="xl:col-span-3 xl:row-span-2">
                    <MiniMonthCalendar
                        monthParam={monthParam}
                        appointmentTab={appointmentTab}
                        query={query}
                        appointments={data.appointments}
                        operationContext={operationContext}
                    />
                </div>
                <div className="xl:col-span-3">
                    <InsightMetricCard
                        label="Clientes nuevos"
                        value={data.stats.newClientsThisMonth}
                        caption="Este mes"
                        icon={Users}
                        progress={Math.min(100, data.stats.newClientsThisMonth * 12)}
                        locale={operationContext.locale}
                    />
                </div>
                <div className="xl:col-span-3">
                    <InsightMetricCard
                        label="Citas del mes"
                        value={data.stats.appointmentsThisMonth}
                        caption={`${data.stats.appointmentsToday} para hoy`}
                        icon={TrendingUp}
                        progress={Math.min(100, data.stats.appointmentsThisMonth * 6)}
                        locale={operationContext.locale}
                    />
                </div>
            </div>

            <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                <AppointmentsPanel
                    appointments={data.appointments}
                    appointmentTab={appointmentTab}
                    query={query}
                    operationContext={operationContext}
                />
                <aside>
                    <DirectChatsCard chats={data.directChats} />
                </aside>
            </div>
        </div>
    );
}

function DashboardFocusBanner({
    appointments,
    operationContext,
    stats,
}: {
    appointments: Awaited<ReturnType<typeof getDashboardData>>["appointments"];
    operationContext: DashboardOperationContext;
    stats: Awaited<ReturnType<typeof getDashboardData>>["stats"];
}) {
    const next = appointments.find((appointment) => (
        appointment.isUpcoming &&
        !["completed", "cancelled", "no_show"].includes(appointment.status)
    ));
    const nextName = next?.patient
        ? getPatientName(next.patient)
        : getContactFullName(next?.contact, "Cliente");
    const longDate = formatDate(new Date(), operationContext, {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
    });

    return (
        <Card className="relative min-h-[218px] overflow-hidden rounded-3xl border border-primary/15 bg-gradient-to-br from-primary via-primary/90 to-primary/75 text-primary-foreground shadow-sm">
            <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full border-[42px] border-white/10" />
            <div className="pointer-events-none absolute bottom-[-70px] right-32 h-40 w-40 rounded-full border-[26px] border-white/10" />
            <Scissors className="pointer-events-none absolute right-12 top-12 h-24 w-24 rotate-[-12deg] text-white/15" />
            <CardContent className="relative flex min-h-[218px] flex-col justify-between p-6">
                <div className="flex flex-col items-start justify-between gap-3 xl:flex-row xl:gap-4">
                    <div className="min-w-0">
                        <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary-foreground/75">Resumen del negocio</p>
                        <h2 className="mt-2 max-w-xl text-2xl font-black leading-tight">Tu agenda y tus clientes, siempre bajo control.</h2>
                    </div>
                    <p className="relative z-10 shrink-0 rounded-full border border-white/15 bg-black/10 px-3 py-1.5 text-xs font-medium capitalize text-primary-foreground/85 backdrop-blur-sm">
                        {longDate}
                    </p>
                </div>
                <div className="mt-6 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
                    <div className="rounded-2xl border border-white/15 bg-black/10 px-4 py-3 backdrop-blur-sm">
                        <p className="text-xs text-primary-foreground/70">{next ? "Próxima cita" : "Agenda disponible"}</p>
                        <p className="mt-1 truncate font-bold">{next ? nextName : "No hay citas pendientes"}</p>
                        <p className="mt-1 text-xs text-primary-foreground/75">
                            {next
                                ? `${formatDate(next.startTime, operationContext, { day: "numeric", month: "short" })} · ${formatTime(next.startTime, operationContext)}`
                                : "Puedes crear una cita desde el calendario."}
                        </p>
                    </div>
                    <div className="rounded-2xl bg-white/12 px-4 py-3 text-center">
                        <p className="text-2xl font-black">{stats.upcomingAppointments}</p>
                        <p className="text-[11px] text-primary-foreground/75">Próximas</p>
                    </div>
                    <div className="rounded-2xl bg-white/12 px-4 py-3 text-center">
                        <p className="text-lg font-black">{formatCurrency(stats.incomeToday, operationContext)}</p>
                        <p className="text-[11px] text-primary-foreground/75">Ingresos hoy</p>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

function InsightMetricCard({
    label,
    value,
    caption,
    icon: Icon,
    progress,
    locale,
}: {
    label: string;
    value: number;
    caption: string;
    icon: ComponentType<{ className?: string }>;
    progress: number;
    locale: string;
}) {
    return (
        <Card className="h-full rounded-3xl border border-border/70 bg-card shadow-sm">
            <CardContent className="flex min-h-[150px] items-center gap-5 p-5">
                <div
                    className="relative flex h-20 w-20 shrink-0 items-center justify-center rounded-full"
                    style={{ background: `conic-gradient(var(--primary) ${progress}%, color-mix(in oklab, var(--primary) 12%, transparent) 0)` }}
                >
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-card text-primary">
                        <Icon className="h-6 w-6" />
                    </div>
                </div>
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <p className="text-3xl font-black text-foreground">{value.toLocaleString(locale)}</p>
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-[10px] font-bold text-primary">
                            <ArrowUpRight className="h-3 w-3" />
                            Activo
                        </span>
                    </div>
                    <p className="mt-1 font-semibold text-foreground">{label}</p>
                    <p className="text-xs text-muted-foreground">{caption}</p>
                </div>
            </CardContent>
        </Card>
    );
}

function getCalendarMonth(monthParam: string) {
    const match = monthParam.match(/^(\d{4})-(\d{2})$/);
    if (match) {
        const year = Number(match[1]);
        const month = Number(match[2]);
        if (year >= 2000 && year <= 2100 && month >= 1 && month <= 12) {
            return new Date(year, month - 1, 1, 12, 0, 0);
        }
    }
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1, 12, 0, 0);
}

function MiniMonthCalendar({
    monthParam,
    appointmentTab,
    query,
    appointments,
    operationContext,
}: {
    monthParam: string;
    appointmentTab: AppointmentTab;
    query: string;
    appointments: Awaited<ReturnType<typeof getDashboardData>>["appointments"];
    operationContext: DashboardOperationContext;
}) {
    const monthDate = getCalendarMonth(monthParam);
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const previous = new Date(year, month - 1, 1);
    const next = new Date(year, month + 1, 1);
    const toMonthKey = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
    const toDateKey = (day: number) => `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dashboardHref = (value: Date) => {
        const params = new URLSearchParams();
        params.set("month", toMonthKey(value));
        params.set("tab", appointmentTab);
        if (query) params.set("query", query);
        return `/dashboard?${params.toString()}`;
    };
    const todayKey = new Intl.DateTimeFormat("en-CA", {
        timeZone: operationContext.timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date());
    const appointmentDays = new Set(
        appointments
            .map((appointment) => new Intl.DateTimeFormat("en-CA", {
                timeZone: operationContext.timeZone,
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
            }).format(appointment.startTime))
            .filter((key) => key.startsWith(`${year}-${String(month + 1).padStart(2, "0")}`)),
    );
    const cells = Array.from({ length: 42 }, (_, index) => {
        const day = index - firstWeekday + 1;
        return day >= 1 && day <= daysInMonth ? day : null;
    });

    return (
        <Card className="h-full rounded-3xl border border-border/70 bg-card shadow-sm">
            <CardContent className="p-5">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-[0.15em] text-muted-foreground">Calendario</p>
                        <h2 className="mt-1 text-lg font-bold capitalize">
                            {new Intl.DateTimeFormat(operationContext.locale, { month: "long", year: "numeric" }).format(monthDate)}
                        </h2>
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" size="icon" className="h-9 w-9 rounded-xl" asChild>
                            <Link href={dashboardHref(previous)} aria-label="Mes anterior">
                                <ChevronLeft className="h-4 w-4" />
                            </Link>
                        </Button>
                        <Button variant="outline" size="icon" className="h-9 w-9 rounded-xl" asChild>
                            <Link href={dashboardHref(next)} aria-label="Mes siguiente">
                                <ChevronRight className="h-4 w-4" />
                            </Link>
                        </Button>
                    </div>
                </div>
                <div className="mt-5 grid grid-cols-7 gap-1 text-center">
                    {["L", "M", "M", "J", "V", "S", "D"].map((label, index) => (
                        <span key={`${label}-${index}`} className="py-1 text-[10px] font-bold text-muted-foreground">{label}</span>
                    ))}
                    {cells.map((day, index) => {
                        if (!day) return <span key={`blank-${index}`} className="h-9" />;
                        const key = toDateKey(day);
                        const isToday = key === todayKey;
                        const hasAppointment = appointmentDays.has(key);
                        return (
                            <Link
                                key={key}
                                href={`/dashboard/calendar?date=${key}`}
                                className={`relative flex h-9 items-center justify-center rounded-xl text-xs font-semibold transition hover:bg-primary/10 hover:text-primary ${isToday ? "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground" : ""}`}
                            >
                                {day}
                                {hasAppointment && !isToday ? <span className="absolute bottom-1 h-1 w-1 rounded-full bg-primary" /> : null}
                            </Link>
                        );
                    })}
                </div>
                <Button variant="outline" className="mt-4 w-full rounded-xl" asChild>
                    <Link href="/dashboard/calendar">
                        <CalendarDays className="mr-2 h-4 w-4" />
                        Abrir calendario
                    </Link>
                </Button>
            </CardContent>
        </Card>
    );
}

function MobileDashboard({
    data,
    operationContext,
    userName,
    appointmentTab,
    query,
    personalMode,
    businessProfile,
}: {
    data: Awaited<ReturnType<typeof getDashboardData>>;
    operationContext: DashboardOperationContext;
    userName: string;
    appointmentTab: AppointmentTab;
    query: string;
    personalMode: boolean;
    businessProfile: BusinessProfile;
}) {
    const firstName = (userName || data.specialist?.displayName || data.specialist?.name || "Especialista").split(/\s+/)[0] || "Especialista";
    const today = new Date();
    const longDate = formatDate(today, operationContext, {
        weekday: "long",
        day: "numeric",
        month: "long",
    });

    return (
        <div className="space-y-4 pb-6 lg:hidden">
            <section className="rounded-2xl border border-border/70 bg-card p-5 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                        <p className="text-sm font-medium capitalize text-muted-foreground">{longDate}</p>
                        <h1 className="mt-1 truncate text-3xl font-black tracking-tight text-foreground">
                            {personalMode ? `Hola, ${firstName}` : businessProfile.name}
                        </h1>
                        {!personalMode ? (
                            <p className="mt-1 truncate text-xs text-muted-foreground">{businessProfile.subtitle}</p>
                        ) : null}
                    </div>
                    <Button size="icon" className="h-11 w-11 shrink-0 rounded-full" asChild>
                        <Link href="/dashboard/calendar" title="Nueva cita">
                            <CalendarCheck2 className="h-5 w-5" />
                        </Link>
                    </Button>
                </div>

                <div className="mt-6 grid grid-cols-3 gap-2">
                    <MobileStatTile
                        label={personalMode ? "Clientes" : "Equipo"}
                        value={personalMode ? data.stats.totalClients : data.team.length}
                        icon={Users}
                        locale={operationContext.locale}
                    />
                    <MobileStatTile
                        label="Hoy"
                        value={data.stats.appointmentsToday}
                        icon={Sparkles}
                        locale={operationContext.locale}
                    />
                    <MobileStatTile
                        label="Citas"
                        value={data.stats.upcomingAppointments}
                        icon={CalendarCheck2}
                        locale={operationContext.locale}
                    />
                </div>
            </section>

            <AppointmentsPanel
                appointments={data.appointments}
                appointmentTab={appointmentTab}
                query={query}
                operationContext={operationContext}
            />

            <DirectChatsCard chats={data.directChats} />
        </div>
    );
}

function MobileStatTile({
    label,
    value,
    icon: Icon,
    locale,
}: {
    label: string;
    value: number;
    icon: ComponentType<{ className?: string }>;
    locale: string;
}) {
    return (
        <div className="rounded-xl border bg-background p-3">
            <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Icon className="h-4 w-4" />
            </div>
            <p className="text-2xl font-black leading-none text-foreground">{value.toLocaleString(locale)}</p>
            <p className="mt-1 truncate text-[11px] font-medium text-muted-foreground">{label}</p>
        </div>
    );
}

function BusinessProfileCard({
    business,
    team,
    appointmentsToday,
}: {
    business: BusinessProfile;
    team: Awaited<ReturnType<typeof getDashboardData>>["team"];
    appointmentsToday: number;
}) {
    return (
        <Card className="h-full overflow-hidden rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/20 via-primary/10 to-card shadow-sm">
            <CardContent className="flex h-full min-h-[384px] flex-col p-6">
                <div className="flex items-start justify-between gap-3">
                    <span className="rounded-full border border-primary/20 bg-card/75 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-primary">
                        Negocio
                    </span>
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                        <Building2 className="h-4 w-4" />
                    </span>
                </div>

                <div className="mt-5 flex items-center gap-4">
                    <div
                        className="flex h-24 w-24 shrink-0 items-center justify-center rounded-3xl border border-card/60 bg-card bg-contain bg-center bg-no-repeat text-2xl font-black text-primary shadow-sm"
                        style={{ backgroundImage: business.logoUrl ? `url("${business.logoUrl}")` : undefined }}
                        role="img"
                        aria-label={`Logotipo de ${business.name}`}
                    >
                        {business.logoUrl ? <span className="sr-only">{getInitials(business.name)}</span> : getInitials(business.name)}
                    </div>
                    <div className="min-w-0">
                        <h2 className="line-clamp-2 text-xl font-black leading-tight text-foreground">{business.name}</h2>
                        <p className="mt-1 font-semibold text-primary">{business.subtitle}</p>
                        <p className="mt-1 flex items-start gap-1 text-xs text-muted-foreground">
                            <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                            <span className="line-clamp-2">{business.address}</span>
                        </p>
                    </div>
                </div>

                <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-primary/10 bg-card/65 px-3 py-2.5">
                    <div className="flex items-center gap-2">
                        <span className={`h-2.5 w-2.5 rounded-full ${business.isOpen ? "bg-emerald-500" : "bg-muted-foreground/45"}`} />
                        <p className="text-xs font-semibold text-foreground">
                            {business.isOpen ? "Abierto ahora" : business.isOpenDay ? "Cerrado ahora" : "Cerrado hoy"}
                        </p>
                    </div>
                    <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {business.hoursLabel}
                    </p>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                    <div className="rounded-2xl border border-primary/10 bg-card/65 p-3">
                        <p className="text-xl font-black text-foreground">{team.length}</p>
                        <p className="text-[11px] text-muted-foreground">Especialistas activos</p>
                    </div>
                    <div className="rounded-2xl border border-primary/10 bg-card/65 p-3">
                        <p className="text-xl font-black text-foreground">{appointmentsToday}</p>
                        <p className="text-[11px] text-muted-foreground">Citas de hoy</p>
                    </div>
                </div>

                <div className="mt-4 min-h-0">
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Equipo de hoy</p>
                    {team.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                            {team.map((member) => (
                                <span key={member.id} className="inline-flex max-w-full items-center gap-1.5 rounded-full border bg-card/75 px-2.5 py-1 text-[11px] text-foreground">
                                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: member.color || "#4B5F25" }} />
                                    <span className="truncate font-medium">{member.displayName || member.name}</span>
                                    <span className="shrink-0 text-muted-foreground">· {member._count.appointments}</span>
                                </span>
                            ))}
                        </div>
                    ) : (
                        <p className="text-xs text-muted-foreground">Todavía no hay especialistas activos.</p>
                    )}
                </div>

                <Button className="mt-auto w-full rounded-xl font-semibold" asChild>
                    <Link href="/dashboard/business?tab=operation">
                        Configurar datos del negocio
                    </Link>
                </Button>
            </CardContent>
        </Card>
    );
}

function SpecialistProfileCard({
    specialist,
    fallbackName,
}: {
    specialist: Awaited<ReturnType<typeof getLinkedSpecialist>>;
    fallbackName: string;
}) {
    const displayName = specialist?.displayName || specialist?.name || fallbackName;
    const specialty = specialist?.specialty && !/oftalm/i.test(specialist.specialty)
        ? specialist.specialty
        : "Especialista de belleza";
    const photoUrl = specialist?.photoUrl || "";
    const room = specialist?.room?.trim();
    const attentionArea = room && !/^\d+$/.test(room) ? room : "Área de atención";

    return (
        <Card className="h-full overflow-hidden rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/20 via-primary/10 to-card shadow-sm">
            <CardContent className="flex h-full min-h-[384px] flex-col p-6">
                <div className="flex items-start justify-between gap-3">
                    <span className="rounded-full border border-primary/20 bg-card/75 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-primary">
                        Especialista
                    </span>
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                        <Sparkles className="h-4 w-4" />
                    </span>
                </div>
                <div className="mt-5 flex items-center gap-4">
                    <div
                        className="flex h-24 w-24 shrink-0 items-center justify-center rounded-3xl border border-card/60 bg-card bg-cover bg-center text-2xl font-black text-primary shadow-sm"
                        style={{ backgroundImage: photoUrl ? `url("${photoUrl}")` : undefined }}
                        aria-label={`Foto de perfil de ${displayName}`}
                        role="img"
                    >
                        {photoUrl ? <span className="sr-only">{getInitials(displayName)}</span> : getInitials(displayName)}
                    </div>
                    <div className="min-w-0">
                        <h2 className="line-clamp-2 text-xl font-black leading-tight text-foreground">{displayName}</h2>
                        <p className="mt-1 font-semibold text-primary">{specialty}</p>
                        <p className="mt-1 truncate text-xs text-muted-foreground">{attentionArea}</p>
                    </div>
                </div>

                <p className="mt-5 line-clamp-3 text-sm leading-6 text-muted-foreground">
                    {specialist?.bio || "Profesional del equipo preparado para atender servicios, agenda y seguimiento de clientes."}
                </p>

                <div className="mt-5 grid grid-cols-2 gap-2">
                    <div className="rounded-2xl border border-primary/10 bg-card/65 p-3">
                        <p className="text-xl font-black text-foreground">{specialist?._count.appointments || 0}</p>
                        <p className="text-[11px] text-muted-foreground">Citas registradas</p>
                    </div>
                    <div className="rounded-2xl border border-primary/10 bg-card/65 p-3">
                        <p className="text-xl font-black text-foreground">{specialist?.defaultDurationMinutes || 30} min</p>
                        <p className="text-[11px] text-muted-foreground">Duración base</p>
                    </div>
                </div>

                <Button className="mt-auto w-full rounded-xl font-semibold" asChild>
                    <Link href="/dashboard/settings?section=specialists">
                        Ver perfil del especialista
                    </Link>
                </Button>
            </CardContent>
        </Card>
    );
}

function DirectChatsCard({
    chats,
}: {
    chats: Awaited<ReturnType<typeof getDashboardData>>["directChats"];
}) {
    return (
        <Card className="h-[clamp(340px,36vh,560px)] rounded-3xl border border-border/70 bg-card shadow-sm">
            <CardContent className="flex h-full min-h-0 flex-col p-5">
                <div className="mb-4 flex shrink-0 items-center justify-between gap-3">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-[0.15em] text-muted-foreground">WhatsApp</p>
                        <h2 className="mt-1 text-lg font-bold text-foreground">Mensajes recientes</h2>
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" asChild>
                        <Link href="/dashboard/inbox" title="Abrir inbox">
                            <WhatsAppIcon className="h-4 w-4 text-primary" />
                        </Link>
                    </Button>
                </div>
                {chats.length === 0 ? (
                    <p className="flex flex-1 items-center justify-center rounded-xl border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                        No hay chats activos.
                    </p>
                ) : (
                    <div className="portal-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto pr-2 [scrollbar-gutter:stable]">
                        {chats.map((chat) => {
                            const name = getContactFullName(chat.contact, "Contacto");
                            const lastMessage = chat.messages[0]?.content || "Sin mensajes recientes";
                            return (
                                <Link
                                    key={chat.id}
                                    href={`/dashboard/inbox?conversationId=${chat.id}`}
                                    className="flex items-center gap-3 rounded-2xl border bg-background px-3 py-3 transition hover:border-primary/45 hover:bg-primary/5"
                                >
                                    <div
                                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted bg-cover bg-center text-sm font-bold text-primary"
                                        style={{
                                            backgroundImage: chat.contact.whatsappAvatarUrl ? `url("${chat.contact.whatsappAvatarUrl}")` : undefined,
                                        }}
                                    >
                                        {chat.contact.whatsappAvatarUrl ? null : getInitials(name)}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-semibold text-foreground">{name}</p>
                                        <p className="truncate text-xs text-muted-foreground">{lastMessage}</p>
                                    </div>
                                    <DirectChatUnreadBadge conversationId={chat.id} />
                                </Link>
                            );
                        })}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

function getStatusLabel(status: string) {
    const labels: Record<string, string> = {
        scheduled: "Programada",
        completed: "Completada",
        cancelled: "Cancelada",
        no_show: "No asistio",
    };
    return labels[status] || status;
}

function getPaymentText(
    appointment: Awaited<ReturnType<typeof getDashboardData>>["appointments"][number],
    operationContext: DashboardOperationContext,
) {
    const amount = appointment.paymentAmount || appointment.paidAmount;
    if (appointment.paymentStatus === "paid" || appointment.paidAmount > 0) {
        return `Pagado ${formatCurrency(amount, operationContext)}`;
    }
    if (amount > 0) {
        return `Pendiente ${formatCurrency(amount, operationContext)}`;
    }
    return "Sin cargo";
}

function AppointmentsPanel({
    appointments,
    appointmentTab,
    query,
    operationContext,
}: {
    appointments: Awaited<ReturnType<typeof getDashboardData>>["appointments"];
    appointmentTab: AppointmentTab;
    query: string;
    operationContext: DashboardOperationContext;
}) {
    const makeHref = (tab: AppointmentTab) => {
        const params = new URLSearchParams();
        params.set("tab", tab);
        if (query) params.set("query", query);
        return `/dashboard?${params.toString()}`;
    };

    return (
        <Card className="h-[620px] rounded-3xl border border-border/70 bg-card shadow-sm sm:h-[clamp(500px,60vh,680px)] xl:h-[clamp(340px,36vh,560px)]">
            <CardContent className="flex h-full min-h-0 flex-col p-0">
                <div className="flex shrink-0 flex-col gap-3 border-b border-border/70 p-4 sm:gap-4 sm:p-5 xl:flex-row xl:items-center xl:justify-between">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-[0.15em] text-muted-foreground">Seguimiento</p>
                        <h2 className="mt-1 text-2xl font-black tracking-tight text-foreground">Actividad de clientes</h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                            Citas, servicios, pagos y contacto directo desde una sola lista.
                        </p>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center xl:flex-nowrap">
                        <Button size="sm" className="rounded-full" asChild>
                            <Link href="/dashboard/calendar">
                                <Plus className="mr-1.5 h-4 w-4" />
                                Nueva cita
                            </Link>
                        </Button>
                        <div className="flex rounded-full border bg-muted/30 p-1">
                            <Button
                                variant={appointmentTab === "upcoming" ? "default" : "ghost"}
                                size="sm"
                                className="rounded-full"
                                asChild
                            >
                                <Link href={makeHref("upcoming")}>Hoy y próximas</Link>
                            </Button>
                            <Button
                                variant={appointmentTab === "today" ? "default" : "ghost"}
                                size="sm"
                                className="rounded-full"
                                asChild
                            >
                                <Link href={makeHref("today")}>Hoy</Link>
                            </Button>
                        </div>
                        <form action="/dashboard" className="flex min-w-0 gap-2">
                            <input type="hidden" name="tab" value={appointmentTab} />
                            <div className="relative min-w-0 flex-1 sm:min-w-[190px]">
                                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                <input
                                    name="query"
                                    defaultValue={query}
                                    placeholder="Buscar"
                                    className="h-10 w-full rounded-full border bg-background pl-9 pr-3 text-sm outline-none transition focus:border-primary"
                                />
                            </div>
                            <Button type="submit" variant="outline" className="rounded-full">
                                Buscar
                            </Button>
                        </form>
                    </div>
                </div>

                <div className="portal-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto p-3 pr-2 sm:p-5 sm:pr-3 [scrollbar-gutter:stable]">
                    {appointments.length === 0 ? (
                        <div className="flex min-h-full flex-col items-center justify-center rounded-2xl border border-dashed px-4 py-14 text-center">
                            <Users className="mx-auto h-8 w-8 text-muted-foreground/60" />
                            <p className="mt-3 font-semibold text-foreground">No hay citas para este filtro</p>
                            <p className="mt-1 text-sm text-muted-foreground">Prueba otra búsqueda o crea una cita nueva.</p>
                        </div>
                    ) : appointments.map((appointment) => {
                        const displayName = appointment.patient
                            ? getPatientName(appointment.patient)
                            : getContactFullName(appointment.contact, "Sin cliente asignado");
                        const phone = appointment.patient?.phone || appointment.contact?.phone || "";
                        const isGenericClient = !phone && /^(cliente|sin cliente asignado)$/i.test(displayName.trim());
                        const hasAssignedClient = Boolean(appointment.patientId || appointment.contactId) && !isGenericClient;
                        const specialistName = appointment.specialist?.displayName || appointment.specialist?.name || appointment.specialistName || "Sin asignar";
                        const appointmentCount = appointment.patient?._count.appointments || 1;
                        const linkedContactId = appointment.contactId || appointment.patient?.contactId;
                        const contactHref = linkedContactId ? `/dashboard/contacts/${linkedContactId}` : null;
                        const appointmentDate = getOperationDateKey(appointment.startTime, operationContext.timeZone);

                        return (
                            <article
                                key={appointment.id}
                                className="grid gap-3 rounded-2xl border border-border/70 bg-background p-3 transition hover:border-primary/30 hover:shadow-sm sm:p-4 xl:grid-cols-[minmax(220px,1.35fr)_minmax(180px,1fr)_minmax(150px,.8fr)_auto] xl:items-center"
                            >
                                <div className="flex min-w-0 items-center gap-3">
                                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-sm font-black text-primary">
                                        {getInitials(displayName)}
                                    </span>
                                    <div className="min-w-0">
                                        {hasAssignedClient ? (
                                            contactHref ? (
                                                <Link href={contactHref} className="block truncate font-bold text-foreground hover:text-primary">{displayName}</Link>
                                            ) : (
                                                <span className="block truncate font-bold text-foreground">{displayName}</span>
                                            )
                                        ) : (
                                            <span className="block truncate font-bold text-foreground">Sin cliente asignado</span>
                                        )}
                                        <p className="mt-1 truncate text-xs text-muted-foreground">{phone || "Sin teléfono"} · {appointmentCount} cita{appointmentCount === 1 ? "" : "s"}</p>
                                    </div>
                                </div>

                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                                        <Clock className="h-4 w-4 text-primary" />
                                        {formatTime(appointment.startTime, operationContext)}
                                        <span className="font-normal text-muted-foreground">
                                            {formatDate(appointment.startTime, operationContext, { day: "numeric", month: "short" })}
                                        </span>
                                    </div>
                                    <p className="mt-1 truncate text-xs text-muted-foreground">{appointment.appointmentType || appointment.title}</p>
                                </div>

                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span
                                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                                            style={{ backgroundColor: appointment.specialist?.color || "var(--primary)" }}
                                        />
                                        <p className="truncate text-sm font-semibold">{specialistName}</p>
                                    </div>
                                    <div className="mt-1 flex flex-wrap gap-1.5">
                                        <Badge variant="outline" className="rounded-full text-[10px]">{getStatusLabel(appointment.status)}</Badge>
                                        <Badge variant={appointment.paymentStatus === "paid" || appointment.paidAmount > 0 ? "secondary" : "outline"} className="rounded-full text-[10px]">
                                            {getPaymentText(appointment, operationContext)}
                                        </Badge>
                                    </div>
                                </div>

                                <div className="flex items-center xl:justify-end">
                                    <AppointmentQuickActions
                                        appointmentId={appointment.id}
                                        appointmentDate={appointmentDate}
                                        clientName={displayName}
                                        contactId={appointment.contactId}
                                        patientId={appointment.patientId}
                                        specialistId={appointment.specialistId}
                                        serviceId={appointment.serviceId}
                                        needsClientAssignment={!hasAssignedClient}
                                        needsSpecialistAssignment={!appointment.specialistId}
                                        status={appointment.status}
                                        confirmationStatus={appointment.confirmationStatus}
                                        paymentStatus={appointment.paymentStatus}
                                    />
                                </div>
                            </article>
                        );
                    })}
                </div>

                <div className="shrink-0 border-t px-5 py-4 text-sm text-muted-foreground">
                    Mostrando {appointments.length} registro{appointments.length === 1 ? "" : "s"}
                    {query ? ` para "${query}"` : ""}
                </div>
            </CardContent>
        </Card>
    );
}
