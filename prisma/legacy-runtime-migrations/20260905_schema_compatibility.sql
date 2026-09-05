DO $$ BEGIN
    CREATE TYPE "PrivateFileStatus" AS ENUM ('PENDING_UPLOAD', 'READY', 'QUARANTINED', 'DELETED', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "PrivateFileAntivirusStatus" AS ENUM ('NOT_REQUESTED', 'PENDING', 'CLEAN', 'INFECTED', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "User" ALTER COLUMN "password" DROP NOT NULL;

ALTER TABLE "SystemSettings"
    ADD COLUMN IF NOT EXISTS "portalVisibleServiceIds" JSONB;

ALTER TABLE "Appointment"
    ADD COLUMN IF NOT EXISTS "bookingIdempotencyKeyHash" TEXT,
    ADD COLUMN IF NOT EXISTS "publicBookingTokenExpiresAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "publicBookingTokenHash" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Appointment_publicBookingTokenHash_key"
    ON "Appointment"("publicBookingTokenHash");
CREATE UNIQUE INDEX IF NOT EXISTS "Appointment_bookingIdempotencyKeyHash_key"
    ON "Appointment"("bookingIdempotencyKeyHash");
CREATE INDEX IF NOT EXISTS "Appointment_publicBookingTokenExpiresAt_idx"
    ON "Appointment"("publicBookingTokenExpiresAt");

CREATE TABLE IF NOT EXISTS "PrivateFile" (
    "id" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "requestKeyHash" TEXT NOT NULL,
    "status" "PrivateFileStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "antivirusStatus" "PrivateFileAntivirusStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
    "antivirusDetail" TEXT,
    "uploadedByUserId" TEXT,
    "uploadExpiresAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "publicAccessTokenHash" TEXT,
    "publicAccessExpiresAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PrivateFile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PrivateFile_storageKey_key" ON "PrivateFile"("storageKey");
CREATE UNIQUE INDEX IF NOT EXISTS "PrivateFile_requestKeyHash_key" ON "PrivateFile"("requestKeyHash");
CREATE UNIQUE INDEX IF NOT EXISTS "PrivateFile_publicAccessTokenHash_key" ON "PrivateFile"("publicAccessTokenHash");
CREATE INDEX IF NOT EXISTS "PrivateFile_resourceType_resourceId_status_idx" ON "PrivateFile"("resourceType", "resourceId", "status");
CREATE INDEX IF NOT EXISTS "PrivateFile_uploadExpiresAt_status_idx" ON "PrivateFile"("uploadExpiresAt", "status");
CREATE INDEX IF NOT EXISTS "PrivateFile_publicAccessExpiresAt_idx" ON "PrivateFile"("publicAccessExpiresAt");

CREATE TABLE IF NOT EXISTS "PublicAppointmentSlotHold" (
    "id" TEXT NOT NULL,
    "ownerKey" TEXT NOT NULL,
    "calendarKey" TEXT NOT NULL,
    "slotStart" TIMESTAMP(3) NOT NULL,
    "slotEnd" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PublicAppointmentSlotHold_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PublicAppointmentSlotHold_ownerKey_idx" ON "PublicAppointmentSlotHold"("ownerKey");
CREATE INDEX IF NOT EXISTS "PublicAppointmentSlotHold_expiresAt_idx" ON "PublicAppointmentSlotHold"("expiresAt");
CREATE INDEX IF NOT EXISTS "PublicAppointmentSlotHold_calendarKey_slotEnd_idx" ON "PublicAppointmentSlotHold"("calendarKey", "slotEnd");

CREATE TABLE IF NOT EXISTS "TenantOnboardingState" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "version" INTEGER NOT NULL DEFAULT 2,
    "currentStep" INTEGER NOT NULL DEFAULT 1,
    "initialServiceId" TEXT,
    "initialSpecialistId" TEXT,
    "completedSteps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "skippedSteps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "channelPreference" TEXT,
    "completedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TenantOnboardingState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ApiMutationReceipt" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "response" JSONB,
    "statusCode" INTEGER,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ApiMutationReceipt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ApiMutationReceipt_expiresAt_idx" ON "ApiMutationReceipt"("expiresAt");
CREATE UNIQUE INDEX IF NOT EXISTS "ApiMutationReceipt_scope_key_key" ON "ApiMutationReceipt"("scope", "key");
