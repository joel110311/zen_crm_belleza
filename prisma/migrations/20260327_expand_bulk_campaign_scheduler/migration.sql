ALTER TABLE "BulkCampaign"
    ADD COLUMN IF NOT EXISTS "randomDelayMinSeconds" INTEGER NOT NULL DEFAULT 25,
    ADD COLUMN IF NOT EXISTS "randomDelayMaxSeconds" INTEGER NOT NULL DEFAULT 75,
    ADD COLUMN IF NOT EXISTS "scheduledStartAt" TIMESTAMP(3);

UPDATE "BulkCampaign"
SET "randomDelayMinSeconds" = LEAST("randomDelayMinSeconds", "randomDelayMaxSeconds"),
    "randomDelayMaxSeconds" = GREATEST("randomDelayMinSeconds", "randomDelayMaxSeconds");
