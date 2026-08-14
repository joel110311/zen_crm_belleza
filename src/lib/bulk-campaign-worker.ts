import { processDueBulkCampaigns } from "@/lib/bulk-campaigns";

const DEFAULT_WORKER_INTERVAL_MS = 5_000;

const globalForBulkCampaignWorker = globalThis as typeof globalThis & {
    __bulkCampaignWorkerStarted?: boolean;
    __bulkCampaignWorkerTimer?: ReturnType<typeof setTimeout> | null;
};

function getWorkerIntervalMs() {
    const raw = Number.parseInt(process.env.BULK_CAMPAIGN_WORKER_INTERVAL_MS || "", 10);
    if (!Number.isFinite(raw) || raw < 5_000) {
        return DEFAULT_WORKER_INTERVAL_MS;
    }
    return raw;
}

export function startBulkCampaignWorker() {
    if (globalForBulkCampaignWorker.__bulkCampaignWorkerStarted) {
        return;
    }

    globalForBulkCampaignWorker.__bulkCampaignWorkerStarted = true;

    const tick = async () => {
        try {
            await processDueBulkCampaigns();
        } catch (error) {
            console.error("[BulkCampaignWorker] Tick failed", error);
        } finally {
            globalForBulkCampaignWorker.__bulkCampaignWorkerTimer = setTimeout(() => {
                void tick();
            }, getWorkerIntervalMs());
            globalForBulkCampaignWorker.__bulkCampaignWorkerTimer.unref?.();
        }
    };

    console.log("[BulkCampaignWorker] Started");
    void tick();
}
