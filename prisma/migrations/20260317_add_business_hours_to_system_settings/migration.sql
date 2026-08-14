ALTER TABLE "SystemSettings"
ADD COLUMN "businessHoursStart" TEXT NOT NULL DEFAULT '09:00',
ADD COLUMN "businessHoursEnd" TEXT NOT NULL DEFAULT '18:00',
ADD COLUMN "businessTimeZone" TEXT NOT NULL DEFAULT 'America/Mexico_City',
ADD COLUMN "appointmentDurationMinutes" INTEGER NOT NULL DEFAULT 30;
