-- Public signup remains an intent until the owner proves control of the email address.
CREATE TYPE "SignupIntentStatus" AS ENUM ('PENDING', 'VERIFIED', 'EXPIRED', 'CANCELLED');
CREATE TYPE "EmailDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SUPPRESSED');

ALTER TABLE "User" ADD COLUMN "securityVersion" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "SignupIntent" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "displayName" TEXT NOT NULL,
    "requestedSlug" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL DEFAULT 'America/Mexico_City',
    "passwordHash" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "SignupIntentStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "utm" JSONB NOT NULL DEFAULT '{}',
    "ipHash" TEXT,
    "fingerprintHash" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "userId" TEXT,
    "tenantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SignupIntent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LegalAcceptance" (
    "id" TEXT NOT NULL,
    "signupIntentId" TEXT,
    "userId" TEXT,
    "termsVersion" TEXT NOT NULL,
    "privacyVersion" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LegalAcceptance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmailDelivery" (
    "id" TEXT NOT NULL,
    "signupIntentId" TEXT,
    "userId" TEXT,
    "recipientEmail" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "EmailDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "externalId" TEXT,
    "errorCode" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmailDelivery_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SecurityRateLimit" (
    "keyHash" TEXT NOT NULL,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "windowEndsAt" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SecurityRateLimit_pkey" PRIMARY KEY ("keyHash")
);

CREATE UNIQUE INDEX "SignupIntent_tokenHash_key" ON "SignupIntent"("tokenHash");
CREATE UNIQUE INDEX "SignupIntent_idempotencyKey_key" ON "SignupIntent"("idempotencyKey");
CREATE UNIQUE INDEX "SignupIntent_userId_key" ON "SignupIntent"("userId");
CREATE UNIQUE INDEX "SignupIntent_tenantId_key" ON "SignupIntent"("tenantId");
CREATE INDEX "SignupIntent_email_status_createdAt_idx" ON "SignupIntent"("email", "status", "createdAt");
CREATE INDEX "SignupIntent_expiresAt_idx" ON "SignupIntent"("expiresAt");
CREATE INDEX "LegalAcceptance_signupIntentId_acceptedAt_idx" ON "LegalAcceptance"("signupIntentId", "acceptedAt");
CREATE INDEX "LegalAcceptance_userId_acceptedAt_idx" ON "LegalAcceptance"("userId", "acceptedAt");
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX "PasswordResetToken_userId_expiresAt_idx" ON "PasswordResetToken"("userId", "expiresAt");
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");
CREATE INDEX "EmailDelivery_signupIntentId_createdAt_idx" ON "EmailDelivery"("signupIntentId", "createdAt");
CREATE INDEX "EmailDelivery_userId_createdAt_idx" ON "EmailDelivery"("userId", "createdAt");
CREATE INDEX "EmailDelivery_status_createdAt_idx" ON "EmailDelivery"("status", "createdAt");
CREATE INDEX "SecurityRateLimit_windowEndsAt_idx" ON "SecurityRateLimit"("windowEndsAt");

ALTER TABLE "SignupIntent" ADD CONSTRAINT "SignupIntent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SignupIntent" ADD CONSTRAINT "SignupIntent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LegalAcceptance" ADD CONSTRAINT "LegalAcceptance_signupIntentId_fkey" FOREIGN KEY ("signupIntentId") REFERENCES "SignupIntent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LegalAcceptance" ADD CONSTRAINT "LegalAcceptance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_signupIntentId_fkey" FOREIGN KEY ("signupIntentId") REFERENCES "SignupIntent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
