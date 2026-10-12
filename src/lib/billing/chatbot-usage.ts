import "server-only";

import { getActiveTenantRuntimeContext } from "@/lib/active-tenant-context";
import { getControlDb } from "@/lib/control-db";
import { getScopedTenantId } from "@/lib/routed-prisma";
import { requireProviderMessageId } from "@/lib/whatsapp-audio";

type UsageAllowance = { tenantId: string; planId: string | null; periodStart: Date; periodEnd: Date; limit: number | null };
class ChatbotAccessError extends Error {}

export type ChatbotUsage = { used: number; limit: number | null; periodStart: string; periodEnd: string; isTrial: boolean };

function calendarMonth(now: Date) {
    return {
        periodStart: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
        periodEnd: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
    };
}

function isNoRequestContextError(error: unknown) {
    return error instanceof Error && (
        error.message.includes("outside a request scope")
        || error.message.includes("was called outside a request")
    );
}

async function usageTenantId() {
    const scopedTenantId = getScopedTenantId();
    if (scopedTenantId && scopedTenantId !== "legacy") return scopedTenantId;
    try {
        return (await getActiveTenantRuntimeContext("read"))?.tenantId || null;
    } catch (error) {
        // Redis and scheduled workers have no Next.js request store. They must use the explicit
        // tenant scope installed by runWithTenantPrisma instead of reading request headers.
        if (isNoRequestContextError(error)) return null;
        throw error;
    }
}

async function allowance(explicitTenantId?: string): Promise<UsageAllowance | null> {
    const tenantId = explicitTenantId ?? await usageTenantId();
    if (!tenantId) return null;
    const now = new Date();
    const db = getControlDb();
    const [subscription, trial] = await Promise.all([
        db.subscription.findFirst({
            where: { tenantId, status: { in: ["ACTIVE", "TRIALING"] }, OR: [{ currentPeriodEndsAt: null }, { currentPeriodEndsAt: { gt: now } }] },
            orderBy: { updatedAt: "desc" },
            select: { planId: true, currentPeriodStartsAt: true, currentPeriodEndsAt: true, plan: { select: { limits: true, features: true } } },
        }),
        db.trial.findUnique({ where: { tenantId }, select: { status: true, startsAt: true, endsAt: true } }),
    ]);
    if (subscription?.plan) {
        const limits = subscription.plan.limits && typeof subscription.plan.limits === "object" && !Array.isArray(subscription.plan.limits)
            ? subscription.plan.limits as Record<string, unknown> : {};
        const features = subscription.plan.features && typeof subscription.plan.features === "object" && !Array.isArray(subscription.plan.features)
            ? subscription.plan.features as Record<string, unknown> : {};
        if (features.chatbot !== true) throw new ChatbotAccessError("Tu plan actual no incluye respuestas del chatbot.");
        const fallback = calendarMonth(now);
        return {
            tenantId,
            planId: subscription.planId,
            periodStart: subscription.currentPeriodStartsAt || fallback.periodStart,
            periodEnd: subscription.currentPeriodEndsAt || fallback.periodEnd,
            limit: typeof limits.chatbotMessagesPerMonth === "number" ? limits.chatbotMessagesPerMonth : null,
        };
    }
    if (trial && ["ACTIVE", "ENDING"].includes(trial.status) && trial.endsAt > now) {
        return { tenantId, planId: null, periodStart: trial.startsAt, periodEnd: trial.endsAt, limit: 500 };
    }
    throw new ChatbotAccessError("El chatbot requiere una prueba activa o un plan que lo incluya.");
}

function limitError(limit: number) {
    return new Error(`Alcanzaste el límite de ${limit.toLocaleString("es-MX")} respuestas del chatbot. El CRM continúa disponible y puedes cambiar de plan desde Facturación.`);
}

/** Caller must first authorize membership in this exact tenant. */
export async function getChatbotUsage(tenantId: string): Promise<ChatbotUsage | null> {
    let current;
    try { current = await allowance(tenantId); }
    catch (error) { if (error instanceof ChatbotAccessError) return null; throw error; }
    if (!current) return null;
    const aggregate = await getControlDb().usageLedger.aggregate({
        where: { tenantId, metric: "chatbot_reply", periodStart: current.periodStart },
        _sum: { quantity: true },
    });
    return { used: aggregate._sum.quantity || 0, limit: current.limit, periodStart: current.periodStart.toISOString(), periodEnd: current.periodEnd.toISOString(), isTrial: current.planId === null };
}

export async function assertChatbotUsageAvailable() {
    const current = await allowance();
    if (!current || current.limit === null) return current;
    const aggregate = await getControlDb().usageLedger.aggregate({
        where: { tenantId: current.tenantId, metric: "chatbot_reply", periodStart: current.periodStart },
        _sum: { quantity: true },
    });
    if ((aggregate._sum.quantity || 0) >= current.limit) {
        throw limitError(current.limit);
    }
    return current;
}

export async function recordChatbotReply(messageId: string, current?: UsageAllowance | null) {
    const resolved = current === undefined ? await allowance() : current;
    if (!resolved) return;
    await getControlDb().usageLedger.upsert({
        where: { idempotencyKey: `chatbot-reply:${resolved.tenantId}:${messageId}` },
        create: {
            tenantId: resolved.tenantId,
            planId: resolved.planId,
            metric: "chatbot_reply",
            periodStart: resolved.periodStart,
            periodEnd: resolved.periodEnd,
            quantity: 1,
            idempotencyKey: `chatbot-reply:${resolved.tenantId}:${messageId}`,
            source: "delivered_bot_message",
        },
        update: { source: "delivered_bot_message" },
    });
}

/** Reserve before the external send, under a per-tenant DB lock shared by all workers. */
export async function withChatbotReplyUsage<T extends { Id?: string | null } | null | undefined>(messageId: string, send: () => Promise<T>): Promise<T> {
    const current = await allowance();
    if (!current) return send(); // Legacy workspace has no commercial subscription.
    const db = getControlDb();
    const idempotencyKey = `chatbot-reply:${current.tenantId}:${messageId}`;
    await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${current.tenantId} FOR UPDATE`;
        if (await tx.usageLedger.findUnique({ where: { idempotencyKey } })) {
            throw new Error("Esta respuesta del chatbot ya se envió o está en proceso.");
        }
        const aggregate = await tx.usageLedger.aggregate({
            where: { tenantId: current.tenantId, metric: "chatbot_reply", periodStart: current.periodStart },
            _sum: { quantity: true },
        });
        if (current.limit !== null && (aggregate._sum.quantity || 0) >= current.limit) throw limitError(current.limit);
        await tx.usageLedger.create({ data: {
            tenantId: current.tenantId, planId: current.planId, metric: "chatbot_reply",
            periodStart: current.periodStart, periodEnd: current.periodEnd, quantity: 1,
            idempotencyKey, source: "reserved_bot_message",
        } });
    });
    let acknowledged = false;
    try {
        const result = await send();
        requireProviderMessageId(result);
        acknowledged = true;
        await recordChatbotReply(messageId, current);
        return result;
    } catch (error) {
        // Never release an acknowledged send if only the bookkeeping failed.
        if (!acknowledged) await db.usageLedger.deleteMany({ where: { idempotencyKey, source: "reserved_bot_message" } });
        throw error;
    }
}
