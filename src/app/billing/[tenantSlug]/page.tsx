import { notFound, redirect } from "next/navigation";
import { BillingActions } from "./billing-actions";
import { BillingAccessError, requireBillingOwner } from "@/lib/billing/context";
import { getControlDb } from "@/lib/control-db";

export const dynamic = "force-dynamic";

function formatMoney(amountCents: number | null, currency: string, locale = "es-MX") {
    if (amountCents === null) return "Precio por configurar";
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amountCents / 100);
}

export default async function BillingPage({
    params,
    searchParams,
}: {
    params: Promise<{ tenantSlug: string }>;
    searchParams: Promise<{ checkout?: string }>;
}) {
    const [{ tenantSlug }, { checkout }] = await Promise.all([params, searchParams]);
    let context;
    try {
        context = await requireBillingOwner(tenantSlug);
    } catch (error) {
        if (error instanceof BillingAccessError) {
            if (error.status === 401) redirect("/login");
            notFound();
        }
        throw error;
    }

    const db = getControlDb();
    const [plans, trial, subscription, selection] = await Promise.all([
        db.plan.findMany({
            where: { isActive: true },
            orderBy: { createdAt: "asc" },
            select: {
                slug: true,
                name: true,
                description: true,
                currency: true,
                monthlyAmountCents: true,
                annualAmountCents: true,
                prices: {
                    where: { provider: "STRIPE", countryCode: null, isActive: true },
                    select: { interval: true },
                },
            },
        }),
        db.trial.findUnique({ where: { tenantId: context.tenant.tenantId }, select: { endsAt: true } }),
        db.subscription.findFirst({
            where: { tenantId: context.tenant.tenantId, provider: "STRIPE" },
            orderBy: { updatedAt: "desc" },
            select: { status: true, currentPeriodEndsAt: true, providerCustomerId: true, plan: { select: { name: true } } },
        }),
        db.billingSelection.findUnique({
            where: { tenantId: context.tenant.tenantId },
            select: { status: true, scheduledFor: true, lastError: true, providerCustomerId: true, plan: { select: { name: true, monthlyAmountCents: true, currency: true } } },
        }),
    ]);

    const hasStripeCustomer = Boolean(subscription?.providerCustomerId);
    const checkoutNotice = checkout === "success"
        ? "Tu plan quedó registrado. Stripe realizará el primer cobro cuando termine la prueba y confirmaremos el acceso mediante un webhook firmado."
        : checkout === "scheduled"
            ? "Tu tarjeta quedó protegida en Stripe. El plan se activará y cobrará cuando termine la prueba."
        : checkout === "cancelled"
            ? "El pago fue cancelado. Tu espacio y prueba no cambiaron."
            : null;

    return (
        <main className="mx-auto min-h-dvh max-w-5xl px-5 py-12">
            <header className="max-w-2xl">
                <p className="text-sm font-semibold text-primary">Facturación · {context.tenant.displayName}</p>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight">Elige y administra tu plan</h1>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">El cobro ocurre en una página segura de Stripe; nunca almacenamos los datos de tarjeta. Si eliges durante la prueba, hoy pagas $0 y el primer cargo ocurre al finalizar.</p>
            </header>
            {checkoutNotice ? <p className="mt-6 rounded-lg border bg-muted/40 px-4 py-3 text-sm">{checkoutNotice}</p> : null}
            <section className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm leading-6">
                Acceso anticipado: Stripe entrega un comprobante digital de pago. Aún no emitimos CFDI mexicano. Si necesitas factura fiscal para contratar, no realices el pago todavía.
            </section>
            <section className="mt-7 grid gap-4 md:grid-cols-3">
                {plans.length === 0 ? <p className="rounded-lg border bg-card p-5 text-sm text-muted-foreground md:col-span-3">Todavía no hay planes de pago configurados para este entorno.</p> : null}
                {plans.map((plan) => {
                    const intervals = new Set(plan.prices.map((price) => price.interval));
                    const interval = intervals.has("MONTHLY") ? "monthly" : intervals.has("ANNUAL") ? "annual" : null;
                    const amount = interval === "annual" ? plan.annualAmountCents : plan.monthlyAmountCents;
                    return (
                        <article key={plan.slug} className="flex flex-col rounded-xl border bg-card p-5 shadow-sm">
                            <div className="flex items-center justify-between gap-2"><h2 className="text-lg font-semibold">{plan.name}</h2>{plan.slug === "automatiza" ? <span className="rounded-full bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary">Más elegido</span> : null}</div>
                            <p className="mt-2 min-h-10 text-sm text-muted-foreground">{plan.description || "Plan de suscripción"}</p>
                            <p className="mt-5 text-2xl font-semibold">{formatMoney(amount, plan.currency)}<span className="ml-1 text-sm font-normal text-muted-foreground">/{interval === "annual" ? "año" : "mes"}</span></p>
                            <div className="mt-6">
                                {interval
                                    ? <BillingActions tenantSlug={context.tenant.slug} planSlug={plan.slug} interval={interval} />
                                    : <p className="rounded-lg bg-muted px-3 py-2 text-center text-xs text-muted-foreground">Pago en línea por configurar</p>}
                            </div>
                        </article>
                    );
                })}
            </section>
            <section className="mt-7 rounded-xl border bg-card p-5 shadow-sm">
                <h2 className="font-semibold">Estado actual</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                    {subscription
                        ? `${subscription.plan?.name || "Plan"}: ${subscription.status.toLowerCase().replaceAll("_", " ")}${subscription.currentPeriodEndsAt ? ` · próximo corte ${new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(subscription.currentPeriodEndsAt)}` : ""}`
                        : selection && ["PENDING_SETUP", "SCHEDULED", "PROCESSING"].includes(selection.status)
                            ? `${selection.plan.name}: ${selection.status === "PENDING_SETUP" ? "falta confirmar la tarjeta" : `programado para ${new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(selection.scheduledFor)}`}. Puedes cambiar de plan antes de esa fecha desde las opciones superiores.`
                        : trial ? `Prueba activa hasta ${new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(trial.endsAt)}.` : "Sin suscripción activa."}
                </p>
                {selection?.status === "FAILED" ? <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">No fue posible activar el plan. No realizaremos intentos ocultos; soporte puede revisar y reintentar la activación. {selection.lastError ? `Referencia: ${selection.lastError}` : ""}</p> : null}
                <div className="mt-4 max-w-xs"><BillingActions tenantSlug={context.tenant.slug} canManage={hasStripeCustomer} /></div>
            </section>
        </main>
    );
}
