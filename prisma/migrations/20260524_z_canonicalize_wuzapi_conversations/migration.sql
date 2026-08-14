-- Wuzapi represents one linked-device inbox in this CRM. Keep one active
-- Wuzapi conversation per contact, regardless of historical source_id drift.
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
            "status" AS status,
            COUNT(*) AS total
        FROM "Conversation"
        WHERE "source_type" = 'wuzapi'
        GROUP BY "contactId", "status"
        HAVING COUNT(*) > 1
    LOOP
        SELECT c."id"
        INTO keep_conversation_id
        FROM "Conversation" c
        WHERE c."contactId" = group_record.contact_id
          AND c."source_type" = 'wuzapi'
          AND c."status" = group_record.status
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
          AND c."source_type" = 'wuzapi'
          AND c."status" = group_record.status
          AND c."assignedUserId" IS NOT NULL
        ORDER BY c."updatedAt" DESC, c."createdAt" DESC
        LIMIT 1;

        SELECT BOOL_AND(c."botActive")
        INTO merged_bot_active
        FROM "Conversation" c
        WHERE c."contactId" = group_record.contact_id
          AND c."source_type" = 'wuzapi'
          AND c."status" = group_record.status;

        FOR duplicate_record IN
            SELECT c."id"
            FROM "Conversation" c
            WHERE c."contactId" = group_record.contact_id
              AND c."source_type" = 'wuzapi'
              AND c."status" = group_record.status
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

        UPDATE "Conversation"
        SET
            "assignedUserId" = COALESCE("assignedUserId", preferred_assignee_id),
            "botActive" = COALESCE(merged_bot_active, "botActive"),
            "source_id" = NULL
        WHERE "id" = keep_conversation_id;
    END LOOP;
END $$;

UPDATE "Conversation"
SET "source_id" = NULL
WHERE "source_type" = 'wuzapi';

UPDATE "Message"
SET "source_id" = NULL
WHERE "source_type" = 'wuzapi';

UPDATE "Conversation" c
SET "updatedAt" = latest."maxCreatedAt"
FROM (
    SELECT "conversationId", MAX("createdAt") AS "maxCreatedAt"
    FROM "Message"
    GROUP BY "conversationId"
) latest
WHERE c."id" = latest."conversationId";
