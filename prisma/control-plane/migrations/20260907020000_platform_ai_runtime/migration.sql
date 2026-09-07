CREATE TABLE "PlatformRuntimeSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformRuntimeSetting_pkey" PRIMARY KEY ("key")
);

INSERT INTO "PlatformRuntimeSetting" ("key", "value", "updatedAt")
VALUES ('ai.runtime', '{"chatModel":"gemini:gemini-2.5-flash"}'::jsonb, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
