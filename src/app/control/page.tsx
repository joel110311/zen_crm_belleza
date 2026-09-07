import { notFound, redirect } from "next/navigation";
import { CommerceControlCenter } from "@/components/control/commerce-control-center";
import { getControlDb } from "@/lib/control-db";
import { PlatformAdminAccessError, requirePlatformAdmin } from "@/lib/platform-admin";
import { getPlatformAiControlState } from "@/lib/ai/platform-runtime";

export const dynamic = "force-dynamic";

export default async function ControlCenterPage() {
    try { await requirePlatformAdmin(); }
    catch (error) { if (error instanceof PlatformAdminAccessError && error.status === 401) redirect("/login?redirectTo=%2Fcontrol"); notFound(); }

    const db = getControlDb();
    const now = new Date();
    const in48Hours = new Date(now.getTime() + 48 * 60 * 60 * 1_000);
    const ai = await getPlatformAiControlState();
    const [policy, plans, activeTrials, endingTrials, activeSubscriptions, failedPayments, tenants, verifiedSignups, convertedTrials] = await Promise.all([
        db.trialPolicy.findFirst({ where: { isActive: true, isDefault: true }, orderBy: { version: "desc" } }),
        db.plan.findMany({ orderBy: { monthlyAmountCents: "asc" }, include: { prices: { where: { provider: "STRIPE", interval: "MONTHLY", countryCode: null }, take: 1 } } }),
        db.trial.count({ where: { status: { in: ["ACTIVE", "ENDING"] }, endsAt: { gt: now } } }),
        db.trial.count({ where: { status: { in: ["ACTIVE", "ENDING"] }, endsAt: { gt: now, lte: in48Hours } } }),
        db.subscription.findMany({ where: { status: "ACTIVE" }, select: { plan: { select: { monthlyAmountCents: true } } } }),
        db.subscription.count({ where: { status: { in: ["PAST_DUE", "UNPAID"] } } }),
        db.tenant.findMany({ orderBy: { createdAt: "desc" }, take: 30, select: { id: true, displayName: true, slug: true, accessMode: true, billingStatus: true, trial: { select: { endsAt: true, status: true } }, billingSelection: { select: { status: true, lastError: true } }, qrChannelConfiguration: { select: { proxyEnabled: true, proxyUrlCiphertext: true } } } }),
        db.commercialEvent.count({ where: { event: "email_verified" } }),
        db.commercialEvent.count({ where: { event: { in: ["checkout_completed", "scheduled_plan_activated"] } } }),
    ]);
    if (!policy) throw new Error("No existe una política de prueba activa.");
    const mrr = activeSubscriptions.reduce((sum, subscription) => sum + (subscription.plan?.monthlyAmountCents || 0), 0);
    const conversion = verifiedSignups ? Math.min(100, Math.round((convertedTrials / verifiedSignups) * 1000) / 10) : 0;

    return <main className="min-h-dvh bg-muted/20 px-4 py-8 sm:px-6 lg:px-8"><div className="mx-auto max-w-7xl"><header><p className="text-sm font-semibold text-primary">Administración de plataforma</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Centro de mando comercial</h1><p className="mt-2 text-sm text-muted-foreground">Pruebas, planes, cobros, inteligencia y conversión sin entrar a los datos operativos de cada negocio.</p></header><section className="my-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><Metric label="Pruebas activas" value={activeTrials} /><Metric label="Vencen en 48 h" value={endingTrials} /><Metric label="Suscripciones activas" value={activeSubscriptions.length} /><Metric label="Pagos con atención" value={failedPayments} /><Metric label="MRR estimado" value={new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(mrr / 100)} detail={`${conversion}% conversión`} /></section><CommerceControlCenter ai={{ chatModel: ai.chatModel, geminiKeyConfigured: ai.geminiKeyConfigured, openaiKeyConfigured: ai.openaiKeyConfigured, environmentFallbackEnabled: ai.environmentFallbackEnabled }} policy={{ trialDays: policy.trialDays, warningHours: policy.warningHours, finalWarningHours: policy.finalWarningHours, graceDays: policy.graceDays, version: policy.version }} plans={plans.map((plan) => ({ id: plan.id, slug: plan.slug, name: plan.name, monthlyAmountCents: plan.monthlyAmountCents, stripePriceId: plan.prices[0]?.externalPriceId || "" }))} tenants={tenants.map((tenant) => ({ id: tenant.id, displayName: tenant.displayName, slug: tenant.slug, accessMode: tenant.accessMode, billingStatus: tenant.billingStatus, trialEndsAt: tenant.trial?.endsAt.toISOString() || null, trialStatus: tenant.trial?.status || null, selectionStatus: tenant.billingSelection?.status || null, lastError: tenant.billingSelection?.lastError || null, qrProxyEnabled: tenant.qrChannelConfiguration?.proxyEnabled || false, qrProxyConfigured: Boolean(tenant.qrChannelConfiguration?.proxyUrlCiphertext) }))} /></div></main>;
}

function Metric({ label, value, detail }: { label: string; value: string | number; detail?: string }) { return <article className="rounded-2xl border bg-card p-4 shadow-sm"><p className="text-xs font-medium text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p>{detail ? <p className="mt-1 text-xs text-muted-foreground">{detail}</p> : null}</article>; }
