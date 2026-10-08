-- WuzAPI has one active direct conversation per contact, independent of its instance ID.
-- Preserve the original chat ID and all messages when repairing worker-created duplicates.
BEGIN;
LOCK TABLE "Conversation", "Message", "BulkCampaignRecipient", "CatalogConversationState"
    IN SHARE ROW EXCLUSIVE MODE;
DO $$
DECLARE
    contact_id TEXT;
    keep_id TEXT;
    assignee_id TEXT;
    catalog_state_id TEXT;
    bot_active BOOLEAN;
    muted BOOLEAN;
    favorite BOOLEAN;
    last_updated TIMESTAMP;
BEGIN
    FOR contact_id IN
        SELECT "contactId" FROM "Conversation"
        WHERE "status" = 'active' AND "source_type" = 'wuzapi'
        GROUP BY "contactId" HAVING COUNT(*) > 1
    LOOP
        SELECT "id" INTO keep_id FROM "Conversation"
        WHERE "contactId" = contact_id AND "status" = 'active' AND "source_type" = 'wuzapi'
        ORDER BY ("source_id" IS NULL) DESC, ("assignedUserId" IS NOT NULL) DESC, "createdAt" ASC, "id"
        LIMIT 1;

        SELECT "assignedUserId" INTO assignee_id FROM "Conversation"
        WHERE "contactId" = contact_id AND "status" = 'active' AND "source_type" = 'wuzapi'
            AND "assignedUserId" IS NOT NULL
        ORDER BY "updatedAt" DESC, "id" LIMIT 1;

        SELECT BOOL_AND("botActive"), BOOL_OR("isMuted"), BOOL_OR("isFavorite"), MAX("updatedAt")
        INTO bot_active, muted, favorite, last_updated FROM "Conversation"
        WHERE "contactId" = contact_id AND "status" = 'active' AND "source_type" = 'wuzapi';

        SELECT s."id" INTO catalog_state_id FROM "CatalogConversationState" s
        JOIN "Conversation" c ON c."id" = s."conversationId"
        WHERE c."contactId" = contact_id AND c."status" = 'active' AND c."source_type" = 'wuzapi'
        ORDER BY s."updatedAt" DESC, s."id" LIMIT 1;

        DELETE FROM "CatalogConversationState" s USING "Conversation" c
        WHERE c."id" = s."conversationId" AND c."contactId" = contact_id
            AND c."status" = 'active' AND c."source_type" = 'wuzapi'
            AND s."id" IS DISTINCT FROM catalog_state_id;
        UPDATE "CatalogConversationState" SET "conversationId" = keep_id WHERE "id" = catalog_state_id;

        UPDATE "Message" m SET "conversationId" = keep_id FROM "Conversation" c
        WHERE m."conversationId" = c."id" AND c."contactId" = contact_id
            AND c."status" = 'active' AND c."source_type" = 'wuzapi' AND c."id" <> keep_id;
        UPDATE "BulkCampaignRecipient" r SET "conversationId" = keep_id FROM "Conversation" c
        WHERE r."conversationId" = c."id" AND c."contactId" = contact_id
            AND c."status" = 'active' AND c."source_type" = 'wuzapi' AND c."id" <> keep_id;

        -- The faulty worker left the bot active even when the most recent send was human.
        bot_active := bot_active AND NOT COALESCE((
            SELECT COALESCE(m."senderType", 'human') <> 'bot' FROM "Message" m
            WHERE m."conversationId" = keep_id AND m."direction" = 'outbound'
                AND m."status" IN ('sending', 'sent', 'delivered', 'read')
            ORDER BY m."createdAt" DESC, m."id" DESC LIMIT 1
        ), false);

        DELETE FROM "Conversation" WHERE "contactId" = contact_id AND "status" = 'active'
            AND "source_type" = 'wuzapi' AND "id" <> keep_id;
        UPDATE "Conversation" SET
            "source_id" = NULL, "assignedUserId" = COALESCE("assignedUserId", assignee_id),
            "botActive" = bot_active, "isMuted" = muted, "isFavorite" = favorite,
            "updatedAt" = GREATEST(last_updated, (SELECT MAX("createdAt") FROM "Message" WHERE "conversationId" = keep_id))
        WHERE "id" = keep_id;
    END LOOP;
END $$;

UPDATE "Conversation" SET "source_id" = NULL WHERE "status" = 'active' AND "source_type" = 'wuzapi';
CREATE UNIQUE INDEX IF NOT EXISTS "Conversation_active_wuzapi_contact_unique"
    ON "Conversation" ("contactId") WHERE "status" = 'active' AND "source_type" = 'wuzapi';
COMMIT;
