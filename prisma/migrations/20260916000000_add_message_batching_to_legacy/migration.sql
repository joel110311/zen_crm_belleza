ALTER TABLE "Message"
ADD COLUMN IF NOT EXISTS "botInputText" TEXT,
ADD COLUMN IF NOT EXISTS "botAttribution" JSONB,
ADD COLUMN IF NOT EXISTS "botBatchId" TEXT,
ADD COLUMN IF NOT EXISTS "botProcessedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Message_conversationId_direction_botProcessedAt_createdAt_idx"
ON "Message"("conversationId", "direction", "botProcessedAt", "createdAt");

CREATE INDEX IF NOT EXISTS "Message_botBatchId_idx" ON "Message"("botBatchId");

ALTER TABLE "SystemSettings"
ADD COLUMN IF NOT EXISTS "messageBatchingEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "messageBatchWindowMs" INTEGER NOT NULL DEFAULT 8000,
ADD COLUMN IF NOT EXISTS "messageBatchMaxWaitMs" INTEGER NOT NULL DEFAULT 30000;
