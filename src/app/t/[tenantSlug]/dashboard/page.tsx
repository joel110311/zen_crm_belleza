import Link from "next/link";
import {
    ArrowUpRight,
    CalendarCheck2,
    CalendarDays,
    Clock3,
    Plus,
    Settings2,
    Sparkles,
    Users,
    UsersRound,
    WalletCards,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { businessDayBounds } from "@/lib/calendar/business-hours";
import { buildOperationContext } from "@/lib/operation-context";
import { requireTenantRuntimeContext } from "@/lib/tenant-context";
import { getTenantSystemSettingsOrDefaults } from "@/lib/tenant-system-settings";

export const dynamic = "force-dynamic";

function clientName(value: {
    contact: { name: string | null; lastName: string | null } | null;
}) {
    const contact = [value.contact?.name, value.contact?.lastName].filter(Boolean).join(" ").trim();
    return contact || "Cliente sin nombre";
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

    if (!userId) return null;

    const runtime = await requireTenantRuntimeContext(userId, tenantSlug, "read");
    const settings = await getTenantSystemSettingsOrDefaults(runtime.db);
    const operation = buildOperationContext(settings);
    const now = new Date();
    const today = businessDayBounds(now, operation.timeZone);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const isProfessional = runtime.role === "PROFESSIONAL";
    const ownSpecialistIds = isProfessional
        ? (await runtime.db.specialist.findMany({ where: { userId: runtime.actor.id }, select: { id: true } })).map((item) => item.id)
        : [];
    const appointmentScope = isProfessional ? { specialistId: { in: ownSpecialistIds } } : {};

    const [contacts, appointmentsToday, appointmentsMonth, activeDeals, specialists, nextAppointments] = await Promise.all([
        runtime.db.contact.count(),
        runtime.db.appointment.count({
            where: { startTime: { gte: today.start, lt: today.end }, status: { not: "cancelled" }, ...appointmentScope },
        }),
        runtime.db.appointment.count({
            where: { startTime: { gte: monthStart, lt: nextMonthStart }, status: { not: "cancelled" }, ...appointmentScope },
        }),
        isProfessional ? Promise.resolve(0) : runtime.db.deal.count({ where: { stage: { isClosedLost: false, isClosedWon: false } } }),
        runtime.db.specialist.count({ where: { isActive: true, ...(isProfessional ? { id: { in: ownSpecialistIds } } : {}) } }),
        runtime.db.appointment.findMany({
            where: { startTime: { gte: now }, status: { not: "cancelled" }, ...appointmentScope },
            orderBy: { startTime: "asc" },
            take: 5,
            select: {
                id: true,
                title: true,
                startTime: true,
                specialistName: true,
                contact: { select: { name: true, lastName: true } },
            },
        }),
    ]);

    const dateFormatter = new Intl.DateTimeFormat(operation.locale, {
        timeZone: operation.timeZone,
        weekday: "long",
        day: "numeric",
        month: "long",
    });
    const timeFormatter = new Intl.DateTimeFormat(operation.locale, {
        timeZone: operation.timeZone,
        hour: "2-digit",
        minute: "2-digit",
    });
    const businessName = settings.clinicName === "Zen CRM Belleza" ? runtime.displayName : settings.clinicName;
    const headlineAppointment = nextAppointments[0];
    const metrics = [
        { label: "Clientes", value: contacts, detail: "En tu directorio", icon: Users },
        { label: "Citas de hoy", value: appointmentsToday, detail: "Para atender hoy", icon: CalendarCheck2 },
        { label: "Citas del mes", value: appointmentsMonth, detail: "Agenda mensual", icon: CalendarDays },
        { label: isProfessional ? "Mi agenda" : "Oportunidades", value: isProfessional ? specialists : activeDeals, detail: isProfessional ? "Perfil activo" : "En seguimiento", icon: isProfessional ? UsersRound : WalletCards },
    ];

    return (
        <div className="mx-auto w-full max-w-[1500px] pb-5">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.17em] text-primary">Resumen del negocio</p>
                    <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Hola, {runtime.actor.name || "bienvenido"}</h1>
                    <p className="mt-1 text-sm text-muted-foreground">{businessName}</p>
                </div>
                <Link href={`/t/${runtime.slug}/calendar`} className="inline-flex h-10 items-center justify-center rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
                    <Plus className="mr-2 size-4" /> Nueva cita
                </Link>
            </div>

            <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
                <div className="overflow-hidden rounded-[22px] bg-primary p-5 text-primary-foreground shadow-[0_12px_28px_-22px_color-mix(in_srgb,var(--primary)_95%,black)] sm:p-6">
                    <p className="text-xs font-semibold capitalize text-primary-foreground/75">{dateFormatter.format(now)}</p>
                    <div className="mt-3 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(250px,.72fr)] lg:items-end">
                        <div>
                            <h2 className="max-w-xl text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">Tu agenda y tus clientes,<br className="hidden sm:block" /> siempre bajo control.</h2>
                            <p className="mt-3 max-w-xl text-sm leading-6 text-primary-foreground/80">Organiza cada cita, servicio y seguimiento desde un solo lugar.</p>
                        </div>
                        <div className="rounded-[18px] border border-primary-foreground/15 bg-black/10 p-4 backdrop-blur-sm">
                            <p className="text-xs font-medium text-primary-foreground/70">Próxima cita</p>
                            {headlineAppointment ? (
                                <>
                                    <p className="mt-1 truncate text-base font-semibold">{clientName(headlineAppointment)}</p>
                                    <p className="mt-1 text-sm text-primary-foreground/80">{timeFormatter.format(headlineAppointment.startTime)}{headlineAppointment.specialistName ? ` · ${headlineAppointment.specialistName}` : ""}</p>
                                </>
                            ) : (
                                <>
                                    <p className="mt-1 text-base font-semibold">Aún no tienes citas</p>
                                    <p className="mt-1 text-sm text-primary-foreground/80">Crea la primera cuando estés listo.</p>
                                </>
                            )}
                        </div>
                    </div>
                </div>

                <aside className="rounded-[22px] border bg-card p-5">
                    <div className="flex items-center justify-between"><div><p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Accesos rápidos</p><h2 className="mt-1 text-lg font-semibold">Pon todo en marcha</h2></div><Sparkles className="size-5 text-primary" /></div>
                    <div className="mt-4 space-y-2">
                        <QuickLink href={`/t/${runtime.slug}/contacts`} icon={Users} label="Agregar cliente" detail="Crea una ficha de contacto" />
                        <QuickLink href={`/t/${runtime.slug}/services`} icon={CalendarDays} label="Administrar servicios" detail="Precios, duración y catálogo" />
                        <QuickLink href={`/t/${runtime.slug}/settings?tab=team`} icon={Settings2} label="Configurar equipo" detail="Profesionales y disponibilidad" />
                    </div>
                </aside>
            </section>

            <section className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Indicadores del negocio">
                {metrics.map(({ label, value, detail, icon: Icon }) => (
                    <article key={label} className="rounded-[18px] border bg-card p-5">
                        <div className="flex items-center justify-between"><span className="text-sm font-medium text-muted-foreground">{label}</span><span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary"><Icon className="size-5" /></span></div>
                        <p className="mt-4 text-3xl font-semibold tabular-nums tracking-tight">{value}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
                    </article>
                ))}
            </section>

            <section className="mt-4 overflow-hidden rounded-[22px] border bg-card">
                <div className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div><h2 className="font-semibold">Próximas citas</h2><p className="mt-1 text-sm text-muted-foreground">Horarios en {operation.timeZone}.</p></div>
                    <Link href={`/t/${runtime.slug}/calendar`} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">Ver calendario <ArrowUpRight className="size-4" /></Link>
                </div>
                {nextAppointments.length === 0 ? (
                    <div className="flex flex-col items-center justify-center px-5 py-12 text-center"><span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground"><Clock3 className="size-5" /></span><p className="mt-3 font-medium">Tu agenda está libre</p><p className="mt-1 max-w-sm text-sm text-muted-foreground">Cuando registres una cita, aparecerá aquí junto con el cliente y el servicio.</p></div>
                ) : (
                    <ul className="divide-y">
                        {nextAppointments.map((appointment) => (
                            <li key={appointment.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                                <div className="flex min-w-0 items-center gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><CalendarDays className="size-4" /></span><div className="min-w-0"><p className="truncate font-medium">{appointment.title || "Cita"}</p><p className="truncate text-sm text-muted-foreground">{clientName(appointment)}{appointment.specialistName ? ` · ${appointment.specialistName}` : ""}</p></div></div>
                                <time className="text-sm font-medium text-muted-foreground" dateTime={appointment.startTime.toISOString()}>{timeFormatter.format(appointment.startTime)}</time>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
}

function QuickLink({ href, icon: Icon, label, detail }: { href: string; icon: typeof Users; label: string; detail: string }) {
    return (
        <Link href={href} className="group flex items-center gap-3 rounded-xl border border-transparent p-2.5 transition-colors hover:border-border hover:bg-muted/60">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-primary"><Icon className="size-4" /></span>
            <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{label}</span><span className="block truncate text-xs text-muted-foreground">{detail}</span></span>
            <ArrowUpRight className="size-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </Link>
    );
}
