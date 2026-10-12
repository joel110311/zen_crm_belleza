import assert from "node:assert/strict";
import test from "node:test";
import { loadTsModule } from "./helpers/load-ts-module.mts";
import { requireProviderMessageId } from "../src/lib/whatsapp-audio.ts";

type Entry = { tenantId: string; metric: string; periodStart: Date; quantity: number; source: string; idempotencyKey: string };

function fixture(limit = 1000, used = 0) {
    const startsAt = new Date(Date.now() - 86_400_000);
    const endsAt = new Date(Date.now() + 20 * 86_400_000);
    const subscription = { planId: "plan", currentPeriodStartsAt: startsAt, currentPeriodEndsAt: endsAt, plan: { limits: { chatbotMessagesPerMonth: limit }, features: { chatbot: true } } };
    const entries: Entry[] = used ? [{ tenantId: "tenant-a", metric: "chatbot_reply", periodStart: startsAt, quantity: used, source: "delivered_bot_message", idempotencyKey: "seed" }] : [];
    let transactionQueue = Promise.resolve();
    let lockCount = 0;
    let paid = true;
    let failConfirmation = false;
    const ledger = {
        aggregate: async ({ where }: { where: { tenantId: string; metric: string; periodStart: Date } }) => ({ _sum: { quantity: entries.filter(entry => entry.tenantId === where.tenantId && entry.metric === where.metric && entry.periodStart.getTime() === where.periodStart.getTime()).reduce((sum, entry) => sum + entry.quantity, 0) } }),
        findUnique: async ({ where }: { where: { idempotencyKey: string } }) => entries.find(entry => entry.idempotencyKey === where.idempotencyKey) || null,
        create: async ({ data }: { data: Entry }) => { entries.push(data); return data; },
        upsert: async ({ where, create, update }: { where: { idempotencyKey: string }; create: Entry; update: Partial<Entry> }) => {
            if (failConfirmation) throw new Error("confirmation unavailable");
            const existing = entries.find(entry => entry.idempotencyKey === where.idempotencyKey);
            if (existing) Object.assign(existing, update); else entries.push(create);
        },
        deleteMany: async ({ where }: { where: { idempotencyKey: string; source: string } }) => {
            const index = entries.findIndex(entry => entry.idempotencyKey === where.idempotencyKey && entry.source === where.source);
            if (index !== -1) entries.splice(index, 1);
        },
    };
    const tx = { usageLedger: ledger, $queryRaw: async (sql: TemplateStringsArray, tenantId: string) => {
        assert.match(sql.join("?"), /FROM "Tenant" WHERE id = \? FOR UPDATE/);
        assert.equal(tenantId, "tenant-a"); lockCount++;
    } };
    const db = {
        usageLedger: ledger,
        subscription: { findFirst: async () => paid ? subscription : null },
        trial: { findUnique: async () => paid ? null : { status: "ACTIVE", startsAt, endsAt } },
        $transaction: async <T,>(fn: (value: typeof tx) => Promise<T>) => {
            const previous = transactionQueue;
            let unlock!: () => void;
            transactionQueue = new Promise<void>(resolve => { unlock = resolve; });
            await previous;
            try { return await fn(tx); } finally { unlock(); }
        },
    };
    const mod = loadTsModule("src/lib/billing/chatbot-usage.ts", {
        "server-only": {}, "@/lib/control-db": { getControlDb: () => db },
        "@/lib/active-tenant-context": { getActiveTenantRuntimeContext: async () => null },
        "@/lib/routed-prisma": { getScopedTenantId: () => "tenant-a" },
        "@/lib/whatsapp-audio": { requireProviderMessageId },
    });
    return {
        entries, subscription, startsAt,
        send: mod.withChatbotReplyUsage as (id: string, send: () => Promise<{ Id?: string | null }>) => Promise<unknown>,
        available: mod.assertChatbotUsageAvailable as () => Promise<unknown>,
        usage: mod.getChatbotUsage as (id: string) => Promise<{ used: number; limit: number; isTrial: boolean; periodEnd: string } | null>,
        locks: () => lockCount, trial: () => { paid = false; }, failConfirmation: () => { failConfirmation = true; },
    };
}

for (const limit of [1000, 3000, 10000]) {
    test(`plan with ${limit} replies stops before sending reply ${limit + 1}`, async () => {
        const f = fixture(limit, limit - 1);
        let sends = 0;
        await f.available();
        await f.send("last", async () => { sends++; return { Id: "provider-last" }; });
        await assert.rejects(() => f.send("excess", async () => { sends++; return { Id: "must-not-send" }; }), /Alcanzaste el límite/);
        await assert.rejects(f.available, /Alcanzaste el límite/);
        assert.equal(sends, 1);
        assert.equal((await f.usage("tenant-a"))?.used, limit);
        assert.equal(f.entries.at(-1)?.source, "delivered_bot_message");
    });
}

test("parallel replies reserve the last slot before the provider call completes", async () => {
    const f = fixture(1000, 999);
    let acknowledge!: () => void;
    let started!: () => void;
    const pending = new Promise<void>(resolve => { acknowledge = resolve; });
    const entered = new Promise<void>(resolve => { started = resolve; });
    const first = f.send("one", async () => { started(); await pending; return { Id: "one" }; });
    await entered;
    assert.equal((await f.usage("tenant-a"))?.used, 1000);
    await assert.rejects(() => f.send("two", async () => { throw new Error("must not call provider"); }), /Alcanzaste el límite/);
    acknowledge(); await first;
    assert.equal(f.locks(), 2);
});

test("rejected or unacknowledged sends release their slot; acknowledged sends survive bookkeeping errors", async () => {
    const f = fixture(1000, 999);
    await assert.rejects(() => f.send("failed", async () => { throw new Error("provider failed"); }), /provider failed/);
    await assert.rejects(() => f.send("unacknowledged", async () => ({ Id: null })), /no confirmó/);
    assert.equal((await f.usage("tenant-a"))?.used, 999);
    f.failConfirmation();
    await assert.rejects(() => f.send("accepted", async () => ({ Id: "accepted" })), /confirmation unavailable/);
    assert.equal((await f.usage("tenant-a"))?.used, 1000);
    assert.equal(f.entries.at(-1)?.source, "reserved_bot_message");
});

test("duplicate message IDs do not send twice or count twice", async () => {
    const f = fixture();
    let sends = 0;
    const deliver = async () => { sends++; return { Id: "provider" }; };
    await f.send("same", deliver);
    await assert.rejects(() => f.send("same", deliver), /ya se envió/);
    assert.equal(sends, 1);
    assert.equal((await f.usage("tenant-a"))?.used, 1);
});

test("usage is tenant-scoped, retained on upgrade, and reset by the next subscription period", async () => {
    const f = fixture(1000, 1000);
    assert.equal((await f.usage("tenant-b"))?.used, 0);
    f.subscription.plan.limits.chatbotMessagesPerMonth = 3000;
    await f.send("upgrade", async () => ({ Id: "upgrade" }));
    assert.equal((await f.usage("tenant-a"))?.used, 1001);
    f.subscription.currentPeriodStartsAt = new Date(Date.now() - 1000);
    assert.equal((await f.usage("tenant-a"))?.used, 0);
});

test("trial keeps its separate 500-reply allowance and does not claim monthly renewal", async () => {
    const f = fixture(1000, 500); f.trial();
    assert.equal((await f.usage("tenant-a"))?.limit, 500);
    assert.equal((await f.usage("tenant-a"))?.isTrial, true);
    await assert.rejects(f.available, /límite de 500/);
});

test("a plan without chatbot cannot send or obtain an active quota", async () => {
    const f = fixture(); f.subscription.plan.features.chatbot = false;
    await assert.rejects(() => f.send("disabled", async () => ({ Id: "must-not-send" })), /no incluye/);
    assert.equal(await f.usage("tenant-a"), null);
});
