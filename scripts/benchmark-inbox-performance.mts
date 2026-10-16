import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import vm from "node:vm";
import ts from "typescript";
import type { Message } from "../src/lib/inbox-messages.ts";

// Compare the actual functions from the pre-optimization commit, without mounting
// the app, touching a database, or substituting a simplified baseline algorithm.
const ref = process.argv[2] || "2994f387ae2d93bc4a81ad31a65d63f6013f1c27";
const source = execFileSync("git", ["show", `${ref}:src/app/dashboard/inbox/page.tsx`], { encoding: "utf8" });
const names = ["isTemporaryMessage", "normalizeComparableMediaUrl", "areLikelySameMessage", "replaceOptimisticMessage", "mergeFetchedMessages", "collapseMessageDuplicates"];
const parsed = ts.createSourceFile("baseline.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = parsed.statements.filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text || ""));
assert.equal(functions.length, names.length, "Baseline must contain the original message functions");
const code = functions.map((node) => node.getText(parsed)).join("\n") + `\nexport { ${names.join(",")} };`;
function load(code: string) {
    const compiled = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    // Both versions get the same module closure and built-ins. Top-level VM globals
    // would add lookup overhead that does not exist in the compiled application.
    return vm.runInNewContext(`(function(exports) { ${compiled}; return exports; })({})`,
        { Date, URL, Map, Set }) as Record<string, (messages: Message[], incoming?: Message[]) => Message[]>;
}
const baseline = load(code);
const optimized = load(readFileSync("src/lib/inbox-messages.ts", "utf8"));

let randomState = 0x16_10_2026;
const random = (maximum: number) => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState % maximum;
};
// Differential checks mix repeated IDs, pending sends, identical real sends,
// media and arrival order before any performance result is accepted.
for (let sample = 0; sample < 600; sample++) {
    const messages: Message[] = [];
    for (let index = 0; index < 60; index++) {
        const previous = messages.length && random(3) === 0 ? messages[random(messages.length)] : null;
        messages.push(previous ? { ...previous, id: random(2) ? previous.id : `${random(2) ? "temp-" : "saved-"}${random(12)}`, status: random(2) ? "read" : "sent" } : {
            id: `${random(4) === 0 ? "temp-" : "saved-"}${random(16)}`, content: `Texto ${random(4)}`,
            createdAt: new Date(1_700_000_000_000 + random(60) * 1000), direction: random(2) ? "inbound" : "outbound",
            senderId: null, senderType: random(2) ? "bot" : "human", type: random(2) ? "text" : "image",
            sourceType: random(2) ? "meta" : "wuzapi", sourceId: `number-${random(2)}`,
            mediaUrl: random(2) ? null : `/photo-${random(3)}.jpg`,
        });
    }
    assert.equal(JSON.stringify(optimized.collapseMessageDuplicates(messages)), JSON.stringify(baseline.collapseMessageDuplicates(messages)), `Differential collapse ${sample}`);
    assert.equal(JSON.stringify(optimized.mergeFetchedMessages(messages.slice(0, 40), messages.slice(40))), JSON.stringify(baseline.mergeFetchedMessages(messages.slice(0, 40), messages.slice(40))), `Differential merge ${sample}`);
}

function fixture(size: number): Message[] {
    return Array.from({ length: size }, (_, index) => ({
        id: `message-${index}`, content: `Mensaje de prueba ${index % 17}`,
        createdAt: new Date(1_700_000_000_000 + index * 17_000),
        direction: index % 3 ? "inbound" : "outbound", senderId: null,
        type: "text", sourceType: "wuzapi", senderType: index % 3 ? "contact" : "bot",
    }));
}
function median(operation: () => unknown) {
    for (let index = 0; index < 4; index++) operation();
    const samples = Array.from({ length: 21 }, () => {
        const start = performance.now(); operation(); return performance.now() - start;
    }).sort((a, b) => a - b);
    return samples[Math.floor(samples.length / 2)];
}
const rows: Record<string, unknown>[] = [];
for (const size of [75, 1000, 5000]) {
    const messages = fixture(size);
    const incoming = messages.slice(-5).map((message) => ({ ...message, status: "read" }));
    incoming.push({ ...messages[size - 1], id: "new-message", createdAt: new Date(messages[size - 1].createdAt.getTime() + 17_000) });
    for (const [operation, before, after] of [
        ["collapse", () => baseline.collapseMessageDuplicates(messages), () => optimized.collapseMessageDuplicates(messages)],
        ["merge", () => baseline.mergeFetchedMessages(messages, incoming), () => optimized.mergeFetchedMessages(messages, incoming)],
    ] as const) {
        assert.equal(JSON.stringify(after()), JSON.stringify(before()), `Same result: ${operation}/${size}`);
        const beforeMs = median(before), afterMs = median(after);
        assert.ok(afterMs < beforeMs, `Keep only a measured improvement: ${operation}/${size}`);
        rows.push({ operation, messages: size, beforeMs: +beforeMs.toFixed(4), afterMs: +afterMs.toFixed(4), speedup: +(beforeMs / afterMs).toFixed(2), identicalResult: true });
    }
}
console.log(JSON.stringify({ baseline: ref, runtime: process.version, measurement: "Local Node CPU only; not end-to-end browser latency", differentialCases: 1200, samplesPerCase: 21, rows }, null, 2));
