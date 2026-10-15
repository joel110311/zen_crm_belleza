import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsModule } from "./helpers/load-ts-module.mts";

function panel(readOnly: boolean, fails = false) {
    const states: unknown[] = [];
    let cursor = 0;
    let load: () => Promise<void>;
    const requests: string[] = [];
    const location = { href: "" };
    const mod = loadTsModule("src/components/settings/google-calendar-panel.tsx", {
        react: {
            useState(initial: unknown) {
                const index = cursor++;
                if (!(index in states)) states[index] = initial;
                return [states[index], (next: unknown) => { states[index] = typeof next === "function" ? next(states[index]) : next; }];
            },
            useMemo: (compute: () => unknown) => compute(),
            useCallback: (callback: () => Promise<void>) => { load = callback; return callback; },
            useEffect() {},
        },
        "@/components/layout/workspace-access-context": { useWorkspaceAccess: () => ({ readOnly }) },
        "@/components/shared/use-operation-context": { useOperationContext: () => ({}) },
        "@/components/ui/use-toast": { useToast: () => ({ toast() {} }) },
        "@/components/ui/button": { Button: "button" },
        "@/components/ui/input": { Input: "input" },
        "@/components/ui/label": { Label: "label" },
        "@/components/ui/switch": { Switch: "button" },
        "@/components/ui/badge": { Badge: "span" },
        "@/components/ui/card": Object.fromEntries(["Card", "CardHeader", "CardContent", "CardTitle", "CardDescription"].map(name => [name, "div"])),
    }, {
        window: { location },
        fetch: async (_url: string, init?: RequestInit) => {
            requests.push(init?.method || "GET");
            return fails ? Response.json({ error: "unavailable" }, { status: 503 }) : Response.json({ configured: true, connected: true, sources: [], specialistCount: 0, maxSpecialists: 5 });
        },
    });
    const render = () => { cursor = 0; return (mod.GoogleCalendarPanel as () => React.ReactElement)(); };
    render();
    return { render, load: () => load!(), requests, location };
}

function buttons(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
    if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return [];
    return [ ...(node.type === "button" ? [node as React.ReactElement<Record<string, unknown>>] : []), ...React.Children.toArray(node.props.children).flatMap(buttons) ];
}

test("read-only calendar reads status without discovering, connecting, syncing or disconnecting", async () => {
    const subject = panel(true);
    await subject.load();
    assert.deepEqual(subject.requests, ["GET"]);
    const actions = buttons(subject.render()).filter(button => typeof button.props.onClick === "function");
    assert.equal(actions.length, 4);
    for (const button of actions) {
        assert.equal(button.props.disabled, true);
        await (button.props.onClick as () => Promise<void>)();
    }
    assert.deepEqual(subject.requests, ["GET"]);
    assert.equal(subject.location.href, "");
});

test("active calendar keeps the existing discovery and synchronization behavior", async () => {
    const subject = panel(false);
    await subject.load();
    assert.deepEqual(subject.requests, ["GET", "POST"]);
    const actions = buttons(subject.render()).filter(button => typeof button.props.onClick === "function");
    assert.ok(actions.every(button => !button.props.disabled));
    await (actions[2].props.onClick as () => Promise<void>)();
    assert.deepEqual(subject.requests, ["GET", "POST", "POST"]);
});

test("calendar load failure displays retry instead of an unconfigured account", async () => {
    const subject = panel(false, true);
    await subject.load();
    const html = renderToStaticMarkup(subject.render());
    assert.match(html, /role="alert"/);
    assert.match(html, /Reintentar consulta/);
    assert.doesNotMatch(html, /Conectar cuenta Google|aun no esta habilitada/);
});
