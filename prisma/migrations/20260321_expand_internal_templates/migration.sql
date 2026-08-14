ALTER TABLE "Template" ADD COLUMN IF NOT EXISTS "type" TEXT DEFAULT 'text';
ALTER TABLE "Template" ADD COLUMN IF NOT EXISTS "mediaUrl" TEXT;
ALTER TABLE "Template" ADD COLUMN IF NOT EXISTS "mediaType" TEXT;
ALTER TABLE "Template" ADD COLUMN IF NOT EXISTS "mediaFileName" TEXT;
ALTER TABLE "Template" ADD COLUMN IF NOT EXISTS "shortcut" TEXT;
ALTER TABLE "Template" ADD COLUMN IF NOT EXISTS "variables" JSONB;
ALTER TABLE "Template" ADD COLUMN IF NOT EXISTS "isFavorite" BOOLEAN DEFAULT false;
ALTER TABLE "Template" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN DEFAULT true;
ALTER TABLE "Template" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER DEFAULT 0;
ALTER TABLE "Template" ADD COLUMN IF NOT EXISTS "usageCount" INTEGER DEFAULT 0;
ALTER TABLE "Template" ADD COLUMN IF NOT EXISTS "lastUsedAt" TIMESTAMP(3);

UPDATE "Template" SET "type" = 'text' WHERE "type" IS NULL;
UPDATE "Template" SET "isFavorite" = false WHERE "isFavorite" IS NULL;
UPDATE "Template" SET "isActive" = true WHERE "isActive" IS NULL;
UPDATE "Template" SET "sortOrder" = 0 WHERE "sortOrder" IS NULL;
UPDATE "Template" SET "usageCount" = 0 WHERE "usageCount" IS NULL;

ALTER TABLE "Template" ALTER COLUMN "type" SET NOT NULL;
ALTER TABLE "Template" ALTER COLUMN "type" SET DEFAULT 'text';
ALTER TABLE "Template" ALTER COLUMN "isFavorite" SET NOT NULL;
ALTER TABLE "Template" ALTER COLUMN "isFavorite" SET DEFAULT false;
ALTER TABLE "Template" ALTER COLUMN "isActive" SET NOT NULL;
ALTER TABLE "Template" ALTER COLUMN "isActive" SET DEFAULT true;
ALTER TABLE "Template" ALTER COLUMN "sortOrder" SET NOT NULL;
ALTER TABLE "Template" ALTER COLUMN "sortOrder" SET DEFAULT 0;
ALTER TABLE "Template" ALTER COLUMN "usageCount" SET NOT NULL;
ALTER TABLE "Template" ALTER COLUMN "usageCount" SET DEFAULT 0;

CREATE INDEX IF NOT EXISTS "Template_isActive_category_idx" ON "Template"("isActive", "category");
CREATE INDEX IF NOT EXISTS "Template_isFavorite_updatedAt_idx" ON "Template"("isFavorite", "updatedAt" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS "Template_shortcut_key" ON "Template"("shortcut") WHERE "shortcut" IS NOT NULL;
