import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { loadTsModule } from "./helpers/load-ts-module.mts";
import * as permissions from "../src/lib/permissions.ts";
import * as routing from "../src/lib/tenant-request-routing.ts";
import { getWorkspaceDestinations } from "../src/lib/workspace-navigation.ts";

test("direct tenant URLs and menu permissions agree across ten modules, roles and explicit extras", async () => {
    const subjects = [{ role: "ADMINISTRADOR" }, { role: "RECEPCION" }, { role: "PROFESIONAL" }, { role: "RECEPCION", permissions: ["ai.manage", "services.manage"] }, null];
    const modules = ["calendar", "contacts", "inbox", "templates", "brain", "business", "services", "specialists", "reception", "onboarding"];
    for (const subject of subjects) {
        const visible = getWorkspaceDestinations({ subject: subject || undefined, tenantSlug: "salon-a" });
        let required: permissions.PermissionKey | null = null;
        const gate = loadTsModule("src/lib/tenant-page-access.ts", {
            "server-only": {}, "next/navigation": { redirect: (url: string) => { throw new Error(`redirect:${url}`); } },
            "@/lib/authz": { requirePermission: async (key: permissions.PermissionKey) => { required = key; if (!subject || !permissions.hasPermission(subject, key)) throw new Error("Forbidden"); } },
        });
        for (const route of modules) {
            const component = loadTsModule(`src/app/t/[tenantSlug]/${route}/layout.tsx`, { "@/lib/tenant-page-access": gate });
            const run = () => (component.default as (props: unknown) => Promise<string>)({ children: "screen", params: Promise.resolve({ tenantSlug: "salon-a" }) });
            let allowed = false;
            try { assert.equal(await run(), "screen"); allowed = true; } catch (error) { assert.equal((error as Error).message, "redirect:/t/salon-a/dashboard"); }
            assert.equal(allowed, Boolean(subject && required && permissions.hasPermission(subject, required)), `${subject?.role || "anonymous"}/${route}`);
            if (route !== "onboarding") assert.equal(allowed, visible.some(item => item.href === `/t/salon-a/${route}`), `menu and URL: ${subject?.role}/${route}`);
        }
    }
});

test("global search authorizes before DB reads, normalizes bounded input and surfaces connection failures", async () => {
    const queries: { where: { OR: { name?: { contains: string } }[] }; take: number }[] = []; let blocked = true, fails = false;
    const subject = loadTsModule("src/app/actions/search.ts", {
        "@/lib/authz": { requireAnyPermission: async (keys: string[]) => { assert.ok(keys.includes("contacts.manage")); if (blocked) throw new Error("Forbidden"); } },
        "@/lib/db": { prisma: { contact: { findMany: async (query: typeof queries[number]) => { queries.push(query); if (fails) throw new Error("private database detail"); return [{ id: "ana", name: "Ana", whatsappAvatarUrl: null }]; } } } },
    }, { console: { error() {} } });
    const search = subject.searchGlobal as (text: string) => Promise<{ contacts: { id: string }[] }>;
    await assert.rejects(search("Ana"), /Forbidden/); assert.equal(queries.length, 0);
    blocked = false; await search("   "); assert.equal(queries.length, 0);
    assert.equal((await search("  Ana  ")).contacts[0].id, "ana"); assert.equal(queries[0].where.OR[0].name?.contains, "Ana"); assert.equal(queries[0].take, 5);
    await search("x".repeat(250)); assert.equal(queries[1].where.OR[0].name?.contains.length, 160);
    fails = true; await assert.rejects(search("Ana"), /No pudimos buscar clientes/);
});

type Element = React.ReactElement<Record<string, unknown>>;
function elements(node: React.ReactNode): Element[] {
    if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return [];
    return [node as Element, ...React.Children.toArray(node.props.children).flatMap(elements)];
}
function harness(pathname = "/t/salon-a/dashboard") {
    const state: unknown[] = [false, "", null, 0]; let cursor = 0, effectCursor = 0;
    const effects: { deps: unknown[]; cleanup?: () => void }[] = []; const pendingEffects: (() => void)[] = [];
    const requests: { query: string; resolve: (value: unknown) => void; reject: (reason: Error) => void }[] = [], pushes: string[] = [];
    let session: unknown = { user: { role: "ADMINISTRADOR" } };
    const ui = Object.fromEntries(["CommandDialog", "CommandEmpty", "CommandGroup", "CommandInput", "CommandItem", "CommandList"].map(key => [key, `test-${key}`]));
    const subject = loadTsModule("src/components/header/search-command.tsx", {
        react: { __esModule: true, ...React,
            useState: (initial: unknown) => { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], (value: unknown) => { state[index] = typeof value === "function" ? value(state[index]) : value; }]; },
            useEffect: (run: () => (() => void) | undefined, deps: unknown[]) => { const index = effectCursor++, old = effects[index]; if (!old || deps.some((value, key) => !Object.is(value, old.deps[key]))) { pendingEffects.push(() => { old?.cleanup?.(); effects[index] = { deps, cleanup: run() }; }); } },
        },
        "next/navigation": { usePathname: () => pathname, useRouter: () => ({ push: (url: string) => pushes.push(url) }) },
        "next-auth/react": { useSession: () => ({ data: session }) }, "use-debounce": { useDebounce: (value: unknown) => [value] },
        "@/components/ui/command": ui, "@/components/ui/button": { Button: "test-button" }, "@/lib/permissions": permissions,
        "@/lib/tenant-request-routing": routing, "@/lib/contact-name": { getContactFullName: (contact: { name: string }) => contact.name },
        "@/app/actions/search": { searchGlobal: (query: string) => new Promise((resolve, reject) => requests.push({ query, resolve, reject })) },
    }, { document: { addEventListener() {}, removeEventListener() {} } });
    return { state, requests, pushes, session: (value: unknown) => { session = value; }, render: () => { cursor = 0; effectCursor = 0; const tree = (subject.SearchCommand as () => React.ReactNode)(); for (const run of pendingEffects.splice(0)) run(); return elements(tree); } };
}
const result = (id: string, name: string) => ({ contacts: [{ id, name, email: "test@example.invalid" }], deals: [] });
const settle = () => new Promise(resolve => setImmediate(resolve));

test("search discards late responses, closes safely and opens the actual tenant client profile", async () => {
    const subject = harness(); subject.render(); subject.state[0] = true; subject.state[1] = "Ana"; subject.render();
    subject.state[1] = "Maria"; subject.render(); assert.equal(subject.requests.length, 2);
    subject.requests[1].resolve(result("maria/id", "María")); await settle();
    subject.requests[0].resolve(result("ana", "Ana")); await settle();
    const rendered = subject.render(); const option = rendered.find(item => item.type === "test-CommandItem")!;
    assert.equal(option.props.value, "maria/id");
    assert.equal(rendered.find(item => item.type === "test-CommandDialog")?.props.shouldFilter, false, "phone/company matches must not be filtered again by name");
    (option.props.onSelect as () => void)(); assert.equal(subject.pushes[0], "/t/salon-a/contacts/maria%2Fid");
    assert.equal(subject.state[0], false);
    subject.render(); subject.state[0] = true; subject.state[1] = "Otra"; subject.render();
    subject.state[0] = false; subject.render(); subject.requests[2].resolve(result("late", "Tardío")); await settle();
    assert.equal(subject.state[2], null);
});
test("search has retry and short-query states, preserves legacy routing and hides before authentication", async () => {
    const subject = harness("/dashboard"); subject.render(); subject.state[0] = true; subject.state[1] = "A"; subject.render(); assert.equal(subject.requests.length, 0);
    subject.state[1] = "Ana"; subject.render(); subject.requests[0].reject(new Error("connection")); await settle();
    const failed = subject.render(); assert.ok(failed.some(item => item.props.role === "alert"));
    const retry = failed.find(item => item.type === "test-button" && item.props.children === "Reintentar búsqueda")!;
    (retry.props.onClick as () => void)(); subject.render(); assert.equal(subject.requests.length, 2);
    subject.requests[1].resolve(result("ana", "Ana")); await settle();
    (subject.render().find(item => item.type === "test-CommandItem")!.props.onSelect as () => void)(); assert.equal(subject.pushes[0], "/dashboard/contacts/ana");
    subject.session(null); assert.equal(subject.render().length, 0);
});
