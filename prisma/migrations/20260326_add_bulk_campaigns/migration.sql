CREATE TABLE IF NOT EXISTS "BulkCampaign" (
    "id" TEXT PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "audienceFilters" JSONB,
    "type" TEXT NOT NULL DEFAULT 'text',
    "mediaUrl" TEXT,
    "mediaType" TEXT,
    "mediaFileName" TEXT,
    "batchSize" INTEGER NOT NULL DEFAULT 3,
    "batchDelayMinutes" INTEGER NOT NULL DEFAULT 5,
    "respectBusinessHours" BOOLEAN NOT NULL DEFAULT true,
    "stopOnReply" BOOLEAN NOT NULL DEFAULT true,
    "senderStrategy" TEXT NOT NULL DEFAULT 'primary',
    "totalRecipients" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "repliedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastProcessedAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "workerLockId" TEXT,
    "workerLockExpiresAt" TIMESTAMP(3),
    "createdById" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "BulkCampaignVariant" (
    "id" TEXT PRIMARY KEY,
    "campaignId" TEXT NOT NULL REFERENCES "BulkCampaign"("id") ON DELETE CASCADE,
    "label" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "variables" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "BulkCampaignRecipient" (
    "id" TEXT PRIMARY KEY,
    "campaignId" TEXT NOT NULL REFERENCES "BulkCampaign"("id") ON DELETE CASCADE,
    "contactId" TEXT NOT NULL REFERENCES "Contact"("id") ON DELETE CASCADE,
    "conversationId" TEXT REFERENCES "Conversation"("id") ON DELETE SET NULL,
    "variantId" TEXT REFERENCES "BulkCampaignVariant"("id") ON DELETE SET NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "sequenceIndex" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3),
    "repliedAt" TIMESTAMP(3),
    "lastInboundAt" TIMESTAMP(3),
    "lastError" TEXT,
    "renderedContent" TEXT,
    "providerMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "BulkCampaign_status_nextRunAt_idx"
    ON "BulkCampaign"("status", "nextRunAt");

CREATE INDEX IF NOT EXISTS "BulkCampaign_createdAt_idx"
    ON "BulkCampaign"("createdAt" DESC);

CREATE INDEX IF NOT EXISTS "BulkCampaignVariant_campaignId_sortOrder_idx"
    ON "BulkCampaignVariant"("campaignId", "sortOrder");

CREATE UNIQUE INDEX IF NOT EXISTS "BulkCampaignRecipient_campaignId_contactId_key"
    ON "BulkCampaignRecipient"("campaignId", "contactId");

CREATE INDEX IF NOT EXISTS "BulkCampaignRecipient_campaignId_status_sequenceIndex_idx"
    ON "BulkCampaignRecipient"("campaignId", "status", "sequenceIndex");

CREATE INDEX IF NOT EXISTS "BulkCampaignRecipient_contactId_status_idx"
    ON "BulkCampaignRecipient"("contactId", "status");
