ALTER TABLE "Conversation"
    ADD COLUMN IF NOT EXISTS "source_type" TEXT NOT NULL DEFAULT 'wuzapi';

ALTER TABLE "Conversation"
    ADD COLUMN IF NOT EXISTS "source_id" TEXT;

ALTER TABLE "Conversation"
    DROP CONSTRAINT IF EXISTS "Conversation_source_type_check";

ALTER TABLE "Conversation"
    ADD CONSTRAINT "Conversation_source_type_check"
    CHECK ("source_type" IN ('wuzapi', 'ycloud'));

-- If a conversation only contains messages from one source, inherit that source.
WITH single_source AS (
    SELECT
        "conversationId",
        MIN("source_type") AS "source_type",
        MIN("source_id") AS "source_id"
    FROM "Message"
    WHERE "type" <> 'system'
    GROUP BY "conversationId"
    HAVING COUNT(DISTINCT "source_type") = 1
)
UPDATE "Conversation" c
SET
    "source_type" = s."source_type",
    "source_id" = s."source_id"
FROM single_source s
WHERE c."id" = s."conversationId";

-- Split already-mixed histories so one contact can keep one conversation per source.
DO $$
DECLARE
    row_record RECORD;
    new_conversation_id TEXT;
BEGIN
    FOR row_record IN
        SELECT
            c."id" AS old_conversation_id,
            c."contactId" AS contact_id,
            COALESCE(m."source_id", '') AS source_id_key,
            MIN(m."source_id") AS source_id,
            c."assignedUserId" AS assigned_user_id,
            c."status",
            c."isMuted" AS is_muted,
            c."isFavorite" AS is_favorite,
            c."isGroup" AS is_group,
            c."botActive" AS bot_active,
            c."createdAt" AS conversation_created_at,
            c."sessionExpiresAt" AS session_expires_at,
            MIN(m."createdAt") AS first_message_at,
            MAX(m."createdAt") AS last_message_at
        FROM "Conversation" c
        JOIN "Message" m ON m."conversationId" = c."id"
        WHERE m."source_type" = 'ycloud'
          AND EXISTS (
              SELECT 1
              FROM "Message" other_message
              WHERE other_message."conversationId" = c."id"
                AND other_message."source_type" <> 'ycloud'
          )
        GROUP BY
            c."id",
            c."contactId",
            COALESCE(m."source_id", ''),
            c."assignedUserId",
            c."status",
            c."isMuted",
            c."isFavorite",
            c."isGroup",
            c."botActive",
            c."createdAt",
            c."sessionExpiresAt"
    LOOP
        SELECT existing."id"
        INTO new_conversation_id
        FROM "Conversation" existing
        WHERE existing."contactId" = row_record.contact_id
          AND existing."source_type" = 'ycloud'
          AND COALESCE(existing."source_id", '') = row_record.source_id_key
          AND existing."id" <> row_record.old_conversation_id
        ORDER BY existing."updatedAt" DESC
        LIMIT 1;

        IF new_conversation_id IS NULL THEN
            new_conversation_id := concat('cm', substr(md5(random()::text || clock_timestamp()::text), 1, 23));

            INSERT INTO "Conversation" (
                "id",
                "contactId",
                "assignedUserId",
                "status",
                "source_type",
                "source_id",
                "isMuted",
                "isFavorite",
                "isGroup",
                "botActive",
                "createdAt",
                "updatedAt",
                "sessionExpiresAt"
            )
            VALUES (
                new_conversation_id,
                row_record.contact_id,
                row_record.assigned_user_id,
                row_record.status,
                'ycloud',
                NULLIF(row_record.source_id_key, ''),
                row_record.is_muted,
                row_record.is_favorite,
                row_record.is_group,
                row_record.bot_active,
                COALESCE(row_record.first_message_at, row_record.conversation_created_at),
                COALESCE(row_record.last_message_at, now()),
                row_record.session_expires_at
            );
        END IF;

        UPDATE "Message"
        SET "conversationId" = new_conversation_id
        WHERE "conversationId" = row_record.old_conversation_id
          AND "source_type" = 'ycloud'
          AND COALESCE("source_id", '') = row_record.source_id_key;
    END LOOP;
END $$;

UPDATE "Conversation" c
SET "updatedAt" = latest."maxCreatedAt"
FROM (
    SELECT "conversationId", MAX("createdAt") AS "maxCreatedAt"
    FROM "Message"
    GROUP BY "conversationId"
) latest
WHERE c."id" = latest."conversationId";

CREATE INDEX IF NOT EXISTS "Conversation_contactId_source_type_source_id_status_idx"
    ON "Conversation"("contactId", "source_type", "source_id", "status");

CREATE INDEX IF NOT EXISTS "Conversation_source_type_source_id_idx"
    ON "Conversation"("source_type", "source_id");
