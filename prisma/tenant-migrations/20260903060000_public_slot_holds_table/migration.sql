-- Keep the existing internal scheduler schema compatible with legacy deployments. The temporary
-- interval column from the previous tenant-only migration is deliberately nullable and unused.
ALTER TABLE "AppointmentSlotHold"
    DROP CONSTRAINT IF EXISTS "AppointmentSlotHold_calendar_interval_excl";

ALTER TABLE "AppointmentSlotHold"
    ALTER COLUMN "slotEnd" DROP NOT NULL;

CREATE TABLE "PublicAppointmentSlotHold" (
    "id" TEXT NOT NULL,
    "ownerKey" TEXT NOT NULL,
    "calendarKey" TEXT NOT NULL,
    "slotStart" TIMESTAMP(3) NOT NULL,
    "slotEnd" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PublicAppointmentSlotHold_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PublicAppointmentSlotHold_ownerKey_idx" ON "PublicAppointmentSlotHold"("ownerKey");
CREATE INDEX "PublicAppointmentSlotHold_expiresAt_idx" ON "PublicAppointmentSlotHold"("expiresAt");
CREATE INDEX "PublicAppointmentSlotHold_calendarKey_slotEnd_idx" ON "PublicAppointmentSlotHold"("calendarKey", "slotEnd");

ALTER TABLE "PublicAppointmentSlotHold"
    ADD CONSTRAINT "PublicAppointmentSlotHold_calendar_interval_excl"
    EXCLUDE USING gist (
        "calendarKey" WITH =,
        tsrange("slotStart", "slotEnd", '[)') WITH &&
    );
