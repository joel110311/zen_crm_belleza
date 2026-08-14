-- CreateTable
CREATE TABLE "AppointmentReminder" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "offsetMinutes" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'whatsapp',
    "provider" TEXT NOT NULL DEFAULT 'wuzapi',
    "messageKind" TEXT NOT NULL DEFAULT 'text',
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "messageId" TEXT,
    "providerMessageId" TEXT,
    "lockId" TEXT,
    "lockExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppointmentReminder_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "SystemSettings" ADD COLUMN "appointmentRemindersEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "SystemSettings" ADD COLUMN "appointmentReminderOffsets" JSONB NOT NULL DEFAULT '[1440,240]';
ALTER TABLE "SystemSettings" ADD COLUMN "appointmentReminderProvider" TEXT NOT NULL DEFAULT 'wuzapi';
ALTER TABLE "SystemSettings" ADD COLUMN "appointmentReminderSendOnlyConfirmed" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "SystemSettings" ADD COLUMN "appointmentReminderWuzapiTemplate" TEXT;
ALTER TABLE "SystemSettings" ADD COLUMN "appointmentReminderYcloudTemplate24h" TEXT;
ALTER TABLE "SystemSettings" ADD COLUMN "appointmentReminderYcloudTemplate4h" TEXT;
ALTER TABLE "SystemSettings" ADD COLUMN "appointmentReminderYcloudLanguage" TEXT DEFAULT 'es';

-- CreateIndex
CREATE UNIQUE INDEX "AppointmentReminder_appointmentId_offsetMinutes_channel_key" ON "AppointmentReminder"("appointmentId", "offsetMinutes", "channel");

-- CreateIndex
CREATE INDEX "AppointmentReminder_status_scheduledFor_idx" ON "AppointmentReminder"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "AppointmentReminder_appointmentId_idx" ON "AppointmentReminder"("appointmentId");

-- CreateIndex
CREATE INDEX "AppointmentReminder_provider_idx" ON "AppointmentReminder"("provider");

-- AddForeignKey
ALTER TABLE "AppointmentReminder" ADD CONSTRAINT "AppointmentReminder_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
