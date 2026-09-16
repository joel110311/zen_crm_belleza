export async function register() {
    if (process.env.NEXT_RUNTIME !== "nodejs") {
        return;
    }

    if (process.env.BOT_REPLY_WORKER_DISABLED !== "true") {
        const { startBotReplyWorker } = await import("@/lib/bot-reply-queue");
        startBotReplyWorker();
    }

    // The multitenant deployment uses the dedicated tenant-worker service. A web process has
    // no single operational database, so starting legacy polling loops here would be both noisy
    // and unsafe: background work must always carry an explicit tenant identity.
    if (process.env.MULTITENANT_RUNTIME_ENABLED === "true") {
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
