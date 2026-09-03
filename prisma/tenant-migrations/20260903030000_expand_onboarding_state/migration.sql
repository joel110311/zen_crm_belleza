ALTER TABLE "TenantOnboardingState"
    ADD COLUMN "version" INTEGER NOT NULL DEFAULT 2,
    ADD COLUMN "completedSteps" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "skippedSteps" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "channelPreference" TEXT,
    ADD COLUMN "publishedAt" TIMESTAMP(3);

ALTER TABLE "SystemSettings"
    ADD COLUMN "portalVisibleServiceIds" JSONB;
