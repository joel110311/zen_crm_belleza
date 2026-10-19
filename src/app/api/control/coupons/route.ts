import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { controlApiError } from "@/lib/control-api-errors";
import { isSameApplicationOrigin } from "@/lib/security";
import { CouponError, createBillingCoupon, listBillingCoupons, setBillingCouponActive } from "@/lib/billing/coupons";

export const runtime = "nodejs";

function failure(error: unknown) {
    const result = error instanceof CouponError ? { status: error.status, message: error.message } : controlApiError(error);
    if (result.status >= 500) console.error("[control.coupons] Request failed", { status: result.status });
    return NextResponse.json({ error: result.message }, { status: result.status });
}

export async function GET() {
    try {
        await requirePlatformAdmin();
        return NextResponse.json({ coupons: await listBillingCoupons() }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) { return failure(error); }
}

async function mutate(request: NextRequest, creating: boolean) {
    if (!isSameApplicationOrigin(request)) return NextResponse.json({ error: "Origen no permitido." }, { status: 403 });
    try {
        const admin = await requirePlatformAdmin();
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new CouponError("Solicitud inválida.", 400);
        if (creating) return NextResponse.json({ coupon: await createBillingCoupon(body, admin.id) }, { status: 201 });
        if (typeof body.id !== "string" || body.id.length > 100 || typeof body.active !== "boolean") throw new CouponError("Selecciona un cupón y un estado válido.", 400);
        await setBillingCouponActive(body.id, body.active, admin.id);
        return NextResponse.json({ saved: true });
    } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) { return mutate(request, true); }
export async function PATCH(request: NextRequest) { return mutate(request, false); }
