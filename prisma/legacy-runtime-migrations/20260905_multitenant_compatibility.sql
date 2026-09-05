ALTER TABLE "User"
    ADD COLUMN IF NOT EXISTS "controlUserId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "User_controlUserId_key"
    ON "User"("controlUserId");

ALTER TABLE "SystemSettings"
    ADD COLUMN IF NOT EXISTS "businessPolicies" JSONB,
    ADD COLUMN IF NOT EXISTS "portalSocialLinks" JSONB,
    ADD COLUMN IF NOT EXISTS "whatsappWabaId" TEXT,
    ADD COLUMN IF NOT EXISTS "whatsappPhoneNumberId" TEXT,
    ADD COLUMN IF NOT EXISTS "whatsappDisplayPhoneNumber" TEXT,
    ADD COLUMN IF NOT EXISTS "whatsappAccessToken" TEXT,
    ADD COLUMN IF NOT EXISTS "whatsappBusinessId" TEXT,
    ADD COLUMN IF NOT EXISTS "whatsappConnectedAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "whatsappMetaAppId" TEXT,
    ADD COLUMN IF NOT EXISTS "whatsappMetaAppSecret" TEXT,
    ADD COLUMN IF NOT EXISTS "whatsappEmbeddedSignupConfigId" TEXT,
    ADD COLUMN IF NOT EXISTS "whatsappTechProviderSolutionId" TEXT,
    ADD COLUMN IF NOT EXISTS "whatsappGraphApiVersion" TEXT DEFAULT 'v26.0',
    ADD COLUMN IF NOT EXISTS "whatsappRegistrationPin" TEXT,
    ADD COLUMN IF NOT EXISTS "whatsappWebhookVerifyToken" TEXT,
    ADD COLUMN IF NOT EXISTS "whatsappWebhookBaseUrl" TEXT;

ALTER TABLE "Service"
    ADD COLUMN IF NOT EXISTS "preparationRequirements" JSONB;

CREATE TABLE IF NOT EXISTS "AppointmentSlotHold" (
    "id" TEXT NOT NULL,
    "ownerKey" TEXT NOT NULL,
    "calendarKey" TEXT NOT NULL,
    "slotStart" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AppointmentSlotHold_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AppointmentSlotHold_calendarKey_slotStart_key"
    ON "AppointmentSlotHold"("calendarKey", "slotStart");

CREATE INDEX IF NOT EXISTS "AppointmentSlotHold_ownerKey_idx"
    ON "AppointmentSlotHold"("ownerKey");

CREATE INDEX IF NOT EXISTS "AppointmentSlotHold_expiresAt_idx"
    ON "AppointmentSlotHold"("expiresAt");
