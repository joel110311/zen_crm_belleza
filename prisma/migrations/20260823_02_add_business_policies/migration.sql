ALTER TABLE "SystemSettings"
ADD COLUMN IF NOT EXISTS "businessPolicies" JSONB;
