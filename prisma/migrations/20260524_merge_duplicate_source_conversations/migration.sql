WITH latest_settings AS (
    SELECT
        NULLIF(TRIM("ycloudPhoneId"), '') AS ycloud_phone_id,
        COALESCE(NULLIF(TRIM("whatsappInstanceName"), ''), 'zen-crm') AS wuzapi_instance
    FROM "SystemSettings"
    ORDER BY "updatedAt" DESC
    LIMIT 1
)
UPDATE "Conversation" c
SET "source_id" = latest_settings.ycloud_phone_id
FROM latest_settings
WHERE c."source_type" = 'ycloud'
  AND c."source_id" IS NULL
  AND latest_settings.ycloud_phone_id IS NOT NULL;

WITH latest_settings AS (
    SELECT
        COALESCE(NULLIF(TRIM("whatsappInstanceName"), ''), 'zen-crm') AS wuzapi_instance
    FROM "SystemSettings"
    ORDER BY "updatedAt" DESC
    LIMIT 1
)
UPDATE "Conversation" c
SET "source_id" = latest_settings.wuzapi_instance
FROM latest_settings
WHERE c."source_type" = 'wuzapi'
  AND c."source_id" IS NULL
  AND latest_settings.wuzapi_instance IS NOT NULL;

-- Merge accidental duplicates created with the same contact/source/source_id.
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
            "source_type" AS source_type,
            COALESCE("source_id", '') AS source_id_key,
            "status" AS status,
            COUNT(*) AS total
        FROM "Conversation"
        GROUP BY "contactId", "source_type", COALESCE("source_id", ''), "status"
        HAVING COUNT(*) > 1
    LOOP
        SELECT c."id"
        INTO keep_conversation_id
        FROM "Conversation" c
        WHERE c."contactId" = group_record.contact_id
          AND c."source_type" = group_record.source_type
          AND COALESCE(c."source_id", '') = group_record.source_id_key
          AND c."status" = group_record.status
        ORDER BY c."updatedAt" DESC, c."createdAt" DESC
        LIMIT 1;

        FOR duplicate_record IN
            SELECT c."id"
            FROM "Conversation" c
            WHERE c."contactId" = group_record.contact_id
              AND c."source_type" = group_record.source_type
              AND COALESCE(c."source_id", '') = group_record.source_id_key
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
