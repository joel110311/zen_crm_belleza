import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";

const BOT_REPLY_QUEUE_NAME = "zen-crm-bot-replies";
const BOT_REPLY_LOCK_TTL_MS = 120000;
const BOT_REPLY_LOCK_REFRESH_MS = 30000;
const BOT_REPLY_RECOVERY_INTERVAL_MS = 30000;

type BotReplyJob = {
    tenantId: string;
    conversationId: string;
};

type BotReplyQueueGlobals = {
    queue?: Queue<BotReplyJob>;
    queueConnection?: IORedis;
    worker?: Worker<BotReplyJob>;
    workerConnection?: IORedis;
    warnedMissingRedis?: boolean;
    localBatches?: Map<string, ReturnType<typeof setTimeout>>;
    localProcessing?: Set<string>;
    recoveryTimer?: ReturnType<typeof setInterval>;
    recoveryRunning?: boolean;
};

const globalForBotReplies = globalThis as typeof globalThis & {
    __zenBotReplyQueue?: BotReplyQueueGlobals;
};

function globals() {
    globalForBotReplies.__zenBotReplyQueue ??= {};
    return globalForBotReplies.__zenBotReplyQueue;
}

function getRedisUrl() {
    return process.env.REDIS_URL?.trim() || "";
}

function createRedisConnection(forWorker = false) {
    return new IORedis(getRedisUrl(), {
        maxRetriesPerRequest: forWorker ? null : 1,
        enableReadyCheck: false,
        enableOfflineQueue: forWorker,
        connectTimeout: 2000,
    });
}

function batchKey(tenantId: string, conversationId: string) {
    return `${tenantId}:${conversationId}`;
}

async function processTenantBatch(tenantId: string, conversationId: string, queueJobId: string) {
    if (tenantId === "legacy") {
        const { processQueuedInboundBatch } = await import("@/app/actions/chat");
        await processQueuedInboundBatch(conversationId, queueJobId, tenantId);
        return;
    }
    const { getTenantPrismaManager } = await import("@/lib/tenant-prisma-manager");
    const { runWithTenantPrisma } = await import("@/lib/routed-prisma");
    const { processQueuedInboundBatch } = await import("@/app/actions/chat");
    const tenantDb = await getTenantPrismaManager().getForTenant(tenantId);
    await runWithTenantPrisma(
        tenantDb,
        () => processQueuedInboundBatch(conversationId, queueJobId, tenantId),
        tenantId,
    );
}

function scheduleLocalBatch(tenantId: string, conversationId: string, delay: number) {
    const state = globals();
    const key = batchKey(tenantId, conversationId);
    state.localBatches ??= new Map();
    const currentTimer = state.localBatches.get(key);
    if (currentTimer) clearTimeout(currentTimer);
    const timer = setTimeout(async () => {
        state.localBatches?.delete(key);
        state.localProcessing ??= new Set();
        if (state.localProcessing.has(key)) {
            scheduleLocalBatch(tenantId, conversationId, 1000);
            return;
        }
        state.localProcessing.add(key);
        try {
            await processTenantBatch(tenantId, conversationId, `local-${Date.now()}`);
        } catch (error) {
            console.error("[Bot Batch] Local fallback failed:", error);
        } finally {
            state.localProcessing.delete(key);
        }
    }, delay);
    state.localBatches.set(key, timer);
}

function getQueue() {
    const state = globals();
    if (!state.queue) {
        state.queueConnection = createRedisConnection();
        state.queue = new Queue<BotReplyJob>(BOT_REPLY_QUEUE_NAME, {
            connection: state.queueConnection,
            defaultJobOptions: {
                attempts: 8,
                backoff: { type: "exponential", delay: 1000 },
                removeOnComplete: 500,
                removeOnFail: 1000,
            },
        });
        state.queue.on("error", (error) => {
            console.error("[Bot Batch] Redis queue error:", error.message);
        });
    }
    return state.queue;
}

export function isBotReplyQueueConfigured() {
    return Boolean(getRedisUrl());
}

export async function enqueueBotReplyBatch(params: {
    tenantId?: string;
    conversationId: string;
    windowMs: number;
    maxWaitMs: number;
    firstPendingAt: Date;
    deduplicationId?: string;
}) {
    const tenantId = params.tenantId || "legacy";
    const now = Date.now();
    const windowMs = Math.max(1000, Math.min(30000, Math.round(params.windowMs)));
    const maxWaitMs = Math.max(windowMs, Math.min(120000, Math.round(params.maxWaitMs)));
    const remainingUntilMaximum = Math.max(0, params.firstPendingAt.getTime() + maxWaitMs - now);
    const delay = Math.min(windowMs, remainingUntilMaximum);

    if (!isBotReplyQueueConfigured()) {
        const state = globals();
        if (!state.warnedMissingRedis) {
            state.warnedMissingRedis = true;
            console.warn("[Bot Batch] REDIS_URL is not configured; using the local fallback.");
        }
        scheduleLocalBatch(tenantId, params.conversationId, delay);
        return true;
    }

    try {
        await getQueue().add(
            "reply",
            { tenantId, conversationId: params.conversationId },
            {
                delay,
                deduplication: {
                    id: params.deduplicationId || batchKey(tenantId, params.conversationId),
                    ttl: Math.max(1000, maxWaitMs),
                    extend: true,
                    replace: true,
                },
            },
        );
    } catch (error) {
        console.error("[Bot Batch] Could not enqueue in Redis; using local fallback:", error);
        scheduleLocalBatch(tenantId, params.conversationId, delay);
    }
    return true;
}

export function startBotReplyWorker() {
    if (!isBotReplyQueueConfigured()) return null;

    const state = globals();
    if (state.worker) return state.worker;

    state.workerConnection = createRedisConnection(true);
    state.worker = new Worker<BotReplyJob>(
        BOT_REPLY_QUEUE_NAME,
        async (job) => {
            const lockKey = `zen-crm:bot-reply-lock:${batchKey(job.data.tenantId, job.data.conversationId)}`;
            const lockValue = `${job.id || "job"}:${Date.now()}`;
            const acquired = await state.workerConnection!.set(
                lockKey,
                lockValue,
                "PX",
                BOT_REPLY_LOCK_TTL_MS,
                "NX",
            );
            if (acquired !== "OK") {
                console.info("[Bot Batch] Conversation is already processing; pending messages will be swept", {
                    jobId: job.id,
                    conversationId: job.data.conversationId,
                });
                return;
            }
            const lockHeartbeat = setInterval(() => {
                void state.workerConnection!.eval(
                    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end",
                    1,
                    lockKey,
                    lockValue,
                    String(BOT_REPLY_LOCK_TTL_MS),
                ).catch((error) => {
                    console.error("[Bot Batch] Could not refresh conversation lock", {
                        conversationId: job.data.conversationId,
                        error: error instanceof Error ? error.message : String(error),
                    });
                });
            }, BOT_REPLY_LOCK_REFRESH_MS);
            lockHeartbeat.unref();
            try {
                await processTenantBatch(
                    job.data.tenantId,
                    job.data.conversationId,
                    String(job.id || "bot-batch"),
                );
            } finally {
                clearInterval(lockHeartbeat);
                try {
                    await state.workerConnection!.eval(
                        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
                        1,
                        lockKey,
                        lockValue,
                    );
                } catch (error) {
                    console.error("[Bot Batch] Could not release conversation lock", {
                        conversationId: job.data.conversationId,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }
        },
        {
            connection: state.workerConnection,
            concurrency: 4,
        },
    );
    state.worker.on("failed", (job, error) => {
        console.error("[Bot Batch] Worker job failed", {
            jobId: job?.id,
            conversationId: job?.data.conversationId,
            error: error.message,
        });
    });
    state.worker.on("error", (error) => {
        console.error("[Bot Batch] Redis worker error:", error);
    });
    console.log("[Bot Batch] Redis worker started.");
    const recoverPending = async () => {
        if (state.recoveryRunning) return;
        state.recoveryRunning = true;
        try {
            const { recoverPendingInboundBatches } = await import("@/app/actions/chat");
            const recovered = await recoverPendingInboundBatches();
            if (recovered > 0) {
                console.log(`[Bot Batch] Recovered ${recovered} pending conversation batches.`);
            }
        } catch (error) {
            console.error("[Bot Batch] Pending batch recovery failed:", error);
        } finally {
            state.recoveryRunning = false;
        }
    };

    // In multitenant mode each recovery sweep must run inside an explicit tenant
    // Prisma scope. The tenant worker invokes that sweep through the internal route.
    if (process.env.MULTITENANT_RUNTIME_ENABLED !== "true") {
        void recoverPending();
        if (!state.recoveryTimer) {
            state.recoveryTimer = setInterval(() => {
                void recoverPending();
            }, BOT_REPLY_RECOVERY_INTERVAL_MS);
            state.recoveryTimer.unref();
        }
    }
    return state.worker;
}
