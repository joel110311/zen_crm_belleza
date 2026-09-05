import "server-only";

import { getActiveTenantRuntimeContext } from "@/lib/active-tenant-context";
import { getControlDb } from "@/lib/control-db";

type UsageAllowance = { tenantId: string; planId: string | null; periodStart: Date; periodEnd: Date; limit: number | null };

function calendarMonth(now: Date) {
    return {
        periodStart: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
        periodEnd: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
    };
}

async function allowance(): Promise<UsageAllowance | null> {
    const context = await getActiveTenantRuntimeContext("read");
    if (!context) return null;
    const now = new Date();
    const db = getControlDb();
    const [subscription, trial] = await Promise.all([
        db.subscription.findFirst({
            where: { tenantId: context.tenantId, status: { in: ["ACTIVE", "TRIALING"] } },
            orderBy: { updatedAt: "desc" },
            select: { planId: true, currentPeriodStartsAt: true, currentPeriodEndsAt: true, plan: { select: { limits: true, features: true } } },
        }),
        db.trial.findUnique({ where: { tenantId: context.tenantId }, select: { status: true, startsAt: true, endsAt: true } }),
    ]);
    if (subscription?.plan) {
        const limits = subscription.plan.limits && typeof subscription.plan.limits === "object" && !Array.isArray(subscription.plan.limits)
            ? subscription.plan.limits as Record<string, unknown> : {};
        const features = subscription.plan.features && typeof subscription.plan.features === "object" && !Array.isArray(subscription.plan.features)
            ? subscription.plan.features as Record<string, unknown> : {};
        if (features.chatbot !== true) throw new Error("Tu plan actual no incluye respuestas del chatbot.");
        const fallback = calendarMonth(now);
        return {
            tenantId: context.tenantId,
            planId: subscription.planId,
            periodStart: subscription.currentPeriodStartsAt || fallback.periodStart,
            periodEnd: subscription.currentPeriodEndsAt || fallback.periodEnd,
            limit: typeof limits.chatbotMessagesPerMonth === "number" ? limits.chatbotMessagesPerMonth : null,
        };
    }
    if (trial && ["ACTIVE", "ENDING"].includes(trial.status) && trial.endsAt > now) {
        return { tenantId: context.tenantId, planId: null, periodStart: trial.startsAt, periodEnd: trial.endsAt, limit: 500 };
    }
    throw new Error("El chatbot requiere una prueba activa o un plan que lo incluya.");
}

export async function assertChatbotUsageAvailable() {
    const current = await allowance();
    if (!current || current.limit === null) return current;
    const aggregate = await getControlDb().usageLedger.aggregate({
        where: { tenantId: current.tenantId, metric: "chatbot_reply", periodStart: current.periodStart },
        _sum: { quantity: true },
    });
    if ((aggregate._sum.quantity || 0) >= current.limit) {
        throw new Error(`Alcanzaste el límite de ${current.limit.toLocaleString("es-MX")} respuestas del chatbot. El CRM continúa disponible y puedes cambiar de plan desde Facturación.`);
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
        update: {},
    });
}
