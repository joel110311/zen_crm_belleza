CREATE TYPE "TrialStatus" AS ENUM ('ACTIVE', 'ENDING', 'CONVERTED', 'EXPIRED');
CREATE TYPE "TrialPaymentCollectionMode" AS ENUM ('OPTIONAL_AFTER_ONBOARDING', 'REQUIRED_BEFORE_TRIAL');
CREATE TYPE "TrialRedemptionStatus" AS ENUM ('RESERVED', 'REDEEMED');
CREATE TYPE "BillingSelectionStatus" AS ENUM ('PENDING_SETUP', 'SCHEDULED', 'PROCESSING', 'ACTIVATED', 'CANCELLED', 'FAILED');

CREATE TABLE "TrialPolicy" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "trialDays" INTEGER NOT NULL DEFAULT 7,
    "warningHours" INTEGER NOT NULL DEFAULT 48,
    "finalWarningHours" INTEGER NOT NULL DEFAULT 24,
    "paymentCollectionMode" "TrialPaymentCollectionMode" NOT NULL DEFAULT 'OPTIONAL_AFTER_ONBOARDING',
    "graceDays" INTEGER NOT NULL DEFAULT 3,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrialPolicy_pkey" PRIMARY KEY ("id")
);

INSERT INTO "TrialPolicy" ("id", "slug", "name", "version", "trialDays", "warningHours", "finalWarningHours", "graceDays", "isDefault", "isActive")
VALUES ('trial_default_v1', 'default', 'Prueba estándar', 1, 7, 48, 24, 3, true, true);

CREATE UNIQUE INDEX "TrialPolicy_slug_key" ON "TrialPolicy"("slug");
CREATE INDEX "TrialPolicy_isActive_isDefault_idx" ON "TrialPolicy"("isActive", "isDefault");
CREATE UNIQUE INDEX "TrialPolicy_one_default_idx" ON "TrialPolicy"("isDefault") WHERE "isDefault" = true AND "isActive" = true;

ALTER TABLE "Trial"
    ADD COLUMN "policyId" TEXT,
    ADD COLUMN "policyVersion" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "durationDays" INTEGER NOT NULL DEFAULT 7,
    ADD COLUMN "warningHours" INTEGER NOT NULL DEFAULT 48,
    ADD COLUMN "finalWarningHours" INTEGER NOT NULL DEFAULT 24,
    ADD COLUMN "status" "TrialStatus" NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN "warningSentAt" TIMESTAMP(3),
    ADD COLUMN "finalWarningAt" TIMESTAMP(3);

UPDATE "Trial"
SET "policyId" = 'trial_default_v1',
    "durationDays" = GREATEST(1, CEIL(EXTRACT(EPOCH FROM ("endsAt" - "startsAt")) / 86400.0)::INTEGER),
    "status" = CASE
        WHEN "convertedAt" IS NOT NULL THEN 'CONVERTED'::"TrialStatus"
        WHEN "expiredAt" IS NOT NULL OR "endsAt" <= CURRENT_TIMESTAMP THEN 'EXPIRED'::"TrialStatus"
        ELSE 'ACTIVE'::"TrialStatus"
    END;

DROP INDEX "Trial_endsAt_idx";
CREATE INDEX "Trial_status_endsAt_idx" ON "Trial"("status", "endsAt");
ALTER TABLE "Trial" ADD CONSTRAINT "Trial_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "TrialPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "TrialRedemption" (
    "id" TEXT NOT NULL,
    "emailHmac" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "status" "TrialRedemptionStatus" NOT NULL DEFAULT 'RESERVED',
    "tenantReference" TEXT,
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redeemedAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "overrideCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrialRedemption_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TrialRedemption_emailHmac_key" ON "TrialRedemption"("emailHmac");
CREATE INDEX "TrialRedemption_status_redeemedAt_idx" ON "TrialRedemption"("status", "redeemedAt");
CREATE INDEX "TrialRedemption_tenantReference_idx" ON "TrialRedemption"("tenantReference");

ALTER TABLE "Subscription"
    ADD COLUMN "pastDueAt" TIMESTAMP(3),
    ADD COLUMN "graceEndsAt" TIMESTAMP(3);

CREATE TABLE "UsageLedger" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT,
    "metric" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "idempotencyKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UsageLedger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UsageLedger_idempotencyKey_key" ON "UsageLedger"("idempotencyKey");
CREATE INDEX "UsageLedger_tenantId_metric_periodStart_idx" ON "UsageLedger"("tenantId", "metric", "periodStart");
CREATE INDEX "UsageLedger_periodEnd_idx" ON "UsageLedger"("periodEnd");
ALTER TABLE "UsageLedger" ADD CONSTRAINT "UsageLedger_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "BillingSelection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "billingPriceId" TEXT NOT NULL,
    "providerCustomerId" TEXT NOT NULL,
    "providerSetupIntentId" TEXT,
    "providerPaymentMethod" TEXT,
    "status" "BillingSelectionStatus" NOT NULL DEFAULT 'PENDING_SETUP',
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "activatedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BillingSelection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BillingSelection_tenantId_key" ON "BillingSelection"("tenantId");
CREATE INDEX "BillingSelection_status_scheduledFor_idx" ON "BillingSelection"("status", "scheduledFor");
CREATE INDEX "BillingSelection_providerCustomerId_idx" ON "BillingSelection"("providerCustomerId");
ALTER TABLE "BillingSelection" ADD CONSTRAINT "BillingSelection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillingSelection" ADD CONSTRAINT "BillingSelection_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BillingSelection" ADD CONSTRAINT "BillingSelection_billingPriceId_fkey" FOREIGN KEY ("billingPriceId") REFERENCES "BillingPrice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CommercialEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "userId" TEXT,
    "event" TEXT NOT NULL,
    "source" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommercialEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CommercialEvent_event_createdAt_idx" ON "CommercialEvent"("event", "createdAt");
CREATE INDEX "CommercialEvent_tenantId_createdAt_idx" ON "CommercialEvent"("tenantId", "createdAt");

INSERT INTO "Plan" ("id", "slug", "name", "description", "currency", "monthlyAmountCents", "limits", "features", "isActive", "createdAt", "updatedAt")
VALUES
    ('plan_esencial_mx', 'esencial', 'Esencial', 'CRM, agenda, portal y operación sin chatbot.', 'MXN', 30000, '{"chatbotMessagesPerMonth":0}', '{"chatbot":false}', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('plan_automatiza_mx', 'automatiza', 'Automatiza', 'Todo lo esencial y hasta 5,000 respuestas del chatbot al mes.', 'MXN', 50000, '{"chatbotMessagesPerMonth":5000}', '{"chatbot":true}', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('plan_pro_mx', 'pro', 'Pro', 'Chatbot sin límite visible, sujeto a uso razonable.', 'MXN', 80000, '{"chatbotMessagesPerMonth":null,"fairUse":true}', '{"chatbot":true}', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO UPDATE SET
    "name" = EXCLUDED."name",
    "description" = EXCLUDED."description",
    "currency" = EXCLUDED."currency",
    "monthlyAmountCents" = EXCLUDED."monthlyAmountCents",
    "limits" = EXCLUDED."limits",
    "features" = EXCLUDED."features",
    "isActive" = true,
    "updatedAt" = CURRENT_TIMESTAMP;
