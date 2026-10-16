import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { readContactAiState, contactAiStateJson } from "../src/lib/ai/contact-state.ts";

test("retiring Pipeline preserves current capture state, UTC timestamps, old opportunities and historical tags; migration can be retried", async () => {
    const name = "20261016000000_contact_ai_state/migration.sql";
    const sql = await readFile(new URL(`../prisma/tenant-migrations/${name}`, import.meta.url), "utf8");
    assert.equal(sql, await readFile(new URL(`../prisma/migrations/${name}`, import.meta.url), "utf8"));
    assert.equal(sql, await readFile(new URL("../prisma/legacy-runtime-migrations/20261016_contact_ai_state.sql", import.meta.url), "utf8"));
    const db = new PGlite();
    try {
        await db.exec(`CREATE TABLE "Contact" (id text primary key, tags text[] NOT NULL);
            CREATE TABLE "Deal" (id text primary key, "contactId" text, "updatedAt" timestamp);
            CREATE TABLE "LeadIntelligence" (id text primary key, "dealId" text, score integer, "pendingCaptureField" text, "capturedName" text, "askedForEmailAt" timestamp);
            CREATE TABLE "Tag" (id text primary key, name text);
            CREATE TABLE "DealTag" ("dealId" text, "tagId" text);
            INSERT INTO "Contact" VALUES ('a', ARRAY['Cliente']), ('b', ARRAY['VIP']);
            INSERT INTO "Deal" VALUES ('old','a','2026-10-01'), ('latest','a','2026-10-15');
            INSERT INTO "LeadIntelligence" VALUES ('old-state','old',20,'name',NULL,NULL), ('latest-state','latest',75,'email','Ana Torres','2026-10-15 12:30:00');
            INSERT INTO "Tag" VALUES ('1','Cliente'),('2','Histórica');
            INSERT INTO "DealTag" VALUES ('old','1'),('latest','2');`);
        await db.exec(sql);
        const initial = (await db.query<{ id: string; tags: string[]; aiState: unknown }>('SELECT * FROM "Contact" ORDER BY id')).rows;
        const state = readContactAiState(initial[0].aiState);
        assert.equal(state.score, 75); assert.equal(state.pendingCaptureField, "email"); assert.equal(state.capturedName, "Ana Torres");
        assert.equal(state.askedForEmailAt?.toISOString(), "2026-10-15T12:30:00.000Z");
        assert.deepEqual(initial[0].tags, ["Cliente", "Histórica"]); assert.equal(initial[1].aiState, null);
        await db.exec(sql);
        assert.deepEqual((await db.query('SELECT * FROM "Contact" ORDER BY id')).rows, initial);
        assert.equal((await db.query('SELECT * FROM "Deal"')).rows.length, 2);
        assert.equal((await db.query('SELECT * FROM "LeadIntelligence"')).rows.length, 2);
        assert.deepEqual(readContactAiState(contactAiStateJson(state)), state);
    } finally { await db.close(); }
});
