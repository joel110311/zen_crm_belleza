ALTER TABLE "Contact"
    ADD COLUMN IF NOT EXISTS "bulkCampaignOptOutAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "bulkCampaignOptOutReason" TEXT;

ALTER TABLE "BulkCampaign"
    ADD COLUMN IF NOT EXISTS "followUpCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "BulkCampaignRecipient"
    ADD COLUMN IF NOT EXISTS "attemptNumber" INTEGER NOT NULL DEFAULT 0;

DROP INDEX IF EXISTS "BulkCampaignRecipient_campaignId_contactId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "BulkCampaignRecipient_campaignId_contactId_attemptNumber_key"
    ON "BulkCampaignRecipient"("campaignId", "contactId", "attemptNumber");
