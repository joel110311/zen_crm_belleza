ALTER TABLE "Message"
ADD COLUMN "botInputText" TEXT,
ADD COLUMN "botAttribution" JSONB,
ADD COLUMN "botBatchId" TEXT,
ADD COLUMN "botProcessedAt" TIMESTAMP(3);

CREATE INDEX "Message_conversationId_direction_botProcessedAt_createdAt_idx"
ON "Message"("conversationId", "direction", "botProcessedAt", "createdAt");

CREATE INDEX "Message_botBatchId_idx" ON "Message"("botBatchId");

ALTER TABLE "SystemSettings"
ADD COLUMN "messageBatchingEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "messageBatchWindowMs" INTEGER NOT NULL DEFAULT 8000,
ADD COLUMN "messageBatchMaxWaitMs" INTEGER NOT NULL DEFAULT 30000;
