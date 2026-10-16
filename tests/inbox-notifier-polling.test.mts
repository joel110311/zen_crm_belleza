import assert from "node:assert/strict";
import test from "node:test";
import { loadTsModule } from "./helpers/load-ts-module.mts";

function fixture(pathname: string) {
    const effects: (() => undefined | (() => void))[] = [];
    const timers: { callback: () => void; milliseconds: number }[] = [];
    const requests: URL[] = [];
    const badges: string[][] = [];
    let timestamp = "2026-10-16T12:00:00.000Z";
    let sounds = 0;
    const component = loadTsModule("src/components/layout/inbox-notifier.tsx", {
        react: { useEffect: (effect: typeof effects[number]) => effects.push(effect), useRef: (current: unknown) => ({ current }) },
        "next/navigation": { usePathname: () => pathname },
        "@/lib/notificationSounds": { maybePlayNotification: () => { sounds++; } },
        "@/lib/inbox-browser-badge": { incrementUnreadCounts: (ids: string[]) => badges.push(ids) },
    }, {
        window: { location: { origin: "https://crm.test" } },
        fetch: async (url: string) => {
            requests.push(new URL(url));
            return { json: async () => [{ id: "chat-a", updatedAt: timestamp, lastMessageTime: timestamp, lastMessageDirection: "inbound" }] };
        },
        setInterval: (callback: () => void, milliseconds: number) => { timers.push({ callback, milliseconds }); return timers.length; },
        clearInterval: () => {},
    });
    (component.InboxNotifier as () => null)();
    const cleanup = effects[0]();
    return { requests, timers, badges, sounds: () => sounds, cleanup,
        nextMessage: () => { timestamp = "2026-10-16T12:01:00.000Z"; } };
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test("the inbox owns polling on both tenant and legacy URLs, without a duplicate global notification loop", async () => {
    for (const pathname of ["/dashboard/inbox", "/dashboard/inbox/", "/t/logicapp/inbox", "/t/otro-negocio/inbox/"]) {
        const f = fixture(pathname);
        await settle();
        assert.equal(f.requests.length, 0, pathname);
        assert.equal(f.timers.length, 0, pathname);
    }
});
test("other screens retain the initial snapshot, 4-second deltas, minute resync, sound and unread notification", async () => {
    for (const pathname of ["/dashboard", "/t/logicapp/dashboard", "/t/logicapp/contacts", "/t/logicapp/inbox-archive"]) {
        const f = fixture(pathname); await settle();
        assert.equal(f.requests.length, 1, pathname);
        assert.equal(f.requests[0].searchParams.get("limit"), "300");
        assert.deepEqual(f.timers.map((timer) => timer.milliseconds), [4000, 60000]);
        assert.equal(f.sounds(), 0);
        f.nextMessage(); f.timers[0].callback(); await settle();
        assert.ok(f.requests[1].searchParams.has("updatedSince"));
        assert.equal(f.sounds(), 1);
        assert.equal(JSON.stringify(f.badges), JSON.stringify([["chat-a"]]));
        f.timers[1].callback(); await settle();
        assert.equal(f.requests[2].searchParams.has("updatedSince"), false);
        f.cleanup?.(); f.timers[0].callback(); await settle();
        assert.equal(f.requests.length, 3, "disposed effects do not fetch again");
    }
});
