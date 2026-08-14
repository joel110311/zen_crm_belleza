ALTER TABLE "SystemSettings"
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

ALTER TABLE "SystemSettings"
    DROP COLUMN IF EXISTS "ycloudApiKey",
    DROP COLUMN IF EXISTS "ycloudPhoneId";

ALTER TABLE "Message" DROP CONSTRAINT IF EXISTS "Message_source_type_check";
ALTER TABLE "Conversation" DROP CONSTRAINT IF EXISTS "Conversation_source_type_check";

UPDATE "Message" SET "source_type" = 'meta' WHERE "source_type" = 'ycloud';
UPDATE "Conversation" SET "source_type" = 'meta' WHERE "source_type" = 'ycloud';

ALTER TABLE "Message"
    ADD CONSTRAINT "Message_source_type_check" CHECK ("source_type" IN ('wuzapi', 'meta'));
ALTER TABLE "Conversation"
    ADD CONSTRAINT "Conversation_source_type_check" CHECK ("source_type" IN ('wuzapi', 'meta'));

ALTER TABLE "SystemSettings" RENAME COLUMN "appointmentReminderYcloudTemplate24h" TO "appointmentReminderMetaTemplate24h";
ALTER TABLE "SystemSettings" RENAME COLUMN "appointmentReminderYcloudTemplate4h" TO "appointmentReminderMetaTemplate4h";
ALTER TABLE "SystemSettings" RENAME COLUMN "appointmentReminderYcloudLanguage" TO "appointmentReminderMetaLanguage";
