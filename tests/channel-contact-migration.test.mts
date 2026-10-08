import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { loadTsModule } from "./helpers/load-ts-module.mts";
import * as phone from "../src/lib/phone.ts";
import * as csv from "../src/lib/csv.ts";

test("migration splits shared contacts, retaining message IDs, conversations and business relations", async () => {
    const db = new PGlite();
    try {
        await db.exec(`CREATE TABLE "Contact" (
            "id" TEXT PRIMARY KEY, "phone" TEXT NOT NULL, "name" TEXT,"lastName" TEXT,"email" TEXT,"company" TEXT,"role" TEXT,
            "tags" TEXT[] NOT NULL DEFAULT '{}', "status" TEXT DEFAULT 'lead',"createdAt" TIMESTAMP DEFAULT NOW(),"updatedAt" TIMESTAMP DEFAULT NOW(),
            "bulkCampaignOptOutAt" TIMESTAMP,"bulkCampaignOptOutReason" TEXT);
            CREATE UNIQUE INDEX "Contact_phone_key" ON "Contact"("phone");
            CREATE TABLE "Conversation" ("id" TEXT PRIMARY KEY,"contactId" TEXT REFERENCES "Contact"("id"),"source_type" TEXT);
            CREATE TABLE "Message" ("id" TEXT PRIMARY KEY,"conversationId" TEXT REFERENCES "Conversation"("id"),"content" TEXT);
            CREATE TABLE "BulkCampaignRecipient" ("id" TEXT PRIMARY KEY,"contactId" TEXT REFERENCES "Contact"("id"),"conversationId" TEXT REFERENCES "Conversation"("id"));
            CREATE TABLE "Appointment" ("id" TEXT PRIMARY KEY,"contactId" TEXT REFERENCES "Contact"("id"));
            INSERT INTO "Contact" ("id","phone","name","bulkCampaignOptOutAt") VALUES ('shared','524771234567','Joel',NOW()),('qr-only','524771111111','QR',NULL),('api-only','524772222222','API',NULL);
            INSERT INTO "Conversation" VALUES ('qr','shared','wuzapi'),('api','shared','meta'),('api-history','api-only','meta'),('qr-history','qr-only','wuzapi');
            INSERT INTO "Message" VALUES ('qr-message','qr','hola'),('api-message','api','adiós');
            INSERT INTO "Appointment" VALUES ('appointment','shared');
            INSERT INTO "BulkCampaignRecipient" VALUES ('recipient','shared','api');`);
        const migration = await fs.readFile("prisma/tenant-migrations/20261008000000_contacts_by_channel/migration.sql", "utf8");
        await db.exec(migration);
        const contacts = (await db.query<{ id: string; phone: string; source_type: string; name: string }>('SELECT * FROM "Contact"')).rows;
        assert.equal(contacts.length, 4);
        const api = contacts.find(c => c.phone === "524771234567" && c.source_type === "meta")!;
        assert.notEqual(api.id, "shared"); assert.equal(api.name, "Joel");
        assert.equal(contacts.find(c => c.id === "api-only")!.source_type, "meta");
        const chats = (await db.query<{ id: string; contactId: string }>('SELECT * FROM "Conversation"')).rows;
        assert.equal(chats.find(c => c.id === "qr")!.contactId, "shared");
        assert.equal(chats.find(c => c.id === "api")!.contactId, api.id);
        assert.equal((await db.query<{ contactId: string }>('SELECT * FROM "Appointment"')).rows[0].contactId, "shared");
        assert.equal((await db.query<{ contactId: string }>('SELECT * FROM "BulkCampaignRecipient"')).rows[0].contactId, api.id);
        assert.equal((await db.query('SELECT * FROM "Message"')).rows.length, 2);
        assert.equal((await db.query<{ bulkCampaignOptOutAt: unknown }>('SELECT "bulkCampaignOptOutAt" FROM "Contact" WHERE "id"=$1', [api.id])).rows[0].bulkCampaignOptOutAt !== null, true);
        await assert.rejects(db.exec(`INSERT INTO "Contact" ("id","phone","source_type") VALUES ('duplicate','524771234567','meta')`), /unique/i);
        assert.equal(await fs.readFile("prisma/legacy-runtime-migrations/20261008_contacts_by_channel.sql", "utf8"), migration);
    } finally { await db.close(); }
});

test("contact channel resolver reuses only same-channel phone aliases and creates an independent API profile", async () => {
    const records: Array<Record<string, unknown>> = [{ id: "qr", sourceType: "wuzapi", phone: "5214771234567", name: "Joel", tags: ["Cliente"] }];
    const loaded = loadTsModule("src/lib/channel-contacts.ts", {
        "@/lib/phone": phone,
        "@/lib/db": { prisma: { contact: {
            findUnique: async ({ where }: { where: { id: string } }) => records.find(c => c.id === where.id),
            findFirst: async ({ where }: { where: { sourceType: string } }) => records.find(c => c.sourceType === where.sourceType),
            upsert: async ({ create, where }: { create: Record<string, unknown>; where: { phone_sourceType: { sourceType: string } } }) => {
                assert.equal(where.phone_sourceType.sourceType, "meta");
                const record = { id: "api", ...create }; records.push(record); return record;
            },
        } } },
    });
    const resolve = loaded.ensureContactForChannel as (id: string, source: string) => Promise<{ id: string }>;
    assert.equal((await resolve("qr", "wuzapi")).id, "qr");
    assert.equal((await resolve("qr", "meta")).id, "api");
    assert.equal((await resolve("qr", "meta")).id, "api");
    assert.equal(records.length, 2);
    assert.equal(records[1].name, "Joel");
    assert.equal(records[0].sourceType, "wuzapi");
});

test("CSV import matches contacts only inside the selected channel", async () => {
    const creates: Array<Record<string, unknown>> = [];
    const loaded = loadTsModule("src/lib/bulk-campaign-csv.ts", {
        "@/lib/phone": phone, "@/lib/csv": csv,
        "@/lib/db": { prisma: { $transaction: async (operation: (tx: unknown) => Promise<unknown>) => operation({ contact: {
            findFirst: async ({ where }: { where: Record<string, unknown> }) => { assert.equal(where.sourceType, "meta"); return null; },
            create: async ({ data }: { data: Record<string, unknown> }) => { creates.push(data); },
        } }) } },
    });
    const run = loaded.importBulkCampaignContactsFromCsv as (buffer: Buffer, options: Record<string, unknown>) => Promise<{ createdCount: number }>;
    assert.equal((await run(Buffer.from("telefono,nombre\n524771234567,Joel"), { sourceType: "meta" })).createdCount, 1);
    assert.equal(creates[0].sourceType, "meta");
});

test("QR backfill never invents a QR chat on an API contact", async () => {
    const loaded = loadTsModule("src/lib/conversation-coverage.ts", {
        "@/lib/db": { prisma: {
            contact: { count: async () => 0, findMany: async ({ where }: { where: Record<string, unknown> }) => { assert.equal(where.sourceType, "wuzapi"); return []; } },
            conversation: { count: async () => 0, createMany: async () => { assert.fail("no QR contact needs backfill"); } },
        } },
    });
    const run = loaded.backfillMissingActiveConversations as () => Promise<{ createdConversations: number }>;
    assert.equal((await run()).createdConversations, 0);
});
