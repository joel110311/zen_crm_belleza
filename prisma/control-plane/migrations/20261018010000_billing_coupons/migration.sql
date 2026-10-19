CREATE TABLE "BillingCoupon" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "code" TEXT NOT NULL,
  "discountPercent" INTEGER NOT NULL CHECK ("discountPercent" IN (50,100)),
  "allowedPlanSlugs" TEXT[] NOT NULL CHECK (cardinality("allowedPlanSlugs") > 0),
  "maxUses" INTEGER NOT NULL CHECK ("maxUses" > 0),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "BillingCoupon_code_key" ON "BillingCoupon"("code");
CREATE INDEX "BillingCoupon_active_createdAt_idx" ON "BillingCoupon"("active","createdAt");
CREATE TABLE "BillingCouponRedemption" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "couponId" TEXT NOT NULL REFERENCES "BillingCoupon"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "tenantId" TEXT REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "activeKey" TEXT,
  "planId" TEXT NOT NULL,
  "originalCents" INTEGER NOT NULL CHECK ("originalCents" > 0),
  "amountCents" INTEGER NOT NULL CHECK ("amountCents" >= 0),
  "discountPercent" INTEGER NOT NULL CHECK ("discountPercent" IN (50,100)),
  "currency" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RESERVED' CHECK ("status" IN ('RESERVED','APPLIED','FAILED')),
  "checkoutAttemptId" TEXT REFERENCES "BillingCheckoutAttempt"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "checkoutUrl" TEXT,
  "periodStartsAt" TIMESTAMP(3),
  "periodEndsAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "BillingCouponRedemption_activeKey_key" ON "BillingCouponRedemption"("activeKey");
CREATE UNIQUE INDEX "BillingCouponRedemption_checkoutAttemptId_key" ON "BillingCouponRedemption"("checkoutAttemptId");
CREATE INDEX "BillingCouponRedemption_couponId_status_idx" ON "BillingCouponRedemption"("couponId","status");
CREATE INDEX "BillingCouponRedemption_tenantId_createdAt_idx" ON "BillingCouponRedemption"("tenantId","createdAt");
