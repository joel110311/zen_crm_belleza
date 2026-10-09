ALTER TABLE "MercadoPagoAgreement" ADD COLUMN "initialAmountCents" INTEGER, ADD COLUMN "initialPlanId" TEXT;
UPDATE "MercadoPagoAgreement" SET "initialAmountCents"="amountCents", "initialPlanId"="planId";
CREATE TABLE "MercadoPagoPlanChange" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "agreementId" TEXT NOT NULL REFERENCES "MercadoPagoAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "activeKey" TEXT UNIQUE,
  "sourcePlanId" TEXT NOT NULL REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "targetPlanId" TEXT NOT NULL REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "fromAmountCents" INTEGER NOT NULL CHECK ("fromAmountCents">0),
  "toAmountCents" INTEGER NOT NULL CHECK ("toAmountCents">0),
  "amountTodayCents" INTEGER NOT NULL CHECK ("amountTodayCents">=0),
  "currency" TEXT NOT NULL,
  "direction" TEXT NOT NULL CHECK ("direction" IN ('UPGRADE','DOWNGRADE')),
  "periodStartsAt" TIMESTAMP(3) NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "quotedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "externalReference" TEXT NOT NULL UNIQUE,
  "status" TEXT NOT NULL DEFAULT 'QUOTED',
  "consentUserId" TEXT,
  "consentAt" TIMESTAMP(3),
  "consentVersion" TEXT,
  "checkoutUrl" TEXT,
  "processingAt" TIMESTAMP(3),
  "providerAppliedAt" TIMESTAMP(3),
  "appliedAt" TIMESTAMP(3),
  "refundedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "MercadoPagoPlanChange_agreementId_effectiveAt_createdAt_idx" ON "MercadoPagoPlanChange"("agreementId","effectiveAt","createdAt");
ALTER TABLE "BillingCheckoutAttempt" ADD COLUMN "planChangeId" TEXT UNIQUE REFERENCES "MercadoPagoPlanChange"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
