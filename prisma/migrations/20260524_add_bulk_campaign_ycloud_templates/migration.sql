ALTER TABLE "BulkCampaign"
    ADD COLUMN IF NOT EXISTS "ycloudTemplateName" TEXT,
    ADD COLUMN IF NOT EXISTS "ycloudTemplateLanguage" TEXT,
    ADD COLUMN IF NOT EXISTS "ycloudTemplateComponents" JSONB,
    ADD COLUMN IF NOT EXISTS "ycloudTemplateVariableValues" JSONB;
