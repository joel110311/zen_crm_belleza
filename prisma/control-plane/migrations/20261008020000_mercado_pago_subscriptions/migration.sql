CREATE TABLE "MercadoPagoAgreement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "planId" TEXT NOT NULL REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "activeKey" TEXT UNIQUE,
    "externalReference" TEXT NOT NULL UNIQUE,
    "providerSubscriptionId" TEXT UNIQUE,
    "environment" TEXT NOT NULL CHECK ("environment" IN ('test', 'production')),
    "applicationId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL CHECK ("amountCents" > 0),
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATING',
    "checkoutUrl" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "nextPaymentAt" TIMESTAMP(3),
    "consentAt" TIMESTAMP(3) NOT NULL,
    "consentUserId" TEXT NOT NULL,
    "consentVersion" TEXT NOT NULL,
    "cancelRequestedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "providerModifiedAt" TIMESTAMP(3),
    "reconciledAt" TIMESTAMP(3),
    "reconciliationOffset" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "MercadoPagoAgreement_status_reconciledAt_idx" ON "MercadoPagoAgreement"("status", "reconciledAt");
CREATE INDEX "MercadoPagoAgreement_tenantId_createdAt_idx" ON "MercadoPagoAgreement"("tenantId", "createdAt");
ALTER TABLE "BillingCheckoutAttempt" ADD COLUMN "recurringAgreementId" TEXT REFERENCES "MercadoPagoAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BillingCheckoutAttempt" ADD COLUMN "providerInvoiceId" TEXT UNIQUE;
