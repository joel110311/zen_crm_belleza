import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsModule } from "./helpers/load-ts-module.mts";

function widget(available = true) {
    let cursor = 0;
    const states: unknown[] = [];
    const refs = [{ current: {} }, { current: null }];
    let refIndex = 0;
    let effect: () => () => void;
    let timer: () => void;
    const listeners = new Map<string, () => void>();
    let options: Record<string, unknown>;
    const tokens: Array<string | null> = [];
    let cleared = false;
    let removed = false;
    const script = { addEventListener: (name: string, callback: () => void) => listeners.set(name, callback), removeEventListener: (name: string) => listeners.delete(name) };
    const mod = loadTsModule("src/components/public/turnstile-widget.tsx", {
        react: {
            useRef: () => refs[refIndex++],
            useState(initial: unknown) { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], (value: unknown) => { states[i] = value; }]; },
            useEffect(callback: () => () => void) { effect = callback; },
        },
    }, {
        window: { setTimeout(callback: () => void) { timer = callback; return 1; }, clearTimeout() { cleared = true; }, turnstile: available ? { render(_element: unknown, config: Record<string, unknown>) { options = config; return "widget-id"; }, remove() { removed = true; } } : undefined },
        document: { getElementById: () => script, head: { appendChild() {} } },
    });
    const render = () => { cursor = 0; refIndex = 0; return (mod.TurnstileWidget as (props: unknown) => React.ReactElement)({ action: "signup", siteKey: "test-key", onToken: (token: string | null) => tokens.push(token) }); };
    return { render, mount: () => effect!(), timeout: () => timer!(), options: () => options!, tokens, listeners, cleaned: () => cleared && (!available || removed) };
}

test("security widget fits narrow layouts and keeps expiration/error token invalidation", () => {
    const subject = widget();
    assert.match(renderToStaticMarkup(subject.render()), /Cargando verificación/);
    const cleanup = subject.mount();
    assert.equal(subject.options().size, "compact");
    assert.equal(subject.options().action, "signup");
    (subject.options().callback as (token: string) => void)("test-token");
    (subject.options()["expired-callback"] as () => void)();
    (subject.options()["error-callback"] as () => void)();
    assert.deepEqual(subject.tokens, ["test-token", null, null]);
    assert.match(renderToStaticMarkup(subject.render()), /No se pudo cargar/);
    cleanup();
    assert.equal(subject.listeners.size, 0);
    assert.equal(subject.cleaned(), true);
});

test("a delayed script shows an error and ignores callbacks after unmount", () => {
    const subject = widget(false);
    subject.render();
    const cleanup = subject.mount();
    subject.timeout();
    assert.deepEqual(subject.tokens, [null]);
    assert.match(renderToStaticMarkup(subject.render()), /No se pudo cargar/);
    cleanup();
    subject.timeout();
    assert.deepEqual(subject.tokens, [null]);
    assert.equal(subject.cleaned(), true);
});
