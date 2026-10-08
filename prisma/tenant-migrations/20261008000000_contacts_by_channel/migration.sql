-- Keep existing IDs and business relations; split only channel conversations.
ALTER TABLE "Contact" ADD COLUMN "source_type" TEXT NOT NULL DEFAULT 'wuzapi';
DROP INDEX IF EXISTS "Contact_phone_key";
CREATE UNIQUE INDEX "Contact_phone_source_type_key" ON "Contact"("phone", "source_type");

-- API-only contacts retain their IDs and all existing relations.
UPDATE "Contact" c SET "source_type" = 'meta'
WHERE EXISTS (SELECT 1 FROM "Conversation" v WHERE v."contactId"=c."id" AND v."source_type"='meta')
AND NOT EXISTS (SELECT 1 FROM "Conversation" v WHERE v."contactId"=c."id" AND v."source_type"<>'meta');

-- For shared contacts, copy the profile, not appointments, patients or payments.
INSERT INTO "Contact" ("id","phone","source_type","name","lastName","email","company","role","tags","status","bulkCampaignOptOutAt","bulkCampaignOptOutReason","createdAt","updatedAt")
SELECT 'meta-' || md5(c."id"), c."phone", 'meta', c."name",c."lastName",c."email",c."company",c."role",c."tags",c."status",c."bulkCampaignOptOutAt",c."bulkCampaignOptOutReason",c."createdAt",c."updatedAt"
FROM "Contact" c WHERE c."source_type"='wuzapi'
AND EXISTS (SELECT 1 FROM "Conversation" v WHERE v."contactId"=c."id" AND v."source_type"='meta');

UPDATE "Conversation" v SET "contactId"=api."id"
FROM "Contact" qr, "Contact" api
WHERE v."contactId"=qr."id" AND v."source_type"='meta'
AND qr."source_type"='wuzapi' AND api."source_type"='meta' AND api."phone"=qr."phone";

UPDATE "BulkCampaignRecipient" r SET "contactId"=v."contactId"
FROM "Conversation" v WHERE r."conversationId"=v."id" AND r."contactId"<>v."contactId";
