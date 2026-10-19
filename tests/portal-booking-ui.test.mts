import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { loadTsModule } from "./helpers/load-ts-module.mts";

const settle = () => new Promise<void>(resolve => setImmediate(resolve));
const data = { enabled: true, slug: "local-portal", clinicName: "Estudio local", subtitle: "Cuidado personal", primaryColor: "#4B5F25", logoUrl: null, logoScale: 100, address: null, operationContext: { locale: "es-MX", timeZone: "UTC", phoneDefaultCountry: "MX", callingCode: "+52" }, specialists: [{ id: "specialist-a", name: "Sofía", displayName: null }], services: [{ id: "service-a", name: "Corte y peinado", description: null, price: 280, currency: "MXN", durationMinutes: 45, imageUrl: null, showPrice: true, specialists: [{ specialistId: "specialist-a" }] }] };
type Element = React.ReactElement<Record<string, unknown> & {
    children?: React.ReactNode;
    onClick: () => void;
    onChange: (value: string | { target: { value: string } }) => void;
    onSubmit: (event: { preventDefault(): void }) => void;
    style?: React.CSSProperties & { "--portal-logo-scale"?: number };
}>;
function nodes(tree: React.ReactNode): Element[] { if (!React.isValidElement<{ children?: React.ReactNode }>(tree)) return []; return [tree as Element, ...React.Children.toArray(tree.props.children).flatMap(nodes)]; }
function text(tree: React.ReactNode): string { if (typeof tree === "string" || typeof tree === "number") return String(tree); if (!React.isValidElement<{ children?: React.ReactNode }>(tree)) return ""; return React.Children.toArray(tree.props.children).map(text).join(" "); }
function button(tree: React.ReactNode, name: string) { const found = nodes(tree).find(e => e.type === "button" && text(e).trim() === name); assert.ok(found, `button ${name}`); return found; }
function fixture(file: string, name: string, props: unknown, fetcher: (url: string, init?: RequestInit) => Promise<Response>, actions: Record<string, unknown> = {}) {
    let stateCursor = 0, refCursor = 0, effectCursor = 0;
    const states: unknown[] = [], refs: Array<{ current: unknown }> = [];
    const effects: Array<{ deps: unknown[]; cleanup?: () => void }> = [];
    const pending = new Map<number, () => void | (() => void)>();
    const jobs: Promise<unknown>[] = [];
    const mod = loadTsModule(file, {
        react: {
            useState(initial: unknown) { const i = stateCursor++; if (!(i in states)) states[i] = typeof initial === "function" ? initial() : initial; return [states[i], (next: unknown) => { states[i] = typeof next === "function" ? next(states[i]) : next; }]; },
            useRef(initial: unknown) { const i = refCursor++; refs[i] ||= { current: initial }; return refs[i]; },
            useMemo: (fn: () => unknown) => fn(), useCallback: (fn: unknown) => fn,
            useTransition: () => [false, (fn: () => Promise<unknown>) => jobs.push(fn())],
            useEffect(fn: () => void | (() => void), deps: unknown[]) { const i = effectCursor++; const old = effects[i]; if (!old || deps.some((value, j) => value !== old.deps[j])) { pending.set(i, fn); effects[i] = { deps, cleanup: old?.cleanup }; } },
        },
        "./portal-frame": { PortalFrame: "div" }, "./portal-workspace.module.css": {},
        "@/components/portal/portal-social-links": { PortalSocialLinks: () => null },
        "@/components/ui/calendar": { Calendar: () => null },
        "@/components/ui/use-toast": { useToast: () => ({ toast() {} }) },
        "@/components/shared/phone-prefix-input": { PhonePrefixInput: "phone" },
        "@/app/actions/portal": actions, "@/app/actions/calendar": actions,
        "@/lib/operation-dates": { getOperationTodayKey: () => "2026-10-16", timeToOperationInputValue: (value: string | Date) => new Date(value).toISOString().slice(11, 16) },
        "next/link": "a",
    }, { fetch: fetcher, crypto: { randomUUID: (() => { let n = 0; return () => `test-idempotency-key-${++n}`; })() } });
    return {
        render() { stateCursor = refCursor = effectCursor = 0; return (mod[name] as (props: unknown) => React.ReactElement)(props); },
        async effects() { for (const [i, fn] of pending) { effects[i].cleanup?.(); effects[i].cleanup = fn() || undefined; } pending.clear(); await settle(); },
        async jobs() { await Promise.all(jobs); await settle(); },
    };
}

const slot = "2026-10-16T14:00:00Z";
test("booking requests a name and phone without an email field", async () => {
    const f = fixture("src/components/portal/portal-booking.tsx", "PortalBooking", { data, mode: "tenant" }, async (url) => url.endsWith("/slot-holds") ? Response.json({ data: { holdToken: "held-slot" } }) : Response.json({ data: { slots: [slot] } }));
    f.render(); await f.effects(); button(f.render(), "Elegir horario").props.onClick();
    button(f.render(), "14:00").props.onClick(); await settle(); button(f.render(), "Continuar").props.onClick();
    const tree = f.render();
    assert.ok(nodes(tree).some(e => e.props.id === "portal-first-name"));
    assert.ok(nodes(tree).some(e => e.props.inputId === "portal-phone"));
    assert.ok(!nodes(tree).some(e => e.props.id === "portal-email" || e.props.type === "email"));
});
test("availability failure is distinct from an empty day and can be retried", async () => {
    let fails = true;
    const f = fixture("src/components/portal/portal-booking.tsx", "PortalBooking", { data, mode: "tenant" }, async () => { if (fails) throw new Error("Conexión interrumpida"); return Response.json({ data: { slots: [slot] } }); });
    f.render(); await f.effects(); button(f.render(), "Elegir horario").props.onClick();
    let tree = f.render(); assert.match(text(tree), /No fue posible consultar los horarios/); assert.doesNotMatch(text(tree), /No hay horarios para este día/);
    fails = false; button(tree, "Reintentar consulta").props.onClick(); f.render(); await f.effects(); tree = f.render(); assert.ok(button(tree, "14:00")); assert.doesNotMatch(text(tree), /Conexión interrumpida/);
});

test("a late response cannot replace availability for the date the customer selected", async () => {
    const responses: Array<(response: Response) => void> = [];
    const f = fixture("src/components/portal/portal-booking.tsx", "PortalBooking", { data, mode: "tenant" }, () => new Promise(resolve => responses.push(resolve)));
    f.render(); await f.effects(); button(f.render(), "Elegir horario").props.onClick();
    const input = nodes(f.render()).find(e => e.props.id === "portal-date")!;
    input.props.onChange({ target: { value: "2026-10-17" } }); f.render(); await f.effects();
    responses[1](Response.json({ data: { slots: ["2026-10-17T15:00:00Z"] } })); await settle();
    responses[0](Response.json({ data: { slots: [slot] } })); await settle();
    const tree = f.render(); assert.ok(button(tree, "15:00")); assert.ok(!nodes(tree).some(e => e.type === "button" && text(e) === "14:00"));
});

test("booking holds once, preserves contact data when going back, and reuses its key after a network failure", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []; let fails = true;
    const f = fixture("src/components/portal/portal-booking.tsx", "PortalBooking", { data, mode: "tenant" }, async (url, init) => { calls.push({ url, init }); if (url.endsWith("/slot-holds")) return Response.json({ data: { holdToken: "held-slot" } }); if (url.endsWith("/bookings")) { if (fails) throw new Error("offline"); return Response.json({ data: { bookingToken: "a".repeat(64) } }); } return Response.json({ data: { slots: [slot] } }); });
    f.render(); await f.effects(); button(f.render(), "Elegir horario").props.onClick();
    const choose = button(f.render(), "14:00"); choose.props.onClick(); choose.props.onClick(); await settle(); assert.equal(calls.filter(c => c.url.endsWith("/slot-holds")).length, 1);
    button(f.render(), "Continuar").props.onClick(); let tree = f.render();
    nodes(tree).find(e => e.props.id === "portal-first-name")!.props.onChange({ target: { value: "Ana local" } });
    nodes(tree).find(e => e.props.inputId === "portal-phone")!.props.onChange("+525500001234");
    button(f.render(), "Horario").props.onClick(); button(f.render(), "Continuar").props.onClick(); assert.equal(nodes(f.render()).find(e => e.props.id === "portal-first-name")!.props.value, "Ana local");
    const submit = () => nodes(f.render()).find(e => e.type === "form")!.props.onSubmit({ preventDefault() {} });
    submit(); await f.jobs(); assert.match(text(f.render()), /Revisa tu conexión/);
    fails = false; submit(); await f.jobs();
    const posts = calls.filter(c => c.url.endsWith("/bookings")); assert.equal(posts.length, 2); assert.equal((posts[0].init!.headers as Record<string,string>)["Idempotency-Key"], (posts[1].init!.headers as Record<string,string>)["Idempotency-Key"]);
    assert.equal(JSON.parse(String(posts[1].init!.body)).holdToken, "held-slot"); assert.equal(JSON.parse(String(posts[1].init!.body)).firstName, "Ana local");
    tree = f.render(); assert.match(text(tree), /Solicitud recibida/); assert.ok(nodes(tree).some(e => e.props.href === `/portal/local-portal/turno/${"a".repeat(64)}`));
});

const booking = { clinicName: "Estudio local", status: "scheduled", confirmationStatus: "pending", startsAt: "2026-10-20T18:00:00Z", serviceName: "Corte", specialistName: "Sofía", cancellationReason: null, cancellable: true, timeZone: "America/Mexico_City" };
test("public cancellation requires confirmation and keeps booking details after an error", async () => {
    let posts = 0, fails = true;
    const f = fixture("src/components/portal/tenant-booking-status.tsx", "TenantBookingStatus", { tenantSlug: "local-portal", token: "a".repeat(64) }, async (_url, init) => { if (init?.method === "POST") { posts++; return fails ? Response.json({ error: { message: "Intenta de nuevo" } }, { status: 503 }) : Response.json({ data: { ...booking, status: "cancelled", cancellable: false } }); } return Response.json({ data: booking }); });
    f.render(); await f.effects(); button(f.render(), "Cancelar cita").props.onClick(); assert.equal(posts, 0);
    button(f.render(), "Conservar cita").props.onClick(); assert.equal(posts, 0);
    button(f.render(), "Cancelar cita").props.onClick(); await button(f.render(), "Sí, cancelar cita").props.onClick(); await settle();
    assert.equal(posts, 1); assert.match(text(f.render()), /Intenta de nuevo/); assert.match(text(f.render()), /Corte/); assert.ok(button(f.render(), "Conservar cita"));
    fails = false; await button(f.render(), "Sí, cancelar cita").props.onClick(); await settle(); assert.match(text(f.render()), /Cita cancelada/); assert.ok(!nodes(f.render()).some(e => e.type === "button" && text(e) === "Cancelar cita"));
});

test("classic confirmation preserves the cancellation action and optional reason behind a review step", async () => {
    const calls: unknown[][] = [];
    const f = fixture("src/components/portal/appointment-confirmation.tsx", "AppointmentConfirmation", { token: "classic-local", appointment: { id: "local", title: "Corte", startTime: new Date(slot), endTime: new Date(slot), status: "scheduled", confirmationStatus: "pending" } }, async () => Response.json({ locale: "es-MX", timeZone: "America/Mexico_City" }), { cancelAppointmentByToken: async (...args: unknown[]) => { calls.push(args); return { success: true }; } });
    f.render(); await f.effects(); button(f.render(), "Cancelar solicitud").props.onClick(); assert.equal(calls.length, 0);
    nodes(f.render()).find(e => e.props.id === "cancellation-reason")!.props.onChange({ target: { value: "Motivo de prueba" } });
    button(f.render(), "Sí, cancelar cita").props.onClick(); await f.jobs(); assert.deepEqual(calls, [["classic-local", "Motivo de prueba"]]); assert.match(text(f.render()), /Cancelada/);
});

test("classic booking keeps its server action, contact fields and reminder preference", async () => {
    const calls: Record<string, unknown>[] = [];
    const f = fixture("src/components/portal/portal-booking.tsx", "PortalBooking", { data: { ...data, remindersEnabled: true }, mode: "legacy" }, async () => { throw new Error("Unexpected public API call"); }, { getPortalAvailability: async () => ({ success: true, slots: [slot] }), bookPortalAppointment: async (input: Record<string, unknown>) => { calls.push(input); return { success: true, token: "classic-token", clientName: "Ana local" }; } });
    f.render(); await f.effects(); button(f.render(), "Elegir horario").props.onClick(); button(f.render(), "14:00").props.onClick(); button(f.render(), "Continuar").props.onClick();
    nodes(f.render()).find(e => e.props.id === "portal-first-name")!.props.onChange({ target: { value: "Ana local" } }); nodes(f.render()).find(e => e.props.inputId === "portal-phone")!.props.onChange("+525500001234");
    nodes(f.render()).find(e => e.type === "form")!.props.onSubmit({ preventDefault() {} }); await f.jobs();
    assert.equal(calls.length, 1); assert.equal(calls[0].slug, data.slug); assert.equal(calls[0].serviceId, "service-a"); assert.equal(calls[0].lastName, ""); assert.equal(calls[0].sendReminders, true);
    assert.ok(nodes(f.render()).some(e => e.props.href === "/portal/turno/classic-token"));
});

test("a disabled portal makes no availability request, and an empty day has clear guidance", async () => {
    let requests = 0;
    const disabled = fixture("src/components/portal/portal-booking.tsx", "PortalBooking", { data: { ...data, enabled: false }, mode: "tenant" }, async () => { requests++; return Response.json({}); });
    disabled.render(); await disabled.effects(); assert.equal(requests, 0); assert.match(text(disabled.render()), /Reservas no disponibles/);
    const empty = fixture("src/components/portal/portal-booking.tsx", "PortalBooking", { data, mode: "tenant" }, async () => Response.json({ data: { slots: [] } }));
    empty.render(); await empty.effects(); button(empty.render(), "Elegir horario").props.onClick(); assert.match(text(empty.render()), /Elige otra fecha o profesional/); assert.equal(button(empty.render(), "Continuar").props.disabled, true);
});


test("portal branding keeps the configured logo zoom and readable accent ink", () => {
    const mod = loadTsModule("src/components/portal/portal-frame.tsx", { "@/components/brand/brand-logo": { BrandLogo: "logo" }, "./portal-workspace.module.css": {} });
    const frame = mod.PortalFrame as (props: unknown) => React.ReactElement;
    const colors = mod.portalColors as (color: string) => Record<string, string> | undefined;
    assert.equal(colors("#ffffff")!["--portal-on-accent"], "#000000");
    assert.equal(colors("#4B5F25")!["--portal-on-accent"], "#ffffff");
    assert.equal(colors("invalid"), undefined);
    const tree = frame({ name: "Estudio local", logoUrl: "/local-logo.png", logoScale: 160, children: "Contenido" });
    assert.ok(nodes(tree).some(e => e.props.style?.["--portal-logo-scale"] === 1.6));
    const fallback = frame({ name: "Estudio local", logoScale: 160, children: "Contenido" });
    assert.ok(nodes(fallback).some(e => e.props.style?.["--portal-logo-scale"] === 1));
});
