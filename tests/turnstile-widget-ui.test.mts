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
    let scriptPresent = true, scriptRemoved = 0, appended = 0;
    const script = { addEventListener: (name: string, callback: () => void) => listeners.set(name, callback), removeEventListener: (name: string) => listeners.delete(name), remove() { scriptPresent = false; scriptRemoved++; } };
    const mod = loadTsModule("src/components/public/turnstile-widget.tsx", {
        react: {
            useRef: () => refs[refIndex++],
            useState(initial: unknown) { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], (value: unknown) => { states[i] = typeof value === "function" ? value(states[i]) : value; }]; },
            useEffect(callback: () => () => void) { effect = callback; },
        },
    }, {
        window: { setTimeout(callback: () => void) { timer = callback; return 1; }, clearTimeout() { cleared = true; }, turnstile: available ? { render(_element: unknown, config: Record<string, unknown>) { options = config; return "widget-id"; }, remove() { removed = true; } } : undefined },
        document: { getElementById: () => scriptPresent ? script : null, createElement: () => script, head: { appendChild() { scriptPresent = true; appended++; } } },
    });
    const render = () => { cursor = 0; refIndex = 0; return (mod.TurnstileWidget as (props: unknown) => React.ReactElement)({ action: "signup", siteKey: "test-key", onToken: (token: string | null) => tokens.push(token) }); };
    return { render, mount: () => effect!(), timeout: () => timer!(), options: () => options!, tokens, listeners, scripts: () => ({ removed: scriptRemoved, appended }), cleaned: () => cleared && (!available || removed) };
}

test("security widget fits narrow layouts and keeps expiration/error token invalidation", () => {
    const subject = widget();
    assert.match(renderToStaticMarkup(subject.render()), /Cargando verificación/);
    const cleanup = subject.mount();
    assert.equal(subject.options().size, "compact");
    assert.equal(subject.options().action, "signup");
    assert.equal(subject.options().retry, "never");
    (subject.options().callback as (token: string) => void)("test-token");
    (subject.options()["expired-callback"] as () => void)();
    (subject.options()["error-callback"] as () => void)();
    assert.deepEqual(subject.tokens, ["test-token", null, null]);
    assert.match(renderToStaticMarkup(subject.render()), /No se pudo completar/);
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

function findRetry(node: React.ReactNode): React.ReactElement<{ onClick: () => void }> | undefined {
    if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return;
    if (node.type === "button") return node as ReturnType<typeof findRetry>;
    return React.Children.toArray(node.props.children).map(findRetry).find(Boolean);
}

test("failed verification can restart the widget without reloading and ignores retired callbacks", () => {
    const subject = widget(); subject.render(); const cleanup = subject.mount();
    const retired = subject.options();
    (retired["error-callback"] as () => void)();
    const retry = findRetry(subject.render())!; assert.ok(retry);
    retry.props.onClick(); cleanup();
    subject.render(); subject.mount();
    assert.notEqual(subject.options(), retired);
    const count = subject.tokens.length;
    (retired.callback as (token: string) => void)("retired-token");
    (retired["expired-callback"] as () => void)();
    (retired["error-callback"] as () => void)();
    assert.equal(subject.tokens.length, count);
    (subject.options().callback as (token: string) => void)("fresh-token");
    assert.equal(subject.tokens.at(-1), "fresh-token");
    assert.doesNotMatch(renderToStaticMarkup(subject.render()), /No se pudo completar/);
});

for (const code of ["300030", "600010"]) {
    test(`a rejected browser (${code}) gets a visible explanation and a manual retry`, () => {
        const subject = widget(); subject.render(); subject.mount();
        (subject.options()["error-callback"] as (code: string) => void)(code);
        const html = renderToStaticMarkup(subject.render());
        assert.match(html, /No pudimos verificar este navegador/);
        assert.match(html, /otro navegador o en tu teléfono/);
        assert.match(html, /hidden=""/);
        assert.ok(findRetry(subject.render()));
        assert.deepEqual(subject.tokens, [null]);
    });
}

test("expired and timed-out challenges discard the token and offer recovery", () => {
    const subject = widget(); subject.render(); subject.mount();
    assert.equal(subject.options()["refresh-expired"], "manual");
    assert.equal(subject.options()["refresh-timeout"], "manual");
    for (const callback of ["expired-callback", "timeout-callback"]) {
        (subject.options().callback as (token: string) => void)("fresh-token");
        (subject.options()[callback] as () => void)();
        assert.equal(subject.tokens.at(-1), null);
        assert.match(renderToStaticMarkup(subject.render()), /La verificación venció/);
        assert.ok(findRetry(subject.render()));
    }
});

test("a configuration failure does not suggest that the password is wrong", () => {
    const subject = widget(); subject.render(); subject.mount();
    (subject.options()["error-callback"] as (code: string) => void)("110200");
    const html = renderToStaticMarkup(subject.render());
    assert.match(html, /contacta a soporte/);
    assert.doesNotMatch(html, /contraseña/);
    assert.deepEqual(subject.tokens, [null]);
});

test("retry replaces a failed script load instead of waiting forever for an old load event", () => {
    const subject = widget(false); subject.render(); const cleanup = subject.mount(); subject.timeout();
    findRetry(subject.render())!.props.onClick(); cleanup();
    subject.render(); subject.mount();
    assert.deepEqual(subject.scripts(), { removed: 1, appended: 1 });
    assert.match(renderToStaticMarkup(subject.render()), /Cargando verificación/);
    assert.ok(subject.listeners.has("load"));
});
