import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { loadTsModule } from "./helpers/load-ts-module.mts";

type Element = React.ReactElement<Record<string, unknown>>;
function nodes(node: React.ReactNode): Element[] {
    if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return [];
    return [node as Element, ...React.Children.toArray(node.props.children).flatMap(nodes)];
}
function team(readOnly: boolean) {
    const states: unknown[] = []; let cursor = 0; let load: () => Promise<void>;
    const requests: string[] = [];
    const mod = loadTsModule("src/components/tenant/team-invitation-manager.tsx", {
        react: { useState(initial: unknown) { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], (next: unknown) => { states[i] = typeof next === "function" ? next(states[i]) : next; }]; }, useMemo: (fn: () => unknown) => fn(), useCallback: (fn: () => Promise<void>) => { load = fn; return fn; }, useEffect() {} },
        "@/components/layout/workspace-access-context": { useWorkspaceAccess: () => ({ readOnly }) },
        "@/components/ui/button": { Button: "button" }, "@/components/ui/input": { Input: "input" },
    }, { fetch: async (_url: string, init?: RequestInit) => { requests.push(init?.method || "GET"); return Response.json({ data: { memberships: [{ id: "member-a", role: "RECEPTION", isActive: true, user: { name: "Ana", email: "ana@example.invalid" } }], invitations: [{ id: "invite-a", status: "PENDING", role: "RECEPTION", email: "other@example.invalid" }], seats: { active: 1, pending: 1, available: 3, limit: 5 } } }); } });
    const render = () => { cursor = 0; return nodes((mod.TeamInvitationManager as (props: unknown) => React.ReactNode)({ tenantSlug: "studio", enabled: true })); };
    render(); return { render, requests, load: () => load!() };
}
test("read-only team can load members but cannot invite, revoke or reactivate", async () => {
    const subject = team(true); await subject.load(); const tree = subject.render();
    assert.equal(tree.find(e => e.type === "fieldset")!.props.disabled, true);
    await (tree.find(e => e.type === "form")!.props.onSubmit as (e: unknown) => Promise<void>)({ preventDefault() {} });
    for (const button of tree.filter(e => e.type === "button" && typeof e.props.onClick === "function")) {
        assert.equal(button.props.disabled, true); await (button.props.onClick as () => Promise<void>)();
    }
    assert.deepEqual(subject.requests, ["GET"]);
});
test("active team exposes invitation entry without asking the administrator to set another person's password", async () => {
    const subject = team(false); await subject.load(); const tree = subject.render();
    assert.equal(tree.find(e => e.type === "fieldset")!.props.disabled, false);
    assert.ok(tree.some(e => e.type === "input" && e.props.type === "email"));
    assert.ok(!tree.some(e => e.type === "input" && e.props.type === "password"));
});
