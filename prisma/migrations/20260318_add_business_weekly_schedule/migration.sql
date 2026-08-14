ALTER TABLE "SystemSettings"
ADD COLUMN IF NOT EXISTS "businessWeeklySchedule" JSONB;
