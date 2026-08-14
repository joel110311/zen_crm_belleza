ALTER TABLE "Appointment"
ADD COLUMN "googleEventId" TEXT,
ADD COLUMN "googleEventUpdatedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Appointment_googleEventId_key" ON "Appointment"("googleEventId");

ALTER TABLE "SystemSettings"
ADD COLUMN "googleClientId" TEXT,
ADD COLUMN "googleClientSecret" TEXT,
ADD COLUMN "googleCalendarId" TEXT DEFAULT 'primary',
ADD COLUMN "googleAccessToken" TEXT,
ADD COLUMN "googleRefreshToken" TEXT,
ADD COLUMN "googleTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN "googleConnectedEmail" TEXT,
ADD COLUMN "googleSyncToken" TEXT,
ADD COLUMN "googleLastSyncedAt" TIMESTAMP(3);
