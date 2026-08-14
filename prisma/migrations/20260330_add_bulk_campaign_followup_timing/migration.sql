ALTER TABLE "BulkCampaign"
    ADD COLUMN IF NOT EXISTS "followUpDelayDays" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "BulkCampaignRecipient"
    ADD COLUMN IF NOT EXISTS "plannedAt" TIMESTAMP(3);

UPDATE "BulkCampaignRecipient" AS recipient
SET "plannedAt" = COALESCE(
    campaign."scheduledStartAt",
    campaign."startedAt",
    recipient."sentAt",
    recipient."createdAt",
    CURRENT_TIMESTAMP
) + (((GREATEST(0, recipient."attemptNumber") * GREATEST(1, campaign."followUpDelayDays"))) || ' days')::interval
FROM "BulkCampaign" AS campaign
WHERE campaign."id" = recipient."campaignId"
  AND recipient."plannedAt" IS NULL;

ALTER TABLE "BulkCampaignRecipient"
    ALTER COLUMN "plannedAt" SET DEFAULT CURRENT_TIMESTAMP,
    ALTER COLUMN "plannedAt" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "BulkCampaignRecipient_campaignId_status_plannedAt_sequenceIndex_idx"
    ON "BulkCampaignRecipient"("campaignId", "status", "plannedAt", "sequenceIndex");
