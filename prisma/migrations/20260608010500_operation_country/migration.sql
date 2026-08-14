ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "operationCountry" TEXT NOT NULL DEFAULT 'MX';
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "phoneDefaultCountry" TEXT NOT NULL DEFAULT 'MX';
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "paymentEnabledCurrencies" JSONB NOT NULL DEFAULT '["MXN"]'::jsonb;

UPDATE "SystemSettings"
SET
    "operationCountry" = COALESCE(NULLIF("operationCountry", ''), 'MX'),
    "phoneDefaultCountry" = COALESCE(NULLIF("phoneDefaultCountry", ''), 'MX'),
    "paymentDefaultCurrency" = COALESCE(NULLIF("paymentDefaultCurrency", ''), 'MXN'),
    "businessTimeZone" = COALESCE(NULLIF("businessTimeZone", ''), 'America/Mexico_City'),
    "paymentEnabledCurrencies" = CASE
        WHEN "paymentEnabledCurrencies" IS NULL THEN '["MXN"]'::jsonb
        ELSE "paymentEnabledCurrencies"
    END;
