export class CouponError extends Error {
    readonly status: number;
    constructor(message: string, status = 409) { super(message); this.name = "CouponError"; this.status = status; }
}

export function couponCode(value: unknown) {
    if (typeof value !== "string" || !/^[A-Z0-9-]{4,40}$/.test(value.trim().toUpperCase())) {
        throw new CouponError("Escribe un código de cupón válido.", 400);
    }
    return value.trim().toUpperCase();
}

export function discountedCents(originalCents: number, percent: number) {
    if (!Number.isSafeInteger(originalCents) || originalCents <= 0 || ![50, 100].includes(percent)) {
        throw new CouponError("Este descuento no está disponible.", 400);
    }
    return Math.round(originalCents * (100 - percent) / 100);
}

export function validateCouponInput(body: Record<string, unknown>, activePlans: string[], now = new Date()) {
    const percent = body.discountPercent;
    const maxUses = body.maxUses;
    const expiresAt = typeof body.expiresAt === "string" ? new Date(body.expiresAt) : new Date(NaN);
    const plans = Array.isArray(body.allowedPlanSlugs) ? [...new Set(body.allowedPlanSlugs)] : [];
    if ((percent !== 50 && percent !== 100) || typeof maxUses !== "number" || !Number.isSafeInteger(maxUses) || maxUses < 1 || maxUses > 100_000) {
        throw new CouponError("Elige 50% o 100% y un límite entre 1 y 100,000 usos.", 400);
    }
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now || expiresAt.getTime() > now.getTime() + 366 * 86_400_000) {
        throw new CouponError("La vigencia debe estar entre hoy y los próximos 12 meses.", 400);
    }
    if (!plans.length || plans.some(plan => typeof plan !== "string" || !activePlans.includes(plan))) {
        throw new CouponError("Selecciona al menos un plan disponible.", 400);
    }
    return { discountPercent: percent, maxUses, expiresAt, allowedPlanSlugs: plans as string[] };
}

export function assertCouponAvailable(coupon: {
    active: boolean; expiresAt: Date; maxUses: number; allowedPlanSlugs: string[];
} | null, planSlug: string, reservedUses: number, now = new Date()) {
    if (!coupon || !coupon.active || coupon.expiresAt <= now || !coupon.allowedPlanSlugs.includes(planSlug) || reservedUses >= coupon.maxUses) {
        throw new CouponError("El cupón no aplica a este plan, ya venció o no tiene usos disponibles.");
    }
}
