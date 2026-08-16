CREATE TABLE "AppointmentSlotHold" (
    "id" TEXT NOT NULL,
    "ownerKey" TEXT NOT NULL,
    "calendarKey" TEXT NOT NULL,
    "slotStart" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppointmentSlotHold_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AppointmentSlotHold_calendarKey_slotStart_key"
ON "AppointmentSlotHold"("calendarKey", "slotStart");

CREATE INDEX "AppointmentSlotHold_ownerKey_idx"
ON "AppointmentSlotHold"("ownerKey");

CREATE INDEX "AppointmentSlotHold_expiresAt_idx"
ON "AppointmentSlotHold"("expiresAt");
