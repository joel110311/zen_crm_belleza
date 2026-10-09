import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { BillingActions } from "./billing-actions";
import { BillingStatusRefresh } from "./billing-status-refresh";
import { RecurringCheckout, RecurringManagement } from "./recurring-controls";
import { PlanChangeActions } from "./plan-change-actions";
import { isMercadoPagoSubscriptionsEnabled } from "@/lib/billing/mercado-pago";
import { BillingAccessError, requireBillingOwner } from "@/lib/billing/context";
import { getActiveBillingProvider } from "@/lib/billing/provider";
import { hasActiveTrial, shouldOfferBillingPortal } from "@/lib/billing/provider-policy";
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
    const billingProvider = getActiveBillingProvider();
    const recurringEnabled = billingProvider === "MERCADO_PAGO" && isMercadoPagoSubscriptionsEnabled();
    const [plans, trial, subscriptions, selection, agreement] = await Promise.all([
        db.plan.findMany({
            where: { isActive: true },
            orderBy: { monthlyAmountCents: "asc" },
            select: {
                id: true,
                slug: true,
                name: true,
                description: true,
                currency: true,
                monthlyAmountCents: true,
                annualAmountCents: true,
                prices: {
                    where: { provider: billingProvider, countryCode: null, isActive: true },
                    select: { interval: true },
                },
            },
        }),
        db.trial.findUnique({ where: { tenantId: context.tenant.tenantId }, select: { endsAt: true, status: true } }),
        db.subscription.findMany({
            where: { tenantId: context.tenant.tenantId },
            orderBy: { updatedAt: "desc" },
            select: { planId: true, provider: true, providerSubscriptionId: true, status: true, currentPeriodStartsAt: true, currentPeriodEndsAt: true, providerCustomerId: true, plan: { select: { name: true } } },
        }),
        db.billingSelection.findUnique({
            where: { tenantId: context.tenant.tenantId },
            select: { status: true, scheduledFor: true, lastError: true, providerCustomerId: true, plan: { select: { name: true, monthlyAmountCents: true, currency: true } } },
        }),
        db.mercadoPagoAgreement.findFirst({ where: { tenantId: context.tenant.tenantId }, orderBy: { createdAt: "desc" }, include: { plan: { select: { name: true } }, planChanges: { where: { activeKey: { not: null } }, take: 1 } } }),
    ]);

    const subscription = subscriptions.find((item) => item.provider === billingProvider && agreement?.providerSubscriptionId && item.providerSubscriptionId === agreement.providerSubscriptionId)
        || subscriptions.find((item) => item.provider === billingProvider);
    const change = agreement?.planChanges[0];
    const canChange = recurringEnabled && agreement?.status === "AUTHORIZED" && !agreement.cancelRequestedAt
        && subscription?.status === "ACTIVE" && subscription.planId === agreement.planId
        && subscription.currentPeriodStartsAt && subscription.currentPeriodEndsAt && subscription.currentPeriodEndsAt > new Date()
        && (!change || change.status === "QUOTED");
    const historicalSubscription = !subscription ? subscriptions.find((item) =>
        ["ACTIVE", "TRIALING"].includes(item.status)
        && (!item.currentPeriodEndsAt || item.currentPeriodEndsAt > new Date())) : null;
    // Match the portal endpoint: scheduled selections and older customer records also qualify.
    const hasStripeCustomer = shouldOfferBillingPortal(billingProvider,
        Boolean(selection?.providerCustomerId) || subscriptions.some((item) => item.provider === "STRIPE" && Boolean(item.providerCustomerId)));
    const checkoutNotice = checkout === "plan-change"
        ? "Regresaste del pago proporcional. La mejora sólo se activa cuando Mercado Pago aprueba el pago y confirma el nuevo importe de la misma suscripción. Actualiza el estado abajo para verificarlo."
        : checkout === "subscription"
        ? "Regresaste de autorizar una suscripción. La autorización no confirma un cobro: verificaremos cada pago con Mercado Pago antes de ampliar tu acceso. Puedes actualizar el estado abajo."
        : checkout === "success"
        ? billingProvider === "MERCADO_PAGO"
            ? "Regresaste de Mercado Pago. Estamos verificando el pago directamente con el proveedor; el acceso se actualizará únicamente cuando quede aprobado."
            : "Tu plan quedó registrado. Confirmaremos la activación cuando el proveedor notifique el resultado del pago."
        : checkout === "scheduled" && billingProvider === "STRIPE"
            ? "Tu método de pago quedó registrado de forma segura. Consulta abajo la fecha de activación del plan."
        : checkout === "pending"
            ? "Mercado Pago dejó el pago pendiente. Conservaremos tu estado actual hasta recibir la confirmación."
        : checkout === "failure"
            ? "Mercado Pago no completó el cobro. No modificamos tu acceso ni tu prueba."
        : checkout === "cancelled"
            ? "El pago fue cancelado. Tu espacio y prueba no cambiaron."
            : null;

    return (
        <main className="mx-auto min-h-dvh max-w-5xl px-5 py-12">
            <BillingStatusRefresh enabled={billingProvider === "MERCADO_PAGO" && ["success", "pending", "plan-change", "subscription"].includes(checkout || "")} />
            <Link
                href={`/t/${encodeURIComponent(context.tenant.slug)}/dashboard`}
                className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-primary transition-colors hover:text-primary/80"
            >
                <ArrowLeft className="size-4" aria-hidden="true" />
                Volver al CRM
            </Link>
            <header className="max-w-2xl">
                <p className="text-sm font-semibold text-primary">Facturación · {context.tenant.displayName}</p>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight">Elige y administra tu plan</h1>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    {billingProvider === "MERCADO_PAGO"
                        ? recurringEnabled
                            ? "Contrata tu plan mensual con renovación automática hasta que canceles. El primer mes y las siguientes mensualidades forman parte de la misma suscripción: no necesitas hacer un pago por separado. Autorizarás los cobros en Mercado Pago; nunca almacenamos los datos de tu tarjeta. Si tienes una prueba o un periodo pagado vigente, el primer cobro se programa para cuando termine. Puedes cancelar la renovación desde este CRM."
                            : "El cobro se realiza en una página segura de Mercado Pago; nunca almacenamos los datos de tu tarjeta. Cada pago cubre una mensualidad, sin renovación automática. Si aún estás en prueba, tu mes pagado comenzará cuando termine."
                        : "El pago se completa en una página segura del proveedor; nunca almacenamos los datos de tu tarjeta. Revisa las condiciones del plan antes de confirmar."}
                </p>
            </header>
            {checkoutNotice ? <p className="mt-6 rounded-lg border bg-muted/40 px-4 py-3 text-sm">{checkoutNotice}</p> : null}
            <section className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm leading-6">
                Acceso anticipado: al pagar se entrega un comprobante digital de pago. Aún no emitimos comprobante fiscal.
            </section>
            <section className="mt-7 grid gap-4 md:grid-cols-3">
                {plans.length === 0 ? <p className="rounded-lg border bg-card p-5 text-sm text-muted-foreground md:col-span-3">Todavía no hay planes de pago configurados para este entorno.</p> : null}
                {plans.map((plan) => {
                    const intervals = new Set(plan.prices.map((price) => price.interval));
                    const interval = billingProvider === "MERCADO_PAGO" && plan.monthlyAmountCents
                        ? "monthly"
                        : intervals.has("MONTHLY") ? "monthly" : intervals.has("ANNUAL") ? "annual" : null;
                    const amount = interval === "annual" ? plan.annualAmountCents : plan.monthlyAmountCents;
                    return (
                        <article key={plan.slug} className="flex flex-col rounded-xl border bg-card p-5 shadow-sm">
                            <div className="flex items-center justify-between gap-2"><h2 className="text-lg font-semibold">{plan.name}</h2>{plan.slug === "automatiza" ? <span className="rounded-full bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary">Más elegido</span> : null}</div>
                            <p className="mt-2 min-h-10 text-sm text-muted-foreground">{plan.description || "Plan de suscripción"}</p>
                            <p className="mt-5 text-2xl font-semibold">{formatMoney(amount, plan.currency)}<span className="ml-1 text-sm font-normal text-muted-foreground">/{interval === "annual" ? "año" : "mes"}</span></p>
                            {recurringEnabled && plan.monthlyAmountCents ? <p className="mt-2 text-xs leading-5 text-muted-foreground">Renovación mensual automática hasta que canceles.</p> : null}
                            <div className="mt-6">
                                {canChange && agreement && plan.id !== agreement.planId && plan.monthlyAmountCents && plan.monthlyAmountCents !== agreement.amountCents && plan.currency === agreement.currency
                                    ? <PlanChangeActions tenantSlug={context.tenant.slug} planSlug={plan.slug} planName={plan.name} upgrade={plan.monthlyAmountCents > agreement.amountCents} />
                                    : recurringEnabled
                                    ? plan.monthlyAmountCents
                                        ? <RecurringCheckout tenantSlug={context.tenant.slug} planSlug={plan.slug} price={formatMoney(plan.monthlyAmountCents, plan.currency)} amountCents={plan.monthlyAmountCents} currency={plan.currency} disabled={Boolean(agreement?.activeKey)} />
                                        : <p className="rounded-lg bg-muted px-3 py-2 text-center text-xs text-muted-foreground">Suscripción mensual por configurar</p>
                                    : interval
                                    ? <BillingActions tenantSlug={context.tenant.slug} planSlug={plan.slug} interval={interval} billingProvider={billingProvider} disabled={Boolean(agreement?.activeKey)} />
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
                        : billingProvider === "STRIPE" && selection && ["PENDING_SETUP", "SCHEDULED", "PROCESSING"].includes(selection.status)
                            ? `${selection.plan.name}: ${selection.status === "PENDING_SETUP" ? "falta confirmar la tarjeta" : `programado para ${new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(selection.scheduledFor)}`}. Puedes cambiar de plan antes de esa fecha desde las opciones superiores.`
                        : historicalSubscription
                            ? `${historicalSubscription.plan?.name || "Plan"}: acceso anterior conservado${historicalSubscription.currentPeriodEndsAt ? ` hasta ${new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(historicalSubscription.currentPeriodEndsAt)}` : ""}. Los nuevos pagos se realizan con Mercado Pago.`
                        : hasActiveTrial(trial, new Date()) ? `Prueba activa hasta ${new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(trial!.endsAt)}.` : "Sin suscripción activa."}
                </p>
                {billingProvider === "MERCADO_PAGO" && subscription && !agreement?.activeKey ? <p className="mt-2 text-sm text-muted-foreground">Tu pago anterior no tiene renovación automática activa.{recurringEnabled ? " Para los siguientes meses, contrata una suscripción desde las opciones de arriba. El primer cobro respetará tu periodo ya pagado." : " Conservas el periodo ya pagado."}</p> : null}
                {billingProvider === "STRIPE" && selection?.status === "FAILED" ? <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">No fue posible activar el plan. No realizaremos intentos ocultos; soporte puede revisar y reintentar la activación. {selection.lastError ? `Referencia: ${selection.lastError}` : ""}</p> : null}
                <div className="mt-4 max-w-xs"><BillingActions tenantSlug={context.tenant.slug} canManage={hasStripeCustomer} billingProvider={billingProvider} /></div>
            </section>
            {billingProvider === "MERCADO_PAGO" && agreement ? <section className="mt-7 rounded-xl border bg-card p-5 shadow-sm">
                <h2 className="font-semibold">Administrar suscripción</h2>
                <p className="mt-2 text-sm">{agreement.plan.name} · {formatMoney(agreement.amountCents, agreement.currency)} al mes · {agreement.environment === "test" ? "Pruebas (no es una suscripción de producción)" : "Producción"}</p>
                <p className="mt-2 text-sm text-muted-foreground">{agreement.status === "AUTHORIZED" ? "Renovación automática autorizada" : agreement.status === "CANCELED" ? "Renovación cancelada" : agreement.status === "PAUSED" ? "Suscripción pausada en Mercado Pago" : agreement.status === "PENDING" ? "Falta completar la autorización en Mercado Pago" : "Autorización en revisión"}.</p>
                {agreement.cancelRequestedAt && agreement.status !== "CANCELED" ? <p role="alert" className="mt-2 text-sm">Cancelación solicitada: falta confirmarla con Mercado Pago. Actualiza el estado o reintenta la cancelación.</p> : null}
                {agreement.nextPaymentAt && agreement.status === "AUTHORIZED" ? <p className="mt-2 text-sm">Próximo cobro programado: {new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Mexico_City" }).format(agreement.nextPaymentAt)}.</p> : null}
                <p className="mt-2 text-sm text-muted-foreground">Inicio programado: {new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeZone: "America/Mexico_City" }).format(agreement.startsAt)}. Cada cobro se confirma por separado; un pago rechazado no extiende el periodo pagado.</p>
                {subscription?.status === "PAST_DUE" ? <p role="alert" className="mt-2 text-sm text-destructive">No se confirmó la renovación. Revisa tu medio de pago en Mercado Pago. Durante el plazo de recuperación el CRM puede quedar en solo lectura; tus datos no se eliminan.</p> : null}
                {agreement.lastError ? <p role="alert" className="mt-2 text-sm text-destructive">{agreement.lastError}</p> : null}
                {change && change.status !== "QUOTED" ? <div className="mt-4 rounded-lg border bg-muted/30 p-4 text-sm" role="status">
                    <p>{change.status === "APPLIED" ? change.direction === "UPGRADE" ? "Mejora activada." : "Bajada de plan programada; conservas tu plan actual hasta el corte." : change.status === "REFUND_PENDING" ? "Devolución del proporcional en verificación; no se activó la mejora." : "Cambio de plan en verificación. No abras un segundo pago."}</p>
                    <p className="mt-2">Proporcional: {formatMoney(change.amountTodayCents, change.currency)}. Próxima mensualidad: {formatMoney(change.toAmountCents, change.currency)} desde el {new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeZone: "America/Mexico_City" }).format(change.effectiveAt)}.</p>
                    {change.lastError ? <p className="mt-2 text-destructive">{change.lastError}</p> : null}
                    <p className="mt-2 text-xs text-muted-foreground">Por seguridad, se admite un cambio confirmado por periodo mensual. Podrás solicitar otro después de confirmar la siguiente renovación.</p>
                </div> : null}
                <RecurringManagement tenantSlug={context.tenant.slug} canCancel={Boolean(agreement.activeKey)} />
            </section> : null}
        </main>
    );
}
