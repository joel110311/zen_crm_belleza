export async function register() {
    if (process.env.NEXT_RUNTIME !== "nodejs") {
        return;
    }

    if (process.env.BULK_CAMPAIGN_WORKER_DISABLED !== "true") {
        const { startBulkCampaignWorker } = await import("@/lib/bulk-campaign-worker");
        startBulkCampaignWorker();
    }

    if (process.env.APPOINTMENT_REMINDER_WORKER_DISABLED !== "true") {
        const { startAppointmentReminderWorker } = await import("@/lib/appointment-reminder-worker");
        startAppointmentReminderWorker();
    }
}
