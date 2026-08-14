ALTER TABLE "SystemSettings"
    ADD COLUMN IF NOT EXISTS "brandName" TEXT DEFAULT 'Zen CRM Oftalmo',
    ADD COLUMN IF NOT EXISTS "brandLogoUrl" TEXT,
    ADD COLUMN IF NOT EXISTS "brandFaviconUrl" TEXT;
