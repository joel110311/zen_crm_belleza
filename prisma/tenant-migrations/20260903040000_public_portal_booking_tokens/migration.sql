ALTER TABLE "Appointment"
    ADD COLUMN "publicBookingTokenHash" TEXT,
    ADD COLUMN "publicBookingTokenExpiresAt" TIMESTAMP(3),
    ADD COLUMN "bookingIdempotencyKeyHash" TEXT;

CREATE UNIQUE INDEX "Appointment_publicBookingTokenHash_key" ON "Appointment"("publicBookingTokenHash");
CREATE UNIQUE INDEX "Appointment_bookingIdempotencyKeyHash_key" ON "Appointment"("bookingIdempotencyKeyHash");
CREATE INDEX "Appointment_publicBookingTokenExpiresAt_idx" ON "Appointment"("publicBookingTokenExpiresAt");
