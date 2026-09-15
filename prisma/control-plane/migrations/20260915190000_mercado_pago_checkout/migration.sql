ALTER TYPE "SubscriptionProvider" ADD VALUE IF NOT EXISTS 'MERCADO_PAGO';

CREATE TYPE "BillingCheckoutStatus" AS ENUM (
    'CREATED',
    'PENDING',
    'APPROVED',
    'REJECTED',
    'CANCELLED',
    'REFUNDED',
    'CHARGED_BACK',
    'EXPIRED'
);

CREATE TABLE "BillingCheckoutAttempt" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "provider" "SubscriptionProvider" NOT NULL,
    "externalReference" TEXT NOT NULL,
    "providerCheckoutId" TEXT,
    "providerPaymentId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'MXN',
    "status" "BillingCheckoutStatus" NOT NULL DEFAULT 'CREATED',
    "paidAt" TIMESTAMP(3),
    "periodStartsAt" TIMESTAMP(3),
    "periodEndsAt" TIMESTAMP(3),
    "lastProviderStatus" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingCheckoutAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BillingCheckoutAttempt_externalReference_key"
    ON "BillingCheckoutAttempt"("externalReference");
CREATE UNIQUE INDEX "BillingCheckoutAttempt_providerCheckoutId_key"
    ON "BillingCheckoutAttempt"("providerCheckoutId");
CREATE UNIQUE INDEX "BillingCheckoutAttempt_providerPaymentId_key"
    ON "BillingCheckoutAttempt"("providerPaymentId");
CREATE INDEX "BillingCheckoutAttempt_tenantId_createdAt_idx"
    ON "BillingCheckoutAttempt"("tenantId", "createdAt");
CREATE INDEX "BillingCheckoutAttempt_provider_status_createdAt_idx"
    ON "BillingCheckoutAttempt"("provider", "status", "createdAt");

ALTER TABLE "BillingCheckoutAttempt"
    ADD CONSTRAINT "BillingCheckoutAttempt_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillingCheckoutAttempt"
    ADD CONSTRAINT "BillingCheckoutAttempt_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

UPDATE "Plan"
SET "monthlyAmountCents" = 20000,
    "stripeMonthlyPriceId" = NULL,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE slug = 'esencial';

-- The existing Stripe price represented MXN 300 and cannot be edited in Stripe.
-- Disable it so the CRM can never advertise MXN 200 and charge the obsolete amount.
UPDATE "BillingPrice"
SET "isActive" = false, "updatedAt" = CURRENT_TIMESTAMP
WHERE provider = 'STRIPE'
  AND interval = 'MONTHLY'
  AND "planId" = (SELECT id FROM "Plan" WHERE slug = 'esencial');
