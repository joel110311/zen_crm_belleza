ALTER TABLE "SystemSettings"
ADD COLUMN IF NOT EXISTS "botReplyDelayMinMs" INTEGER NOT NULL DEFAULT 4000,
ADD COLUMN IF NOT EXISTS "botReplyDelayMaxMs" INTEGER NOT NULL DEFAULT 8000;

UPDATE "SystemSettings"
SET
    "autoReplyDelayMs" = 4000,
    "botReplyDelayMinMs" = 4000,
    "botReplyDelayMaxMs" = CASE
        WHEN "autoReplyDelayMs" <= 8000 THEN 8000
        WHEN "autoReplyDelayMs" <= 12000 THEN 12000
        ELSE 16000
    END;
