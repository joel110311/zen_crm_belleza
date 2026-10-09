import { NextRequest, NextResponse } from "next/server";
import { BillingAccessError, requireBillingOwner } from "@/lib/billing/context";
import { getControlDb } from "@/lib/control-db";
import { isSameApplicationOrigin } from "@/lib/security";
import { MercadoPagoBillingConfigurationError } from "@/lib/billing/mercado-pago";
import { cancelRecurringSubscription, RecurringBillingError, startRecurringSubscription, synchronizeRecurringAgreement } from "@/lib/billing/mercado-pago-subscriptions";
import { acceptRecurringPlanChange, quoteRecurringPlanChange } from "@/lib/billing/mercado-pago-plan-changes";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
    if (!isSameApplicationOrigin(request)) return NextResponse.json({ error: "Origen no permitido." }, { status: 403 });
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body.tenantSlug !== "string" || !["start", "sync", "cancel", "quote_change", "accept_change"].includes(String(body.action))) return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
    try {
        const { tenant, user } = await requireBillingOwner(body.tenantSlug);
        if (body.action === "quote_change") {
            if (typeof body.planSlug !== "string") return NextResponse.json({ error: "Selecciona un plan." }, { status: 400 });
            return NextResponse.json({ quote: await quoteRecurringPlanChange(tenant.tenantId, body.planSlug) });
        }
        if (body.action === "accept_change") {
            if (typeof body.changeId !== "string") return NextResponse.json({ error: "Falta la confirmación del cambio." }, { status: 400 });
            return NextResponse.json(await acceptRecurringPlanChange(tenant.tenantId, tenant.slug, user, body.changeId, body.consent, body.consentVersion));
        }
        if (body.action === "start") {
            if (typeof body.planSlug !== "string") return NextResponse.json({ error: "Selecciona un plan." }, { status: 400 });
            const url = await startRecurringSubscription({ tenantId: tenant.tenantId, tenantSlug: tenant.slug, userId: user.id, email: user.email,
                planSlug: body.planSlug, consent: body.consent, consentVersion: body.consentVersion, amountCents: body.amountCents, currency: body.currency });
            return NextResponse.json({ url });
        }
        if (body.action === "cancel") {
            if (body.confirmCancel !== true) return NextResponse.json({ error: "Confirma que deseas cancelar la renovación." }, { status: 400 });
            await cancelRecurringSubscription(tenant.tenantId, user.id);
        } else {
            const agreement = await getControlDb().mercadoPagoAgreement.findFirst({ where: { tenantId: tenant.tenantId }, orderBy: { createdAt: "desc" } });
            if (agreement) await synchronizeRecurringAgreement(agreement);
        }
        return NextResponse.json({ ok: true });
    } catch (error) {
        if (error instanceof BillingAccessError || error instanceof RecurringBillingError) return NextResponse.json({ error: error.message }, { status: error.status });
        if (error instanceof MercadoPagoBillingConfigurationError) return NextResponse.json({ error: "La facturación no está disponible en este momento." }, { status: 503 });
        console.error("[billing.subscription] Operation failed", error);
        return NextResponse.json({ error: "No se confirmó la operación. Actualiza el estado antes de reintentar; no contrates otra suscripción." }, { status: 502 });
    }
}
