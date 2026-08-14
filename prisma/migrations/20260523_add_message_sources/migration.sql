ALTER TABLE "Message"
    ADD COLUMN IF NOT EXISTS "source_type" TEXT NOT NULL DEFAULT 'wuzapi';

ALTER TABLE "Message"
    ADD COLUMN IF NOT EXISTS "source_id" TEXT;

ALTER TABLE "Message"
    DROP CONSTRAINT IF EXISTS "Message_source_type_check";

ALTER TABLE "Message"
    ADD CONSTRAINT "Message_source_type_check"
    CHECK ("source_type" IN ('wuzapi', 'ycloud'));

CREATE INDEX IF NOT EXISTS "Message_source_type_source_id_idx"
    ON "Message"("source_type", "source_id");

CREATE INDEX IF NOT EXISTS "Message_source_type_providerMessageId_idx"
    ON "Message"("source_type", "providerMessageId");
