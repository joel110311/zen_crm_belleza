import { readFileSync } from "node:fs";
import React from "react";
import ts from "typescript";
import { loadTsModule } from "./load-ts-module.mts";
import * as messages from "../../src/lib/inbox-messages.ts";
import * as snapshots from "../../src/lib/inbox-snapshots.ts";
import * as workspace from "../../src/lib/inbox-workspace.ts";

/** Runs the actual page render with controlled hook state; effects never perform I/O.
 * Counters measure formatting/element construction, not browser paint or network latency. */
export function inboxRenderHarness(path: string, count = 300, history = 75) {
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const page = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "InboxPage") as ts.FunctionDeclaration;
    const stateNames: string[] = [];
    for (const statement of page.body!.statements) if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) if (declaration.initializer && ts.isCallExpression(declaration.initializer) && declaration.initializer.expression.getText(source) === "useState") {
            stateNames.push((declaration.name as ts.ArrayBindingPattern).elements[0].getText(source));
        }
    }
    const mocks: Record<string, unknown> = {};
    const inert = () => null;
    for (const statement of source.statements) if (ts.isImportDeclaration(statement)) {
        const exports: Record<string, unknown> = { __esModule: true, default: inert };
        const bindings = statement.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) exports[item.propertyName?.text || item.name.text] = inert;
        mocks[(statement.moduleSpecifier as ts.StringLiteral).text] = exports;
    }
    const records = Array.from({ length: history }, (_, index) => ({ id: `m-${index}`, content: `Mensaje ${index}`, direction: index % 2 ? "inbound" : "outbound", type: "text", sourceType: "wuzapi", senderType: "bot", senderId: null, createdAt: new Date(1_700_000_000_000 + index * 60_000) }));
    const conversations = Array.from({ length: count }, (_, index) => ({ id: `c-${index}`, contact: { id: `contact-${index}`, name: `Cliente ${index}`, phone: `5500${index}`, avatarUrl: null }, messages: [records[0]], updatedAt: records[0].createdAt, serverUpdatedAt: records[0].createdAt, sourceType: "wuzapi", botActive: true, status: "active", assignedUserId: null }));
    const state: Record<string, unknown> = { conversations, messages: records, selectedChat: conversations[0], unreadCounts: {}, teamUsers: [], whatsAppSession: { configured: true, connected: true, loggedIn: true } };
    let stateIndex = 0, memoIndex = 0, refIndex = 0;
    const memoSlots: { deps: unknown[]; value: unknown }[] = [], refs: { current: unknown }[] = [];
    const counters = { phoneFormats: 0, dateFormats: 0 };
    const memo = (factory: () => unknown, deps: unknown[]) => {
        const index = memoIndex++, previous = memoSlots[index];
        if (previous && deps.length === previous.deps.length && deps.every((value, key) => Object.is(value, previous.deps[key]))) return previous.value;
        const value = factory(); memoSlots[index] = { deps, value }; return value;
    };
    const hooks = { ...React,
        useState: (initial: unknown) => { const name = stateNames[stateIndex++]; if (!(name in state)) state[name] = typeof initial === "function" ? initial() : initial; return [state[name], (value: unknown) => { state[name] = typeof value === "function" ? value(state[name]) : value; }]; },
        useRef: (current: unknown) => refs[refIndex] || (refs[refIndex] = { current }),
        useMemo: memo, useCallback: (callback: unknown, deps: unknown[]) => memo(() => callback, deps), useEffect: inert,
    };
    // Ref indexes are advanced separately so every render keeps the same identities.
    hooks.useRef = (current: unknown) => { const index = refIndex++; return refs[index] || (refs[index] = { current }); };
    const operation = { locale: "es-MX", timeZone: "America/Mexico_City", phoneDefaultCountry: "MX", formatPhone: (value: string) => value };
    Object.assign(mocks, {
        react: { __esModule: true, ...hooks, default: hooks },
        "next/dynamic": { __esModule: true, default: () => inert },
        "next/navigation": { usePathname: () => "/t/test/inbox", useSearchParams: () => new URLSearchParams() },
        "next-auth/react": { useSession: () => ({ data: { user: { id: "owner", email: "owner@example.invalid", name: "Owner" } } }) },
        "@/lib/inbox-messages": messages, "@/lib/inbox-snapshots": snapshots, "@/lib/inbox-workspace": workspace,
        "@/components/layout/workspace-access-context": { useWorkspaceAccess: () => ({ readOnly: false }) },
        "@/components/shared/use-operation-context": { useOperationContext: () => operation },
        "@/lib/permissions": { hasPermission: () => true },
        "@/lib/operation-context": { buildOperationContext: () => operation, formatPhoneForDisplay: (value: string) => { counters.phoneFormats++; return value; } },
        "@/lib/operation-dates": { getOperationDateKey: () => { counters.dateFormats++; return "2026-10-16"; }, getOperationTodayKey: () => "2026-10-16", formatDateInOperationZone: () => "16 oct", formatTimeInOperationZone: () => "12:00" },
        "@/lib/utils": { cn: (...values: unknown[]) => values.filter(Boolean).join(" ") },
        "@/components/inbox/inbox.module.css": { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) },
        "@/lib/tenant-request-routing": { tenantSlugFromPath: () => "test", tenantDashboardPath: (_slug: string, route: string) => route },
        "@/lib/inbox-drafts": { INBOX_DRAFT_STORAGE_KEY: "drafts" },
    });
    const component = loadTsModule(path, mocks);
    return { state, counters, render: () => { stateIndex = 0; memoIndex = 0; refIndex = 0; counters.phoneFormats = 0; counters.dateFormats = 0; return (component.default as () => React.ReactElement)(); } };
}
