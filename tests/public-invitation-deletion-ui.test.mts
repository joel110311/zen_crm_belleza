import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { loadTsModule } from "./helpers/load-ts-module.mts";

type Element = React.ReactElement<Record<string, any>>;
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
function nodes(tree: React.ReactNode): Element[] { return React.isValidElement<{ children?: React.ReactNode }>(tree) ? [tree as Element, ...React.Children.toArray(tree.props.children).flatMap(nodes)] : []; }
function text(tree: React.ReactNode): string { return typeof tree === "string" ? tree : React.isValidElement<{ children?: React.ReactNode }>(tree) ? React.Children.toArray(tree.props.children).map(text).join(" ") : ""; }
function fixture(kind: "invitation" | "deletion", fetcher: (url: string, init?: RequestInit) => Promise<Response>, hash = "", props: Record<string, unknown> = {}) {
    let cursor = 0, refCursor = 0, mounted = false;
    const states: unknown[] = [], refs: Array<{ current: unknown }> = [], effects: Array<() => void> = [];
    const location = { hash };
    const mod = loadTsModule(kind === "invitation" ? "src/components/tenant/invitation-acceptance-form.tsx" : "src/components/settings/account-deletion-panel.tsx", {
        react: {
            useState(initial: unknown) { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], (value: unknown) => { states[i] = typeof value === "function" ? value(states[i]) : value; }]; },
            useRef(initial: unknown) { const i = refCursor++; refs[i] ||= { current: initial }; return refs[i]; },
            useEffect(fn: () => void) { if (!mounted) effects.push(fn); },
        },
        "next/link": "a", "@/components/public/auth-shell": { AuthShell: "shell" },
        "@/components/public/auth-workspace.module.css": {}, "./account-deletion.module.css": {},
        "@/components/ui/button": { Button: "button" }, "@/components/ui/input": { Input: "input" }, "@/components/ui/label": { Label: "label" },
    }, { fetch: fetcher, window: { location, history: { replaceState(_a: unknown, _b: unknown, path: string) { location.hash = path.includes("#") ? `#${path.split("#")[1]}` : ""; } } }, crypto: { getRandomValues: (bytes: Uint8Array) => bytes.fill(7) } });
    return {
        render() { cursor = refCursor = 0; return (mod[kind === "invitation" ? "InvitationAcceptanceForm" : "AccountDeletionPanel"] as (props: unknown) => Element)({ token: "local-test-token", ...props }); },
        async mount() { effects.forEach(fn => fn()); mounted = true; await settle(); }, location,
    };
}
function form(tree: React.ReactNode) { return nodes(tree).find(e => e.type === "form")!; }
function field(tree: React.ReactNode, id: string) { const found = nodes(tree).find(e => e.props.id === id); assert.ok(found); return found; }
const event = { preventDefault() {} };

test("invitation preserves new-account payload and blocks duplicate requests before rerender", async () => {
    const calls: any[] = []; let respond!: (r: Response) => void;
    const f = fixture("invitation", async (url, init) => { calls.push({ url, body: JSON.parse(String(init?.body)) }); return new Promise(resolve => { respond = resolve; }); });
    field(f.render(), "invitation-name").props.onChange({ target: { value: "Equipo local" } });
    field(f.render(), "invitation-password").props.onChange({ target: { value: "fake-passphrase-123" } });
    const submit = form(f.render()).props.onSubmit;
    const pending = submit(event); await submit(event); assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/api/public/invitations/accept"); assert.deepEqual(calls[0].body, { token: "local-test-token", name: "Equipo local", password: "fake-passphrase-123" });
    assert.ok(nodes(f.render()).some(e => e.type === "fieldset" && e.props.disabled));
    respond(Response.json({ data: { displayName: "Estudio local", signInPath: "/login?redirectTo=%2Ft%2Flocal" } })); await pending;
    assert.equal(form(f.render()), undefined); assert.ok(nodes(f.render()).some(e => e.props.href === "/login?redirectTo=%2Ft%2Flocal"));
});

test("existing-account invitation has no credential fields and sends only its token; failure can be retried", async () => {
    let fail = true; const calls: any[] = [];
    const f = fixture("invitation", async (_url, init) => { calls.push(JSON.parse(String(init?.body))); return fail ? Response.json({ error: { message: "La invitación venció." } }, { status: 404 }) : Response.json({ data: { displayName: "Local", signInPath: "/login" } }); }, "", { requiresNewAccount: false });
    assert.ok(!nodes(f.render()).some(e => e.type === "input"));
    await form(f.render()).props.onSubmit(event); assert.deepEqual(calls[0], { token: "local-test-token" }); assert.match(text(f.render()), /La invitación venció/); assert.ok(form(f.render()));
    fail = false; await form(f.render()).props.onSubmit(event); assert.equal(calls.length, 2); assert.equal(form(f.render()), undefined);
});

test("a new invited account requires name and password without instructions to leave them empty", () => {
    const f = fixture("invitation", async () => Response.json({}));
    assert.equal(field(f.render(), "invitation-name").props.required, true);
    assert.equal(field(f.render(), "invitation-password").props.required, true);
    assert.doesNotMatch(text(f.render()), /campos vacíos|Déjala vacía/);
    assert.match(text(f.render()), /crea una contraseña/);
});

test("an accepted invitation reloads as completed and makes no additional acceptance request", () => {
    const f = fixture("invitation", async () => { throw new Error("must not post"); }, "", { alreadyAccepted: true, displayName: "Estudio local", signInPath: "/login?redirectTo=local" });
    assert.equal(form(f.render()), undefined);
    assert.ok(nodes(f.render()).some(e => e.props.href === "/login?redirectTo=local"));
});

const businesses = [{ id: "local", name: "Estudio local", soleOwner: true, successors: [{ id: "successor", name: "Equipo" }] }];
async function readyDeletion(fetcher: (url: string, init?: RequestInit) => Promise<Response>) {
    const f = fixture("deletion", fetcher); f.render(); await f.mount();
    field(f.render(), "deletion-password").props.onChange({ target: { value: "fake-current-password" } });
    field(f.render(), "deletion-confirmation").props.onChange({ target: { value: "ELIMINAR MI CUENTA" } }); return f;
}
function choose(tree: React.ReactNode, value: string) { nodes(tree).find(e => e.props.type === "radio" && e.props.value === value)!.props.onChange(); }

test("deletion requires explicit business decision, retains transfer contract, and blocks duplicate submits", async () => {
    const posts: any[] = []; let respond!: (r: Response) => void;
    const f = await readyDeletion(async (_url, init) => { if (init?.method !== "POST") return Response.json({ businesses }); posts.push(JSON.parse(String(init.body))); return new Promise(resolve => { respond = resolve; }); });
    await form(f.render()).props.onSubmit(event); assert.equal(posts.length, 0);
    choose(f.render(), "successor"); const submit = form(f.render()).props.onSubmit;
    const pending = submit(event); await submit(event); assert.equal(posts.length, 1); assert.deepEqual(posts[0].decisions, { local: "successor" });
    assert.equal(posts[0].confirmation, "ELIMINAR MI CUENTA"); assert.equal(posts[0].receipt.length, 64); assert.equal(f.location.hash, `#${posts[0].receipt}`);
    respond(Response.json({ status: "PENDING" })); await pending; assert.equal(form(f.render()), undefined); assert.match(text(f.render()), /Eliminación en proceso/);
});

test("an interrupted deletion response keeps the private receipt and offers status instead of another deletion", async () => {
    const calls: any[] = [];
    const f = await readyDeletion(async (url, init) => { calls.push({ url, init }); if (init?.method !== "POST") return Response.json({ businesses }); if (url.endsWith("/status")) return Response.json({ status: "COMPLETED" }); throw new Error("offline"); });
    choose(f.render(), "close"); await form(f.render()).props.onSubmit(event);
    assert.equal(form(f.render()), undefined); assert.equal(f.location.hash.length, 65); assert.match(text(f.render()), /Consulta el estado de tu solicitud/);
    nodes(f.render()).find(e => e.type === "button" && text(e) === "Consultar estado")!.props.onClick(); await settle();
    assert.match(text(f.render()), /Tu cuenta fue eliminada/); assert.equal(calls.filter(c => c.url === "/api/account/deletion" && c.init?.method === "POST").length, 1);
});

test("a rejected deletion retains choices and clears the unused receipt for a deliberate retry", async () => {
    const f = await readyDeletion(async (_url, init) => init?.method === "POST" ? Response.json({ error: "Contraseña incorrecta" }, { status: 400 }) : Response.json({ businesses }));
    choose(f.render(), "close"); await form(f.render()).props.onSubmit(event);
    assert.ok(form(f.render())); assert.match(text(f.render()), /Contraseña incorrecta/); assert.equal(f.location.hash, ""); assert.equal(field(f.render(), "deletion-password").props.value, "fake-current-password");
});

test("a private receipt consults status without loading account details or offering deletion", async () => {
    const calls: string[] = [];
    const f = fixture("deletion", async url => { calls.push(url); return Response.json({ status: "NOT_FOUND" }); }, `#${"a".repeat(64)}`);
    f.render(); await f.mount(); assert.deepEqual(calls, ["/api/public/account-deletion/status"]); assert.equal(form(f.render()), undefined); assert.match(text(f.render()), /No se encontró una solicitud/); assert.ok(nodes(f.render()).some(e => e.props.href === "/delete-account"));
});

test("deletion without a session routes to login with a return path", async () => {
    const f = fixture("deletion", async () => new Response(null, { status: 401 })); f.render(); await f.mount();
    assert.equal(form(f.render()), undefined); assert.ok(nodes(f.render()).some(e => e.props.href === "/login?redirectTo=%2Fdelete-account"));
});
