-- Repair Wuzapi duplicates created by historical source_id drift.
-- Wuzapi only has one active linked-device channel in this CRM, so a contact
-- should not have multiple active Wuzapi conversations because one row has a
-- null source_id and another has the configured instance name.
DO $$
DECLARE
    group_record RECORD;
    duplicate_record RECORD;
    keep_conversation_id TEXT;
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
        ORDER BY c."updatedAt" DESC, c."createdAt" DESC
        LIMIT 1;

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
