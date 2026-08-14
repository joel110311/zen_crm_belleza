ALTER TABLE "BulkCampaign"
    ADD COLUMN IF NOT EXISTS "source_type" TEXT NOT NULL DEFAULT 'wuzapi',
    ADD COLUMN IF NOT EXISTS "source_id" TEXT;

CREATE INDEX IF NOT EXISTS "BulkCampaign_source_type_source_id_idx"
    ON "BulkCampaign"("source_type", "source_id");
