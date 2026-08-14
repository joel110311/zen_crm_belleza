-- Merge duplicate active conversations created by concurrent webhooks, then
-- enforce one active conversation per contact and message source.
DO $$
DECLARE
    group_record RECORD;
    duplicate_record RECORD;
    keep_conversation_id TEXT;
    preferred_assignee_id TEXT;
    merged_bot_active BOOLEAN;
    keep_has_catalog_state BOOLEAN;
BEGIN
    FOR group_record IN
        SELECT
            "contactId" AS contact_id,
            "source_type" AS source_type,
            COALESCE("source_id", '') AS source_id_key,
            COUNT(*) AS total
        FROM "Conversation"
        WHERE "status" = 'active'
        GROUP BY "contactId", "source_type", COALESCE("source_id", '')
        HAVING COUNT(*) > 1
    LOOP
        SELECT c."id"
        INTO keep_conversation_id
        FROM "Conversation" c
        WHERE c."contactId" = group_record.contact_id
          AND c."status" = 'active'
          AND c."source_type" = group_record.source_type
          AND COALESCE(c."source_id", '') = group_record.source_id_key
        ORDER BY
            CASE WHEN c."assignedUserId" IS NOT NULL THEN 0 ELSE 1 END,
            CASE WHEN c."botActive" = false THEN 0 ELSE 1 END,
            c."updatedAt" DESC,
            c."createdAt" DESC
        LIMIT 1;

        SELECT c."assignedUserId"
        INTO preferred_assignee_id
        FROM "Conversation" c
        WHERE c."contactId" = group_record.contact_id
          AND c."status" = 'active'
          AND c."source_type" = group_record.source_type
          AND COALESCE(c."source_id", '') = group_record.source_id_key
          AND c."assignedUserId" IS NOT NULL
        ORDER BY c."updatedAt" DESC, c."createdAt" DESC
        LIMIT 1;

        SELECT BOOL_AND(c."botActive")
        INTO merged_bot_active
        FROM "Conversation" c
        WHERE c."contactId" = group_record.contact_id
          AND c."status" = 'active'
          AND c."source_type" = group_record.source_type
          AND COALESCE(c."source_id", '') = group_record.source_id_key;

        FOR duplicate_record IN
            SELECT c."id"
            FROM "Conversation" c
            WHERE c."contactId" = group_record.contact_id
              AND c."status" = 'active'
              AND c."source_type" = group_record.source_type
              AND COALESCE(c."source_id", '') = group_record.source_id_key
              AND c."id" <> keep_conversation_id
        LOOP
            UPDATE "Message"
            SET "conversationId" = keep_conversation_id
            WHERE "conversationId" = duplicate_record."id";

            UPDATE "BulkCampaignRecipient"
            SET "conversationId" = keep_conversation_id
            WHERE "conversationId" = duplicate_record."id";

            SELECT EXISTS (
                SELECT 1
                FROM "CatalogConversationState"
                WHERE "conversationId" = keep_conversation_id
            )
            INTO keep_has_catalog_state;

            IF keep_has_catalog_state THEN
                DELETE FROM "CatalogConversationState"
                WHERE "conversationId" = duplicate_record."id";
            ELSE
                UPDATE "CatalogConversationState"
                SET "conversationId" = keep_conversation_id
                WHERE "conversationId" = duplicate_record."id";
            END IF;

            DELETE FROM "Conversation"
            WHERE "id" = duplicate_record."id";
        END LOOP;

        UPDATE "Conversation" c
        SET
            "assignedUserId" = COALESCE(c."assignedUserId", preferred_assignee_id),
            "botActive" = COALESCE(merged_bot_active, c."botActive"),
            "updatedAt" = COALESCE((
                SELECT MAX("createdAt")
                FROM "Message"
                WHERE "conversationId" = keep_conversation_id
            ), c."updatedAt")
        WHERE c."id" = keep_conversation_id;
    END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "Conversation_active_source_unique"
ON "Conversation" ("contactId", "source_type", COALESCE("source_id", ''))
WHERE "status" = 'active';
