import Link from "next/link";
import { CalendarDays, MessageCircle, Stethoscope, Users, WalletCards } from "lucide-react";
import { auth } from "@/lib/auth";
import { businessDayBounds } from "@/lib/calendar/business-hours";
import { buildOperationContext } from "@/lib/operation-context";
import { requireTenantRuntimeContext } from "@/lib/tenant-context";
import { getTenantSystemSettingsOrDefaults } from "@/lib/tenant-system-settings";

export const dynamic = "force-dynamic";

function personName(value: {
    contact: { name: string | null; lastName: string | null } | null;
    patient: { firstName: string; lastName: string } | null;
}) {
    const contactName = [value.contact?.name, value.contact?.lastName].filter(Boolean).join(" ").trim();
    const patientName = [value.patient?.firstName, value.patient?.lastName].filter(Boolean).join(" ").trim();
    return patientName || contactName || "Cliente sin nombre";
}

export default async function TenantDashboardPage({
    params,
}: {
    params: Promise<{ tenantSlug: string }>;
}) {
    const { tenantSlug } = await params;
    const session = await auth();
    const userId = typeof (session?.user as { id?: unknown } | undefined)?.id === "string"
        ? (session?.user as { id: string }).id
        : null;

    if (!userId) {
        return null;
    }

    const tenant = await requireTenantRuntimeContext(userId, tenantSlug, "read");
    const tenantDb = tenant.db;
    const settings = await getTenantSystemSettingsOrDefaults(tenantDb);
    const operation = buildOperationContext(settings);
    const now = new Date();
    const today = businessDayBounds(now, operation.timeZone);
    const isProfessional = tenant.role === "PROFESSIONAL";
    const ownSpecialists = isProfessional
        ? await tenantDb.specialist.findMany({ where: { userId: tenant.actor.id }, select: { id: true } })
        : [];
    const ownSpecialistIds = ownSpecialists.map((specialist) => specialist.id);
    const appointmentScope = isProfessional ? { specialistId: { in: ownSpecialistIds } } : {};

    const [contacts, patients, activeConversations, appointmentsToday, activeDeals, nextAppointments] = await Promise.all([
        tenantDb.contact.count(),
        tenantDb.patient.count(),
        isProfessional ? Promise.resolve(0) : tenantDb.conversation.count({ where: { status: "active" } }),
        tenantDb.appointment.count({
            where: {
                startTime: { gte: today.start, lt: today.end },
                status: { not: "cancelled" },
                ...appointmentScope,
            },
        }),
        isProfessional ? Promise.resolve(0) : tenantDb.deal.count(),
        tenantDb.appointment.findMany({
            where: {
                startTime: { gte: now },
                status: { not: "cancelled" },
                ...appointmentScope,
            },
            orderBy: { startTime: "asc" },
            take: 5,
            select: {
                id: true,
                title: true,
                startTime: true,
                specialistName: true,
                contact: { select: { name: true, lastName: true } },
                patient: { select: { firstName: true, lastName: true } },
            },
        }),
    ]);

    const timeFormatter = new Intl.DateTimeFormat(operation.locale, {
        timeZone: operation.timeZone,
        hour: "2-digit",
        minute: "2-digit",
        weekday: "short",
    });

    const metrics = isProfessional
        ? [
            { label: "Contactos", value: contacts, icon: Users },
            { label: "Pacientes", value: patients, icon: Stethoscope },
            { label: "Mis citas de hoy", value: appointmentsToday, icon: CalendarDays },
        ]
        : [
            { label: "Contactos", value: contacts, icon: Users },
            { label: "Conversaciones activas", value: activeConversations, icon: MessageCircle },
            { label: "Citas de hoy", value: appointmentsToday, icon: CalendarDays },
            { label: "Oportunidades", value: activeDeals, icon: WalletCards },
        ];

    return (
        <main className="min-h-screen bg-muted/30 px-5 py-8 sm:px-8">
            <div className="mx-auto max-w-6xl">
                <header className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <p className="text-sm font-medium text-muted-foreground">{operation.clinicSubtitle}</p>
                        <h1 className="mt-1 text-3xl font-semibold tracking-tight">{tenant.displayName}</h1>
                        <p className="mt-2 text-sm text-muted-foreground">
                            Panel inicial del entorno aislado. Los datos de este negocio no se comparten con ningún otro tenant.
                        </p>
                    </div>
                    <Link
                        className="inline-flex h-10 items-center justify-center rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                        href={`/t/${tenant.slug}/onboarding`}
                    >
                        Configurar negocio
                    </Link>
                </header>

                <section className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Indicadores del negocio">
                    {metrics.map(({ label, value, icon: Icon }) => (
                        <article key={label} className="rounded-[18px] border bg-card p-5">
                            <div className="flex items-center justify-between text-muted-foreground">
                                <span className="text-sm">{label}</span>
                                <Icon className="size-4" aria-hidden="true" />
                            </div>
                            <p className="mt-3 text-3xl font-semibold tabular-nums">{value}</p>
                        </article>
                    ))}
                </section>

                <section className="mt-7 overflow-hidden rounded-[18px] border bg-card">
                    <div className="border-b px-5 py-4">
                        <h2 className="font-semibold">Próximas citas</h2>
                        <p className="mt-1 text-sm text-muted-foreground">En horario de {operation.timeZone}.</p>
                    </div>
                    {nextAppointments.length === 0 ? (
                        <p className="px-5 py-8 text-sm text-muted-foreground">Aún no hay citas próximas en este negocio.</p>
                    ) : (
                        <ul className="divide-y">
                            {nextAppointments.map((appointment) => (
                                <li key={appointment.id} className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                                    <div>
                                        <p className="font-medium">{appointment.title || personName(appointment)}</p>
                                        <p className="text-sm text-muted-foreground">
                                            {personName(appointment)}{appointment.specialistName ? ` · ${appointment.specialistName}` : ""}
                                        </p>
                                    </div>
                                    <time className="text-sm font-medium text-muted-foreground" dateTime={appointment.startTime.toISOString()}>
                                        {timeFormatter.format(appointment.startTime)}
                                    </time>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
            </div>
        </main>
    );
}
