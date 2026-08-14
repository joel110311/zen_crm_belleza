ALTER TABLE "CashMovement" ADD COLUMN IF NOT EXISTS "recordedById" TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'CashMovement_recordedById_fkey'
    ) THEN
        ALTER TABLE "CashMovement"
        ADD CONSTRAINT "CashMovement_recordedById_fkey"
        FOREIGN KEY ("recordedById") REFERENCES "User"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "CashMovement_recordedById_idx" ON "CashMovement"("recordedById");
