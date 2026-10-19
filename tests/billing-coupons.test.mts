import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest, NextResponse } from "next/server.js";
import { couponCode, discountedCents, validateCouponInput, assertCouponAvailable, CouponError } from "../src/lib/billing/coupon-policy.ts";
import { loadTsModule } from "./helpers/load-ts-module.mts";

test("coupon amount is computed in cents for 50% and 100% on all published plans", () => {
    for (const amount of [29900, 49900, 79900]) {
        assert.equal(discountedCents(amount, 50), amount / 2);
        assert.equal(discountedCents(amount, 100), 0);
    }
    assert.equal(discountedCents(29901, 50), 14951);
    for (const invalid of [0, 10, 99, 101]) assert.throws(() => discountedCents(29900, invalid));
    assert.throws(() => discountedCents(-5, 50));
});

test("coupon creation rejects arbitrary discounts, unknown plans, expired dates and unbounded use", () => {
    const now = new Date("2026-10-18T12:00:00Z");
    const input = { discountPercent: 50, maxUses: 3, expiresAt: "2026-11-01T12:00:00Z", allowedPlanSlugs: ["esencial", "esencial"] };
    const valid = validateCouponInput(input, ["esencial"], now);
    assert.deepEqual(valid.allowedPlanSlugs, ["esencial"]);
    for (const patch of [{ discountPercent: 25 }, { discountPercent: "50" }, { maxUses: 0 }, { maxUses: 100001 }, { maxUses: 1.5 }, { expiresAt: "invalid" }, { expiresAt: now.toISOString() }, { expiresAt: "2028-01-01" }, { allowedPlanSlugs: [] }, { allowedPlanSlugs: ["other"] }]) {
        assert.throws(() => validateCouponInput({ ...input, ...patch }, ["esencial"], now));
    }
});

test("coupon normalization and eligibility fail closed", () => {
    assert.equal(couponCode(" zen-50-abcdef "), "ZEN-50-ABCDEF");
    for (const raw of [null, {}, "a", "a/bbbbb", "<script>", "x".repeat(41)]) assert.throws(() => couponCode(raw));
    const now = new Date();
    const coupon = { active: true, expiresAt: new Date(now.getTime() + 5000), maxUses: 1, allowedPlanSlugs: ["esencial"] };
    assert.doesNotThrow(() => assertCouponAvailable(coupon, "esencial", 0, now));
    for (const [item, plan, uses] of [[null, "esencial", 0], [{ ...coupon, active: false }, "esencial", 0], [coupon, "pro", 0], [coupon, "esencial", 1], [{ ...coupon, expiresAt: now }, "esencial", 0]] as const) {
        assert.throws(() => assertCouponAvailable(item, plan, uses, now));
    }
});

function api(allowed = true, sameOrigin = true, rate = true) {
    let reads = 0;
    class AccessError extends Error { status = 403; }
    const mod = loadTsModule("src/app/api/billing/coupon/route.ts", {
        "next/server": { NextRequest, NextResponse },
        "@/lib/security": { isSameApplicationOrigin: () => sameOrigin, consumeSharedRateLimit: async () => ({ allowed: rate }) },
        "@/lib/billing/context": { BillingAccessError: AccessError, requireBillingOwner: async () => { if (!allowed) throw new AccessError("Owner required"); return { tenant: { tenantId: "t", slug: "test" }, user: { id: "u" } }; } },
        "@/lib/billing/provider": { getActiveBillingProvider: () => "MERCADO_PAGO" },
        "@/lib/billing/coupons": { CouponError, previewBillingCoupon: async () => { reads++; return { amountCents: 0 }; }, redeemBillingCoupon: async () => { reads++; return { url: "/billing/test" }; } },
    });
    return { post: mod.POST as (request: NextRequest) => Promise<Response>, reads: () => reads };
}
const request = (body: unknown) => new NextRequest("https://crm.test/api/billing/coupon", { method: "POST", body: JSON.stringify(body) });
const body = { tenantSlug: "test", planSlug: "esencial", code: "ZEN-100-ABCDEF", action: "preview" };
test("only an owner with same-origin request and available quota can consult a coupon", async () => {
    for (const [owner, origin, rate, status] of [[false, true, true, 403], [true, false, true, 403], [true, true, false, 429]] as const) {
        const h = api(owner, origin, rate); assert.equal((await h.post(request(body))).status, status); assert.equal(h.reads(), 0);
    }
    const h = api(); assert.equal((await h.post(request(body))).status, 200); assert.equal(h.reads(), 1);
});

test("malformed coupon requests cannot reach billing", async () => {
    const h = api();
    for (const bad of [null, [], {}, { ...body, action: "grant" }, { ...body, tenantSlug: 1 }]) assert.equal((await h.post(request(bad))).status, 400);
    assert.equal(h.reads(), 0);
});

test("admin coupon endpoints enforce platform admin before reading or creating promotions", async () => {
    let calls = 0;
    class AccessError extends Error { status = 403; }
    const mod = loadTsModule("src/app/api/control/coupons/route.ts", {
        "next/server": { NextRequest, NextResponse }, "@/lib/security": { isSameApplicationOrigin: () => true },
        "@/lib/platform-admin": { requirePlatformAdmin: async () => { throw new AccessError("Forbidden"); } },
        "@/lib/control-api-errors": { controlApiError: () => ({ status: 403, message: "Forbidden" }) },
        "@/lib/billing/coupons": { CouponError, listBillingCoupons: () => calls++, createBillingCoupon: () => calls++, setBillingCouponActive: () => calls++ },
    });
    assert.equal((await (mod.GET as () => Promise<Response>)()).status, 403);
    assert.equal((await (mod.POST as (r: NextRequest) => Promise<Response>)(request({}))).status, 403);
    assert.equal((await (mod.PATCH as (r: NextRequest) => Promise<Response>)(request({}))).status, 403);
    assert.equal(calls, 0);
});

test("a prepaid coupon month preserves the trial chatbot quota and starts the plan quota at the correct date", async () => {
    const now = Date.now();
    let clock = now;
    class Clock extends Date { constructor(value?: string | number | Date) { super(value ?? clock); } static now() { return clock; } }
    const start = new Date(now - 1000), boundary = new Date(now + 14 * 86_400_000), end = new Date(now + 45 * 86_400_000);
    const mod = loadTsModule("src/lib/billing/chatbot-usage.ts", {
        "server-only": {}, "@/lib/active-tenant-context": {}, "@/lib/routed-prisma": {}, "@/lib/whatsapp-audio": {},
        "@/lib/control-db": { getControlDb: () => ({
            subscription: { findFirst: async () => ({ planId: "plan", currentPeriodStartsAt: boundary, currentPeriodEndsAt: end, plan: { limits: { chatbotMessagesPerMonth: 1000 }, features: { chatbot: true } } }) },
            trial: { findUnique: async () => ({ startsAt: start, endsAt: boundary, status: "ACTIVE" }) },
            usageLedger: { aggregate: async () => ({ _sum: { quantity: 0 } }) },
        }) },
    }, { Date: Clock });
    const usage = mod.getChatbotUsage as (tenant: string) => Promise<{ limit: number; isTrial: boolean; periodStart: string }>;
    const trial = await usage("tenant");
    assert.equal(trial.isTrial, true); assert.equal(trial.limit, 500); assert.equal(trial.periodStart, start.toISOString());
    clock = boundary.getTime() + 1000;
    const paid = await usage("tenant");
    assert.equal(paid.isTrial, false); assert.equal(paid.limit, 1000); assert.equal(paid.periodStart, boundary.toISOString());
});
