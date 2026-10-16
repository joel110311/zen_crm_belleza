import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { loadTsModule } from "../tests/helpers/load-ts-module.mts";

const ref = process.argv[2] || "2994f387ae2d93bc4a81ad31a65d63f6013f1c27";
const directory = "output/performance-audit";
mkdirSync(directory, { recursive: true });
const originals = {
    actor: "src/lib/tenant-actor.ts",
    notifier: "src/components/layout/inbox-notifier.tsx",
};
for (const [name, path] of Object.entries(originals)) {
    writeFileSync(`${directory}/baseline-${name}.tsx`, execFileSync("git", ["show", `${ref}:${path}`]));
}

async function actor(path: string) {
    const counts = { reads: 0, writes: 0, transactions: 0 };
    const identity = { id: "global", email: "owner@example.invalid", name: "Owner" };
    const projected = { ...identity, id: "local", controlUserId: "global", role: "ADMINISTRADOR", permissions: ["chats.manage"] };
    const user = { findUnique: async () => { counts.reads++; return { ...projected }; }, update: async () => { counts.writes++; return { ...projected }; } };
    const db = { user, $transaction: async (work: (value: { user: typeof user }) => unknown) => { counts.transactions++; return work({ user }); } };
    const service = loadTsModule(path, {
        "server-only": {}, "@prisma/client": { Prisma: {} },
        "@/lib/control-db": { getControlDb: () => ({ user: { findUnique: async () => { counts.reads++; return identity; } } }) },
    });
    let last: unknown;
    for (let index = 0; index < 30; index++) last = await (service.ensureTenantActor as (db: unknown, access: unknown, id: string) => Promise<unknown>)(db, { role: "OWNER" }, "global");
    return { ...counts, result: JSON.stringify(last) };
}
async function notifier(path: string, pathname: string) {
    let effect: (() => void) | undefined;
    let requests = 0;
    const timers: { callback: () => void; ms: number }[] = [];
    const service = loadTsModule(path, {
        react: { useEffect: (callback: () => void) => { effect = callback; }, useRef: (current: unknown) => ({ current }) },
        "next/navigation": { usePathname: () => pathname },
        "@/lib/notificationSounds": { maybePlayNotification: () => {} },
        "@/lib/inbox-browser-badge": { incrementUnreadCounts: () => {} },
    }, {
        window: { location: { origin: "https://crm.test" } },
        fetch: async () => { requests++; return { json: async () => [{ id: "chat", lastMessageTime: "2026-10-16T12:00:00Z" }] }; },
        setInterval: (callback: () => void, ms: number) => { timers.push({ callback, ms }); return timers.length; }, clearInterval: () => {},
    });
    (service.InboxNotifier as () => unknown)(); effect?.();
    const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
    await settle();
    for (let ms = 1000; ms <= 60_000; ms += 1000) {
        for (const timer of timers) if (ms % timer.ms === 0) { timer.callback(); await settle(); }
    }
    return requests;
}
const beforeActor = await actor(`${directory}/baseline-actor.tsx`), afterActor = await actor(originals.actor);
assert.equal(afterActor.result, beforeActor.result);
assert.equal(beforeActor.writes, 30); assert.equal(afterActor.writes, 0);
assert.equal(afterActor.transactions, 0);
const polling = [];
for (const pathname of ["/t/logicapp/inbox", "/dashboard/inbox", "/t/logicapp/dashboard"]) {
    const before = await notifier(`${directory}/baseline-notifier.tsx`, pathname), after = await notifier(originals.notifier, pathname);
    if (pathname === "/t/logicapp/inbox") { assert.equal(before, 17); assert.equal(after, 0); }
    else assert.equal(after, before);
    polling.push({ pathname, before, after });
}
console.log(JSON.stringify({ baseline: ref, measurement: "Actual service/effect callbacks with mocked I/O; not a live-server load test", actorRequests: 30,
    actor: { before: beforeActor, after: afterActor }, pollingFirst60SecondsIncludingInitialSnapshot: polling }, null, 2));
