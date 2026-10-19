import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { loadTsModule } from "./helpers/load-ts-module.mts";

type Element = React.ReactElement<Record<string, unknown>>;
function elements(node: React.ReactNode): Element[] {
    if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return [];
    return [node as Element, ...React.Children.toArray(node.props.children).flatMap(elements)];
}
function formHarness(signup: boolean) {
    const states: unknown[] = [], refs: { current: unknown }[] = [];
    let cursor = 0, refCursor = 0;
    const requests: { body: Record<string, unknown>; resolve: (response: Response) => void; reject: (error: Error) => void }[] = [];
    const subject = loadTsModule(signup ? "src/app/signup/signup-form.tsx" : "src/app/forgot-password/forgot-password-form.tsx", {
        react: {
            useState(initial: unknown) { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], (value: unknown) => { states[i] = typeof value === "function" ? value(states[i]) : value; }]; },
            useRef(initial: unknown) { const i = refCursor++; return refs[i] ||= { current: initial }; },
            useCallback: (callback: unknown) => callback,
            useEffect() {},
        },
        "next/link": "a", "@/components/public/auth-workspace.module.css": { default: {} },
        "@/components/public/password-field": { PasswordField: "test-password" },
        "@/components/public/turnstile-widget": { TurnstileWidget: "test-captcha" },
    }, {
        crypto, Error,
        window: { location: { search: "" } },
        FormData: class { values: Record<string, string>; constructor(values: Record<string, string>) { this.values = values; } get(name: string) { return this.values[name]; } },
        fetch: (_url: string, init: RequestInit) => new Promise<Response>((resolve, reject) => requests.push({ body: JSON.parse(String(init.body)), resolve, reject })),
    });
    return { requests, render: () => { cursor = 0; refCursor = 0; return elements((subject[signup ? "SignupForm" : "ForgotPasswordForm"] as (props: unknown) => React.ReactNode)({ turnstileSiteKey: "test-key" })); } };
}
const submitEvent = { preventDefault() {}, currentTarget: { name: "Prueba", email: "qa@example.invalid", password: "fixture-only-password", legalAccepted: "on" } };
const captcha = (tree: Element[]) => tree.find(e => e.type === "test-captcha")!;
const submit = (tree: Element[]) => tree.find(e => e.type === "form")!.props.onSubmit as (event: unknown) => Promise<void>;

for (const signup of [true, false]) {
    const name = signup ? "signup" : "password recovery";
    test(`${name} clears a missing-challenge message on retry without hiding a server error`, async () => {
        const subject = formHarness(signup);
        await submit(subject.render())(submitEvent);
        assert.ok(subject.render().some(e => e.props.role === "alert" && e.props.children === "Completa la verificación de seguridad para continuar."));
        (captcha(subject.render()).props.onToken as (token: string | null) => void)(null);
        assert.ok(!subject.render().some(e => e.props.role === "alert"));
        (captcha(subject.render()).props.onToken as (token: string | null) => void)("first-token");
        const pending = submit(subject.render())(submitEvent);
        subject.requests[0].resolve(Response.json({ error: "No fue posible enviar el correo." }, { status: 400 }));
        await pending;
        (captcha(subject.render()).props.onToken as (token: string | null) => void)(null);
        assert.ok(subject.render().some(e => e.props.role === "alert" && e.props.children === "No fue posible enviar el correo."));
    });
    test(`${name} renews consumed verification after a rejected request and blocks immediate duplicate submissions`, async () => {
        const subject = formHarness(signup);
        (captcha(subject.render()).props.onToken as (token: string) => void)("first-token");
        const tree = subject.render(), oldKey = captcha(tree).key, handler = submit(tree);
        const first = handler(submitEvent); await handler(submitEvent);
        assert.equal(subject.requests.length, 1);
        subject.requests[0].resolve(Response.json({ error: "No fue posible enviar el correo." }, { status: 400 })); await first;
        const failed = subject.render(); assert.notEqual(captcha(failed).key, oldKey);
        assert.ok(failed.some(e => e.props.role === "alert"));
        await submit(failed)(submitEvent); assert.equal(subject.requests.length, 1, "cannot reuse the consumed token");
        (captcha(failed).props.onToken as (token: string) => void)("new-token");
        const retry = submit(subject.render())(submitEvent);
        assert.equal(subject.requests[1].body.captchaToken, "new-token");
        subject.requests[1].resolve(Response.json({ message: "Revisa tu correo." }, { status: 202 })); await retry;
        assert.ok(subject.render().some(e => e.props.role === "status"));
        assert.ok(!subject.render().some(e => e.type === "form"));
        if (signup) {
            assert.ok(subject.render().some(e => e.type === "strong" && e.props.children === "Solicitud recibida"));
            assert.ok(subject.render().some(e => e.type === "p" && typeof e.props.children === "string" && e.props.children.includes("Registrarte de nuevo no crea otro negocio")));
            assert.ok(!subject.render().some(e => e.type === "strong" && e.props.children === "Revisa tu correo"));
        }
        if (!signup) {
            assert.ok(subject.render().some(e => e.type === "strong" && e.props.children === "Solicitud recibida"));
            assert.ok(subject.render().some(e => e.props.href === "/signup"));
        }
    });
    test(`${name} recovers from a lost connection with a fresh challenge and keeps local validation`, async () => {
        const subject = formHarness(signup); await submit(subject.render())(submitEvent); assert.equal(subject.requests.length, 0);
        (captcha(subject.render()).props.onToken as (token: string) => void)("first-token");
        const tree = subject.render(), oldKey = captcha(tree).key;
        const first = submit(tree)(submitEvent); subject.requests[0].reject(new Error("Sin conexión")); await first;
        const failed = subject.render(); assert.notEqual(captcha(failed).key, oldKey);
        assert.ok(failed.some(e => e.props.role === "alert" && e.props.children === "Sin conexión"));
        assert.equal(failed.find(e => e.type === "fieldset")?.props.disabled, false);
    });
}
