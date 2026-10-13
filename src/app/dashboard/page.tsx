import Link from "next/link";
import type { Prisma } from "@prisma/client";
import {
  Bot,
  CalendarCheck2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Plus,
  Search,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DirectChatUnreadBadge } from "@/components/dashboard/direct-chat-unread-badge";
import { AppointmentQuickActions } from "@/components/dashboard/appointment-quick-actions";
import { ChatbotUsageCounter } from "@/components/brain/chatbot-usage-counter";
import { getActiveTenantRuntimeContext } from "@/lib/active-tenant-context";
import { resolveTenantBranding } from "@/lib/branding";
import { tenantDashboardPath } from "@/lib/tenant-request-routing";
import styles from "@/components/dashboard/overview.module.css";
import { AgentAutopilotControl } from "@/components/dashboard/agent-autopilot-control";
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { getContactFullName } from "@/lib/contact-name";
import { getSystemSettingsOrDefaults } from "@/lib/system-settings";
import { buildOperationContext } from "@/lib/operation-context";
import {
  businessBoundsForDate,
  businessDayBounds,
  formatTimeLabel,
  normalizeBusinessHours,
  zonedDateTimeToUtc,
} from "@/lib/calendar/business-hours";
import { hasPermission, normalizeRole } from "@/lib/permissions";

export const dynamic = "force-dynamic";

type DashboardSearchParams = {
  tab?: string | string[];
  query?: string | string[];
  month?: string | string[];
};

type AppointmentTab = "upcoming" | "today";
type DashboardOperationContext = ReturnType<typeof buildOperationContext>;
function pickParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function getPatientName(
  patient?: { firstName?: string | null; lastName?: string | null } | null,
) {
  return (
    [patient?.firstName, patient?.lastName].filter(Boolean).join(" ").trim() ||
    "Cliente"
  );
}

function getInitials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "ES"
  );
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
  const year = Number(
    parts.find((part) => part.type === "year")?.value || now.getFullYear(),
  );
  const month = Number(
    parts.find((part) => part.type === "month")?.value || now.getMonth() + 1,
  );
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const key = (value: number) => String(value).padStart(2, "0");

  return {
    start: zonedDateTimeToUtc(`${year}-${key(month)}-01`, "00:00", timeZone),
    end: zonedDateTimeToUtc(
      `${nextYear}-${key(nextMonth)}-01`,
      "00:00",
      timeZone,
    ),
  };
}

function formatDate(
  date: Date | null | undefined,
  operationContext: DashboardOperationContext,
  options?: Intl.DateTimeFormatOptions,
) {
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

function buildSearchWhere(
  query: string,
): Prisma.AppointmentWhereInput | undefined {
  const value = query.trim();
  if (!value) return undefined;

  const contains = { contains: value, mode: "insensitive" as const };
  return {
    OR: [
      { title: contains },
      { notes: contains },
      { appointmentType: contains },
      {
        patient: {
          is: {
            OR: [
              { firstName: contains },
              { lastName: contains },
              { phone: contains },
              { patientNumber: contains },
            ],
          },
        },
      },
      {
        contact: {
          is: {
            OR: [
              { name: contains },
              { lastName: contains },
              { phone: contains },
            ],
          },
        },
      },
      {
        specialist: {
          is: {
            OR: [
              { name: contains },
              { displayName: contains },
              { specialty: contains },
              { room: contains },
            ],
          },
        },
      },
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
  const specialistWhere = params.specialistId
    ? { specialistId: params.specialistId }
    : {};
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
    newClientsThisMonth,
    appointmentsThisMonth,
    directChats,
    appointmentRows,
    pendingToday,
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
      },
    }),
    prisma.appointment.count({
      where: {
        status: "scheduled",
        confirmationStatus: "pending",
        startTime: { gte: start, lt: end },
        ...specialistWhere,
      },
    }),
  ]);

  const appointmentsWithNext = appointmentRows.map((appointment) => ({
    ...appointment,
    isUpcoming: appointment.startTime.getTime() >= now.getTime(),
  }));

  return {
    specialist: params.linkedSpecialist,
    team,
    directChats,
    appointments: appointmentsWithNext,
    stats: {
      totalClients,
      pendingToday,
      appointmentsToday,
      upcomingAppointments,
      canceledAppointments,
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
  const [resolvedSearchParams, session, settings, tenant] = await Promise.all([
    searchParams,
    auth(),
    getSystemSettingsOrDefaults(),
    getActiveTenantRuntimeContext("read"),
  ]);
  const operationContext = buildOperationContext(settings);
  const query = pickParam(resolvedSearchParams?.query).trim();
  const rawTab = pickParam(resolvedSearchParams?.tab);
  const monthParam = pickParam(resolvedSearchParams?.month);
  const appointmentTab: AppointmentTab =
    rawTab === "today" ? "today" : "upcoming";
  const sessionUser = session?.user as
    | {
        id?: string;
        email?: string | null;
        name?: string | null;
        role?: string | null;
        permissions?: unknown;
      }
    | undefined;
  const userName = sessionUser?.name || "Usuario";
  const linkedSpecialist = await getLinkedSpecialist(
    sessionUser?.id,
    sessionUser?.email,
  );
  const personalMode =
    normalizeRole(sessionUser?.role) === "PROFESIONAL" &&
    Boolean(linkedSpecialist);
  const canManageAi = hasPermission(sessionUser, "ai.manage");
  const canViewChats = hasPermission(sessionUser, "chats.manage");
  const canViewCalendar = hasPermission(sessionUser, "calendar.manage");
  const canWrite = !tenant || tenant.accessMode === "FULL";
  const basePath = tenant
    ? tenantDashboardPath(tenant.slug, "/dashboard")
    : "/dashboard";
  const calendarPath = tenant
    ? tenantDashboardPath(tenant.slug, "/dashboard/calendar")
    : "/dashboard/calendar";
  const businessPath = tenant
    ? tenantDashboardPath(tenant.slug, "/dashboard/business")
    : "/dashboard/business";
  const brainPath = tenant
    ? tenantDashboardPath(tenant.slug, "/dashboard/brain")
    : "/dashboard/brain";
  const hours = normalizeBusinessHours(settings);
  const bounds = businessBoundsForDate(new Date(), hours);
  const isOpen =
    bounds.isOpen && new Date() >= bounds.start && new Date() < bounds.end;
  const data = await getDashboardData({
    appointmentTab,
    query,
    linkedSpecialist,
    specialistId: personalMode ? linkedSpecialist?.id : undefined,
    operationContext,
  });
  const nextAppointments = data.appointments.filter(
    (appointment) =>
      appointment.isUpcoming &&
      !["completed", "cancelled", "no_show"].includes(appointment.status),
  );
  const next = nextAppointments[0];
  const clientName = (appointment: (typeof data.appointments)[number]) =>
    appointment.patient
      ? getPatientName(appointment.patient)
      : getContactFullName(appointment.contact, "Sin cliente asignado");
  const appointmentHref = (id: string) =>
    `${calendarPath}?appointmentId=${encodeURIComponent(id)}`;
  const dateLabel = formatDate(new Date(), operationContext, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: undefined,
  });
  const firstName = userName.trim().split(/\s+/)[0];
  const businessName = tenant
    ? resolveTenantBranding(settings, tenant.displayName).brandName
    : operationContext.clinicName;
  return (
    <div className={styles.overview} data-dashboard-overview>
      <header className={styles.heading}>
        <div className="min-w-0">
          <p className="mb-2 text-xs capitalize text-muted-foreground">
            {dateLabel}
          </p>
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight sm:text-[32px]">
            Tu día, en orden.
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Buenos días, {firstName}.{" "}
            {personalMode ? "Esta es tu agenda." : businessName}
          </p>
        </div>
        {canWrite && canViewCalendar && (
          <Button asChild className="hidden min-h-11 rounded-xl md:inline-flex">
            <Link href={`${calendarPath}?new=1`}>
              <Plus aria-hidden="true" />
              Nueva cita
            </Link>
          </Button>
        )}
      </header>
      <dl className={styles.stats}>
        {[
          {
            label: "Citas hoy",
            value: data.stats.appointmentsToday,
            note: personalMode ? "En tu agenda" : "En el negocio",
          },
          {
            label: "Por confirmar",
            value: data.stats.pendingToday,
            note: "Para hoy",
          },
          {
            label: "Próximas citas",
            value: data.stats.upcomingAppointments,
            note: "Desde ahora",
          },
        ].map((stat) => (
          <div key={stat.label}>
            <dt>{stat.label}</dt>
            <dd>{stat.value.toLocaleString(operationContext.locale)}</dd>
            <p>{stat.note}</p>
          </div>
        ))}
      </dl>
      <div className={styles.columns}>
        <div className="min-w-0">
          <section aria-labelledby="next-appointment-title">
            <div className={styles.sectionHeading}>
              <h2 id="next-appointment-title">
                {query ? "Próxima cita encontrada" : "Próxima cita"}
              </h2>
              {canViewCalendar && (
                <Link href={calendarPath}>
                  Ver agenda <ChevronRight aria-hidden="true" />
                </Link>
              )}
            </div>
            {next ? (
              <article className={styles.nextAppointment}>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <p className="text-muted-foreground">
                    {formatDate(next.startTime, operationContext, {
                      day: "numeric",
                      month: "short",
                      year: undefined,
                    })}{" "}
                    · {formatTime(next.startTime, operationContext)}
                  </p>
                  <span className="rounded-md bg-card px-2 py-1 font-medium text-primary">
                    {next.confirmationStatus === "confirmed"
                      ? "Confirmada"
                      : next.confirmationStatus === "declined"
                        ? "Confirmación rechazada"
                        : "Por confirmar"}
                  </span>
                </div>
                <div className="my-5 flex min-w-0 items-center gap-3">
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-card text-sm font-semibold text-primary">
                    {getInitials(clientName(next))}
                  </span>
                  <div className="min-w-0">
                    <h3 className="break-words text-lg font-semibold">
                      {clientName(next)}
                    </h3>
                    <p className="mt-1 break-words text-sm text-muted-foreground">
                      {next.appointmentType || next.title}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Users className="size-4 shrink-0" aria-hidden="true" />
                    {next.specialist?.displayName ||
                      next.specialist?.name ||
                      next.specialistName ||
                      "Sin asignar"}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Clock className="size-4" aria-hidden="true" />
                    {Math.max(
                      0,
                      Math.round(
                        (next.endTime.getTime() - next.startTime.getTime()) /
                          60000,
                      ),
                    )}{" "}
                    min
                  </span>
                </div>
                {canViewCalendar && (
                  <div className="mt-5 flex justify-end border-t border-primary/15 pt-4">
                    <Button
                      variant="outline"
                      asChild
                      className="min-h-11 rounded-xl"
                    >
                      <Link href={appointmentHref(next.id)}>
                        Ver cita <ChevronRight aria-hidden="true" />
                      </Link>
                    </Button>
                  </div>
                )}
              </article>
            ) : (
              <div className={styles.empty}>
                <CalendarCheck2
                  className="mx-auto mb-3 size-7 text-primary"
                  aria-hidden="true"
                />
                <p className="font-medium">
                  {query
                    ? "Sin próximas citas para esta búsqueda"
                    : "No hay citas pendientes"}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {canWrite
                    ? "Puedes organizar tu siguiente cita desde la agenda."
                    : "Puedes consultar tus citas desde la agenda."}
                </p>
              </div>
            )}
          </section>
          {nextAppointments.length > 1 && (
            <section className="mt-7" aria-labelledby="following-title">
              <div className={styles.sectionHeading}>
                <h2 id="following-title">Después</h2>
                {canViewCalendar && (
                  <Link href={calendarPath}>
                    Todas las citas <ChevronRight aria-hidden="true" />
                  </Link>
                )}
              </div>
              <div>
                {nextAppointments.slice(1, 5).map((appointment) => (
                  <Link
                    key={appointment.id}
                    href={appointmentHref(appointment.id)}
                    className={styles.appointmentRow}
                  >
                    <time className="text-sm tabular-nums text-muted-foreground">
                      {formatTime(appointment.startTime, operationContext)}
                    </time>
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm font-semibold">
                        {clientName(appointment)}
                      </p>
                      <p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">
                        {formatDate(appointment.startTime, operationContext, {
                          day: "numeric",
                          month: "short",
                          year: undefined,
                        })}{" "}
                        · {appointment.appointmentType || appointment.title} ·{" "}
                        {appointment.specialist?.displayName ||
                          appointment.specialist?.name ||
                          appointment.specialistName ||
                          "Sin asignar"}
                      </p>
                    </div>
                    <ChevronRight
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
        <aside className={styles.context} aria-label="Resumen del negocio">
          <section>
            <div className={styles.sectionHeading}>
              <h2>{personalMode ? "Tu actividad" : "Tu equipo hoy"}</h2>
            </div>
            {personalMode ? (
              <div className="space-y-3 text-sm">
                <p className="font-medium">
                  {data.specialist?.displayName ||
                    data.specialist?.name ||
                    userName}
                </p>
                <p className="text-muted-foreground">
                  {data.stats.totalClients.toLocaleString(
                    operationContext.locale,
                  )}{" "}
                  clientes ·{" "}
                  {data.stats.appointmentsThisMonth.toLocaleString(
                    operationContext.locale,
                  )}{" "}
                  citas este mes
                </p>
              </div>
            ) : data.team.length ? (
              <div>
                {data.team.map((member) => (
                  <div
                    key={member.id}
                    className="flex min-w-0 items-center gap-3 border-b border-border py-3 last:border-0"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                      {getInitials(member.displayName || member.name)}
                    </span>
                    <p className="min-w-0 flex-1 break-words text-sm font-medium">
                      {member.displayName || member.name}
                    </p>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {member._count.appointments}{" "}
                      {member._count.appointments === 1 ? "cita" : "citas"}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm leading-relaxed text-muted-foreground">
                Todavía no hay especialistas activos.
              </p>
            )}
          </section>
          {!personalMode && (
            <section>
              <div className={styles.sectionHeading}>
                <h2>Este mes</h2>
              </div>
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Clientes nuevos</dt>
                  <dd className="font-medium tabular-nums">
                    {data.stats.newClientsThisMonth.toLocaleString(
                      operationContext.locale,
                    )}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Citas registradas</dt>
                  <dd className="font-medium tabular-nums">
                    {data.stats.appointmentsThisMonth.toLocaleString(
                      operationContext.locale,
                    )}
                  </dd>
                </div>
              </dl>
            </section>
          )}
          {canManageAi && (
            <section>
              <div className={styles.sectionHeading}>
                <h2 className="flex items-center gap-2">
                  <Bot className="size-4 text-primary" aria-hidden="true" />
                  Asistente IA
                </h2>
                {canWrite && (
                  <AgentAutopilotControl
                    initialEnabled={settings.isBotEnabled}
                  />
                )}
              </div>
              <p className="mb-2 text-sm text-muted-foreground">
                Autopiloto {settings.isBotEnabled ? "activo" : "pausado"}
              </p>
              <ChatbotUsageCounter />
              <Link
                href={brainPath}
                className="mt-3 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary"
              >
                Ver asistente{" "}
                <ChevronRight className="size-4" aria-hidden="true" />
              </Link>
            </section>
          )}
          <section>
            <div className={styles.sectionHeading}>
              <h2>Tu negocio</h2>
            </div>
            <p className="break-words text-sm font-medium">{businessName}</p>
            <p className="mt-2 break-words text-sm leading-relaxed text-muted-foreground">
              {operationContext.clinicSubtitle}
            </p>
            <p className="mt-3 text-xs text-muted-foreground">
              {isOpen ? "Abierto ahora" : "Cerrado ahora"} ·{" "}
              {bounds.isOpen
                ? `${formatTimeLabel(bounds.schedule.start, operationContext.locale)} – ${formatTimeLabel(bounds.schedule.end, operationContext.locale)}`
                : "Cerrado hoy"}
            </p>
            {hasPermission(sessionUser, "settings.manage") && (
              <Link
                href={`${businessPath}?tab=operation`}
                className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-primary"
              >
                Ver datos del negocio
              </Link>
            )}
          </section>
        </aside>
      </div>
      <details
        className={styles.details}
        open={Boolean(query || monthParam || rawTab)}
      >
        <summary>Consultar y gestionar todas las citas</summary>
        <div className="mt-5">
          <AppointmentsPanel
            appointments={data.appointments}
            appointmentTab={appointmentTab}
            query={query}
            operationContext={operationContext}
            basePath={basePath}
            canWrite={canWrite && canViewCalendar}
          />
        </div>
      </details>
      <div className={styles.secondary}>
        {canViewChats && (
          <DirectChatsCard
            chats={data.directChats}
            inboxPath={
              tenant
                ? tenantDashboardPath(tenant.slug, "/dashboard/inbox")
                : "/dashboard/inbox"
            }
          />
        )}
        {canViewCalendar && (
          <details className={styles.details} open={Boolean(monthParam)}>
            <summary>Calendario mensual</summary>
            <div className="mt-4">
              <MiniMonthCalendar
                basePath={basePath}
                calendarPath={calendarPath}
                monthParam={monthParam}
                appointmentTab={appointmentTab}
                query={query}
                appointments={data.appointments}
                operationContext={operationContext}
              />
            </div>
          </details>
        )}
      </div>
    </div>
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
  basePath,
  calendarPath,
  monthParam,
  appointmentTab,
  query,
  appointments,
  operationContext,
}: {
  basePath: string;
  calendarPath: string;
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
  const toMonthKey = (value: Date) =>
    `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
  const toDateKey = (day: number) =>
    `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const dashboardHref = (value: Date) => {
    const params = new URLSearchParams();
    params.set("month", toMonthKey(value));
    params.set("tab", appointmentTab);
    if (query) params.set("query", query);
    return `${basePath}?${params.toString()}`;
  };
  const todayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: operationContext.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const appointmentDays = new Set(
    appointments
      .map((appointment) =>
        new Intl.DateTimeFormat("en-CA", {
          timeZone: operationContext.timeZone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(appointment.startTime),
      )
      .filter((key) =>
        key.startsWith(`${year}-${String(month + 1).padStart(2, "0")}`),
      ),
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
            <p className="text-xs font-bold uppercase tracking-[0.15em] text-muted-foreground">
              Calendario
            </p>
            <h2 className="mt-1 text-lg font-bold capitalize">
              {new Intl.DateTimeFormat(operationContext.locale, {
                month: "long",
                year: "numeric",
              }).format(monthDate)}
            </h2>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9 rounded-xl"
              asChild
            >
              <Link href={dashboardHref(previous)} aria-label="Mes anterior">
                <ChevronLeft className="h-4 w-4" />
              </Link>
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9 rounded-xl"
              asChild
            >
              <Link href={dashboardHref(next)} aria-label="Mes siguiente">
                <ChevronRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-7 gap-1 text-center">
          {["L", "M", "M", "J", "V", "S", "D"].map((label, index) => (
            <span
              key={`${label}-${index}`}
              className="py-1 text-[10px] font-bold text-muted-foreground"
            >
              {label}
            </span>
          ))}
          {cells.map((day, index) => {
            if (!day) return <span key={`blank-${index}`} className="h-9" />;
            const key = toDateKey(day);
            const isToday = key === todayKey;
            const hasAppointment = appointmentDays.has(key);
            return (
              <Link
                key={key}
                href={`${calendarPath}?date=${key}`}
                className={`relative flex h-9 items-center justify-center rounded-xl text-xs font-semibold transition hover:bg-primary/10 hover:text-primary ${isToday ? "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground" : ""}`}
              >
                {day}
                {hasAppointment && !isToday ? (
                  <span className="absolute bottom-1 h-1 w-1 rounded-full bg-primary" />
                ) : null}
              </Link>
            );
          })}
        </div>
        <Button variant="outline" className="mt-4 w-full rounded-xl" asChild>
          <Link href={calendarPath}>
            <CalendarDays className="mr-2 h-4 w-4" />
            Abrir calendario
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function DirectChatsCard({
  chats,
  inboxPath,
}: {
  chats: Awaited<ReturnType<typeof getDashboardData>>["directChats"];
  inboxPath: string;
}) {
  return (
    <Card className="h-full rounded-3xl border border-border/70 bg-card shadow-sm">
      <CardContent className="flex h-full min-h-0 flex-col p-5">
        <div className="mb-4 flex shrink-0 items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.15em] text-muted-foreground">
              WhatsApp
            </p>
            <h2 className="mt-1 text-lg font-bold text-foreground">
              Mensajes recientes
            </h2>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full"
            asChild
          >
            <Link href={inboxPath} title="Abrir chats">
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
            {chats.slice(0, 6).map((chat) => {
              const name = getContactFullName(chat.contact, "Contacto");
              const lastMessage =
                chat.messages[0]?.content || "Sin mensajes recientes";
              return (
                <Link
                  key={chat.id}
                  href={`${inboxPath}?conversationId=${encodeURIComponent(chat.id)}`}
                  className="flex items-center gap-3 rounded-2xl border bg-background px-3 py-3 transition hover:border-primary/45 hover:bg-primary/5"
                >
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted bg-cover bg-center text-sm font-bold text-primary"
                    style={{
                      backgroundImage: chat.contact.whatsappAvatarUrl
                        ? `url("${chat.contact.whatsappAvatarUrl}")`
                        : undefined,
                    }}
                  >
                    {chat.contact.whatsappAvatarUrl ? null : getInitials(name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {name}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {lastMessage}
                    </p>
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

function AppointmentsPanel({
  appointments,
  appointmentTab,
  query,
  operationContext,
  basePath,
  canWrite,
}: {
  appointments: Awaited<ReturnType<typeof getDashboardData>>["appointments"];
  appointmentTab: AppointmentTab;
  query: string;
  basePath: string;
  canWrite: boolean;
  operationContext: DashboardOperationContext;
}) {
  const makeHref = (tab: AppointmentTab) => {
    const params = new URLSearchParams();
    params.set("tab", tab);
    if (query) params.set("query", query);
    return `${basePath}?${params.toString()}`;
  };

  return (
    <div className="appointments-panel-container h-full min-w-0">
      <Card className="appointments-panel-card rounded-3xl border border-border/70 bg-card shadow-sm">
        <CardContent className="flex h-full min-h-0 flex-col p-0">
          <div className="appointments-panel-header flex shrink-0 flex-col gap-3 border-b border-border/70 p-4 sm:gap-4 sm:p-5">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-muted-foreground">
                Seguimiento
              </p>
              <h2 className="mt-1 text-2xl font-black tracking-tight text-foreground">
                Actividad de clientes
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Citas, servicios y contacto directo desde una sola lista.
              </p>
            </div>
            <div className="appointments-panel-toolbar flex min-w-0 flex-col gap-2">
              {canWrite && (
                <Button size="sm" className="shrink-0 rounded-full" asChild>
                  <Link
                    href={`${basePath === "/dashboard" ? "/dashboard/calendar" : basePath.replace(/\/dashboard$/, "/calendar")}?new=1`}
                  >
                    <Plus className="mr-1.5 h-4 w-4" />
                    Nueva cita
                  </Link>
                </Button>
              )}
              <div className="flex shrink-0 rounded-full border bg-muted/30 p-1">
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
              <form
                action={basePath}
                className="appointments-panel-search flex min-w-0 gap-2"
              >
                <input type="hidden" name="tab" value={appointmentTab} />
                <div className="relative min-w-0 flex-1 sm:min-w-[190px]">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    name="query"
                    type="search"
                    aria-label="Buscar citas"
                    defaultValue={query}
                    placeholder="Buscar"
                    className="h-10 w-full rounded-full border bg-background pl-9 pr-3 text-sm outline-none transition focus:border-primary"
                  />
                </div>
                <Button
                  type="submit"
                  variant="outline"
                  className="rounded-full"
                >
                  Buscar
                </Button>
              </form>
            </div>
          </div>

          <div className="portal-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto p-3 pr-2 sm:p-5 sm:pr-3 [scrollbar-gutter:stable]">
            {appointments.length === 0 ? (
              <div className="flex min-h-full flex-col items-center justify-center rounded-2xl border border-dashed px-4 py-14 text-center">
                <Users className="mx-auto h-8 w-8 text-muted-foreground/60" />
                <p className="mt-3 font-semibold text-foreground">
                  No hay citas para este filtro
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Prueba otra búsqueda o crea una cita nueva.
                </p>
              </div>
            ) : (
              appointments.map((appointment) => {
                const displayName = appointment.patient
                  ? getPatientName(appointment.patient)
                  : getContactFullName(
                      appointment.contact,
                      "Sin cliente asignado",
                    );
                const phone =
                  appointment.patient?.phone ||
                  appointment.contact?.phone ||
                  "";
                const isGenericClient =
                  !phone &&
                  /^(cliente|sin cliente asignado)$/i.test(displayName.trim());
                const hasAssignedClient =
                  Boolean(appointment.patientId || appointment.contactId) &&
                  !isGenericClient;
                const specialistName =
                  appointment.specialist?.displayName ||
                  appointment.specialist?.name ||
                  appointment.specialistName ||
                  "Sin asignar";
                const appointmentCount =
                  appointment.patient?._count.appointments || 1;
                const linkedContactId =
                  appointment.contactId || appointment.patient?.contactId;
                const contactHref = linkedContactId
                  ? `${basePath === "/dashboard" ? "/dashboard" : basePath.replace(/\/dashboard$/, "")}/contacts/${encodeURIComponent(linkedContactId)}`
                  : null;

                return (
                  <article
                    key={appointment.id}
                    className="appointments-panel-row grid gap-3 rounded-2xl border border-border/70 bg-background p-3 transition hover:border-primary/30 hover:shadow-sm sm:p-4"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-sm font-black text-primary">
                        {getInitials(displayName)}
                      </span>
                      <div className="min-w-0">
                        {hasAssignedClient ? (
                          contactHref ? (
                            <Link
                              href={contactHref}
                              className="block truncate font-bold text-foreground hover:text-primary"
                            >
                              {displayName}
                            </Link>
                          ) : (
                            <span className="block truncate font-bold text-foreground">
                              {displayName}
                            </span>
                          )
                        ) : (
                          <span className="block truncate font-bold text-foreground">
                            Sin cliente asignado
                          </span>
                        )}
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          {phone || "Sin teléfono"} · {appointmentCount} cita
                          {appointmentCount === 1 ? "" : "s"}
                        </p>
                      </div>
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                        <Clock className="h-4 w-4 text-primary" />
                        {formatTime(appointment.startTime, operationContext)}
                        <span className="font-normal text-muted-foreground">
                          {formatDate(appointment.startTime, operationContext, {
                            day: "numeric",
                            month: "short",
                          })}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {appointment.appointmentType || appointment.title}
                      </p>
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{
                            backgroundColor:
                              appointment.specialist?.color || "var(--primary)",
                          }}
                        />
                        <p className="truncate text-sm font-semibold">
                          {specialistName}
                        </p>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <Badge
                          variant="outline"
                          className="rounded-full text-[10px]"
                        >
                          {getStatusLabel(appointment.status)}
                        </Badge>
                      </div>
                    </div>

                    <div className="appointments-panel-actions flex items-center">
                      {canWrite && (
                        <AppointmentQuickActions
                          appointmentId={appointment.id}
                          clientName={displayName}
                          contactId={appointment.contactId}
                          patientId={appointment.patientId}
                          specialistId={appointment.specialistId}
                          serviceId={appointment.serviceId}
                          needsClientAssignment={!hasAssignedClient}
                          needsSpecialistAssignment={!appointment.specialistId}
                          status={appointment.status}
                          confirmationStatus={appointment.confirmationStatus}
                        />
                      )}
                    </div>
                  </article>
                );
              })
            )}
          </div>

          <div className="shrink-0 border-t px-5 py-4 text-sm text-muted-foreground">
            Mostrando {appointments.length} registro
            {appointments.length === 1 ? "" : "s"}
            {query ? ` para "${query}"` : ""}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
