import assert from "node:assert/strict";
import test from "node:test";
import { loadTsModule } from "./helpers/load-ts-module.mts";
import * as operation from "../src/lib/operation-context.ts";

test("tenant operation context avoids HTTP reads, updates across businesses and keeps the legacy fallback", async () => {
    let provided: unknown = operation.buildOperationContext({ businessTimeZone: "America/New_York" });
    let state: unknown, effect: () => unknown = () => {}, requests = 0;
    const subject = loadTsModule("src/components/shared/use-operation-context.ts", {
        react: { createContext: () => ({}), useContext: () => provided,
            useState: (initial: unknown) => [state ?? initial, (value: unknown) => { state = value; }],
            useEffect: (callback: () => unknown) => { effect = callback; }, useMemo: (compute: () => unknown) => compute(), useCallback: (fn: unknown) => fn,
        }, "@/lib/operation-context": operation,
    }, { fetch: async () => { requests++; return Response.json(operation.buildOperationContext({ businessTimeZone: "Europe/Madrid" })); } });
    const hook = subject.useOperationContext as () => { timeZone: string };
    assert.equal(hook().timeZone, "America/New_York"); effect(); assert.equal(requests, 0);
    provided = operation.buildOperationContext({ businessTimeZone: "America/Mexico_City" });
    assert.equal(hook().timeZone, "America/Mexico_City"); effect(); assert.equal(requests, 0);
    provided = null; hook(); effect(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests, 1); assert.equal(hook().timeZone, "Europe/Madrid");
});

test("retired Pipeline endpoints require authorization and return Gone without querying or modifying Pipeline", async () => {
    let blocked = false;
    const subject = loadTsModule("src/lib/retired-pipeline.ts", {
        "next/server": { NextResponse: { json: (data: unknown, init: ResponseInit) => Response.json(data, init) } },
        "@/lib/auth": { auth: async () => ({}) },
        "@/lib/authz": { ensurePermissionResponse: () => blocked ? new Response(null, { status: 403 }) : null },
        "@/lib/tenant-api": { withTenantApi: async (_request: unknown, slug: string, options: { permission: string }, callback: () => unknown) => {
            assert.equal(slug, "test"); assert.equal(options.permission, "contacts.read");
            return blocked ? new Response(null, { status: 403 }) : callback();
        } },
    });
    for (const handler of [() => (subject.retiredLegacyPipeline as () => Promise<Response>)(), () => (subject.retiredTenantPipeline as (req: Request, ctx: unknown) => Promise<Response>)(new Request("https://example.invalid"), { params: Promise.resolve({ tenantSlug: "test" }) })]) {
        blocked = false; const gone = await handler(); assert.equal(gone.status, 410); assert.equal((await gone.json()).error.code, "GONE");
        blocked = true; assert.equal((await handler()).status, 403);
    }
});
