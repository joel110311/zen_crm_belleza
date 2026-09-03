CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "AppointmentSlotHold"
    ADD COLUMN "slotEnd" TIMESTAMP(3);

UPDATE "AppointmentSlotHold"
SET "slotEnd" = "slotStart" + INTERVAL '30 minutes'
WHERE "slotEnd" IS NULL;

ALTER TABLE "AppointmentSlotHold"
    ALTER COLUMN "slotEnd" SET NOT NULL;

CREATE INDEX "AppointmentSlotHold_calendarKey_slotEnd_idx"
ON "AppointmentSlotHold"("calendarKey", "slotEnd");

ALTER TABLE "AppointmentSlotHold"
    ADD CONSTRAINT "AppointmentSlotHold_calendar_interval_excl"
    EXCLUDE USING gist (
        "calendarKey" WITH =,
        tsrange("slotStart", "slotEnd", '[)') WITH &&
    );
