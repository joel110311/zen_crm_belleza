-- Keep billing provider choice out of tenant identity and data storage.
ALTER TYPE "SubscriptionProvider" ADD VALUE IF NOT EXISTS 'PADDLE';

CREATE TYPE "BillingInterval" AS ENUM ('MONTHLY', 'ANNUAL');

CREATE TABLE "BillingPrice" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "provider" "SubscriptionProvider" NOT NULL,
    "interval" "BillingInterval" NOT NULL,
    "externalPriceId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'MXN',
    "countryCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BillingPrice_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "BillingPrice"
    ADD CONSTRAINT "BillingPrice_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "BillingPrice_provider_externalPriceId_key"
    ON "BillingPrice"("provider", "externalPriceId");
CREATE INDEX "BillingPrice_planId_provider_interval_isActive_idx"
    ON "BillingPrice"("planId", "provider", "interval", "isActive");
CREATE INDEX "BillingPrice_countryCode_isActive_idx"
    ON "BillingPrice"("countryCode", "isActive");

ALTER TABLE "StripeEvent" RENAME TO "BillingEvent";
ALTER TABLE "BillingEvent" RENAME COLUMN "stripeEventId" TO "providerEventId";
ALTER TABLE "BillingEvent" ADD COLUMN "provider" "SubscriptionProvider" NOT NULL DEFAULT 'STRIPE';

DROP INDEX "StripeEvent_stripeEventId_key";
CREATE UNIQUE INDEX "BillingEvent_provider_providerEventId_key"
    ON "BillingEvent"("provider", "providerEventId");
