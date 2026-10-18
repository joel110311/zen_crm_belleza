import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsModule } from "./helpers/load-ts-module.mts";

function recovery(token: string | null, result: { updated?: boolean; error?: string } = { updated: true }) {
    const states: unknown[] = [];
    let cursor = 0;
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const submitting = { current: false };
    const mod = loadTsModule("src/app/reset-password/reset-password-form.tsx", {
        react: { useRef: () => submitting, useState(initial: unknown) { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], (value: unknown) => { states[i] = value; }]; } },
        "next/navigation": { useSearchParams: () => new URLSearchParams(token ? { token } : {}) },
        "next/link": "a",
        "@/components/public/password-field": { PasswordField: () => null },
        "@/components/public/auth-workspace.module.css": { default: {} },
    }, {
        FormData: class { values: Record<string, string>; constructor(values: Record<string, string>) { this.values = values; } get(name: string) { return this.values[name]; } },
        fetch: async (url: string, init: RequestInit) => { requests.push({ url, body: JSON.parse(String(init.body)) }); return Response.json(result, { status: result.error ? 400 : 200 }); },
    });
    const render = () => { cursor = 0; return (mod.ResetPasswordForm as () => React.ReactElement)(); };
    return { render, requests };
}

function form(node: React.ReactNode): React.ReactElement<{ onSubmit: (event: unknown) => Promise<void> }> | undefined {
    if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return;
    if (node.type === "form") return node as ReturnType<typeof form>;
    for (const child of React.Children.toArray(node.props.children)) { const found = form(child); if (found) return found; }
}
const event = (confirmPassword: string) => ({ preventDefault() {}, currentTarget: { password: "test-password-123", confirmPassword } });

test("missing recovery token shows the request-link route instead of an unusable form", () => {
    const subject = recovery(null);
    const tree = subject.render();
    assert.equal(form(tree), undefined);
    assert.match(renderToStaticMarkup(tree), /href="\/forgot-password"/);
    assert.equal(subject.requests.length, 0);
});

test("password mismatch stays local and offers an actionable error", async () => {
    const subject = recovery("test-token");
    await form(subject.render())!.props.onSubmit(event("different-password"));
    assert.equal(subject.requests.length, 0);
    assert.match(renderToStaticMarkup(subject.render()), /Las contraseñas no coinciden/);
});

test("recovery keeps the endpoint contract and blocks repeated submits while pending", async () => {
    const subject = recovery("test-token");
    const handler = form(subject.render())!.props.onSubmit;
    const first = handler(event("test-password-123"));
    await handler(event("test-password-123"));
    const pendingTree = subject.render();
    assert.match(renderToStaticMarkup(pendingTree), /aria-busy="true"/);
    await form(pendingTree)!.props.onSubmit(event("test-password-123"));
    await first;
    assert.equal(subject.requests.length, 1);
    assert.equal(subject.requests[0].url, "/api/public/password-reset/confirm");
    assert.equal(subject.requests[0].body.token, "test-token");
    assert.equal(subject.requests[0].body.password, "test-password-123");
    assert.equal(form(subject.render()), undefined);
    assert.match(renderToStaticMarkup(subject.render()), /Contraseña actualizada/);
});

test("invalid recovery response leaves the form available and displays the server error", async () => {
    const subject = recovery("expired-token", { error: "Este enlace venció. Solicita otro." });
    await form(subject.render())!.props.onSubmit(event("test-password-123"));
    assert.ok(form(subject.render()));
    assert.match(renderToStaticMarkup(subject.render()), /Este enlace venció/);
    assert.match(renderToStaticMarkup(subject.render()), /role="alert"/);
});
