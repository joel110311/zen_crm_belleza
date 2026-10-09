import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getControlDb } from "@/lib/control-db";
import { cancelRecurringSubscription, synchronizeRecurringAgreement } from "@/lib/billing/mercado-pago-subscriptions";
import { recoverRecurringPlanChanges } from "@/lib/billing/mercado-pago-plan-changes";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
    const expected = process.env.BILLING_RECONCILIATION_SECRET || "";
    const supplied = request.headers.get("x-billing-worker-secret") || "";
    if (expected.length < 32 || Buffer.byteLength(expected) !== Buffer.byteLength(supplied) || !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const db = getControlDb();
    const body = await request.json().catch(() => null) as { action?: string; tenantId?: string } | null;
    if (body?.action === "cancel_for_deletion") {
        const frozen = typeof body.tenantId === "string" ? await db.tenant.findFirst({ where: { id: body.tenantId, status: "ARCHIVED", accessMode: "SUSPENDED", memberships: { none: { role: "OWNER", isActive: true } } } }) : null;
        if (!frozen) return NextResponse.json({ error: "Not found" }, { status: 404 });
        try {
            await cancelRecurringSubscription(frozen.id, "account-deletion-worker");
            const agreements = await db.mercadoPagoAgreement.findMany({ where: { tenantId: frozen.id, planChanges: { some: { activeKey: { not: null } } } } });
            for (const agreement of agreements) await recoverRecurringPlanChanges(agreement.id);
            return NextResponse.json({ ok: true });
        }
        catch { return NextResponse.json({ error: "No se confirmó la cancelación." }, { status: 502 }); }
    }
    // One agreement per poll. Include canceled agreements for late debits/refunds; never charge here.
    const agreement = await db.mercadoPagoAgreement.findFirst({ where: {
        status: { not: "FAILED" }, createdAt: { lt: new Date(Date.now() - 60_000) },
        OR: [{ reconciledAt: null }, { reconciledAt: { lt: new Date(Date.now() - 10 * 60_000) } }],
    }, orderBy: { reconciledAt: { sort: "asc", nulls: "first" } } });
    if (!agreement) return NextResponse.json({ ok: true, processed: 0 });
    const claim = await db.mercadoPagoAgreement.updateMany({ where: { id: agreement.id, reconciledAt: agreement.reconciledAt }, data: { reconciledAt: new Date() } });
    if (!claim.count) return NextResponse.json({ ok: true, processed: 0 });
    try {
        await synchronizeRecurringAgreement(agreement);
        return NextResponse.json({ ok: true, processed: 1 });
    } catch (error) {
        console.error("[billing.reconcile] Agreement verification failed", agreement.id, error);
        await db.mercadoPagoAgreement.update({ where: { id: agreement.id }, data: { lastError: "La sincronización no se confirmó. Soporte debe revisar las credenciales o la autorización." } });
        return NextResponse.json({ error: "No se confirmó la sincronización." }, { status: 502 });
    }
}
