import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrationName = "20261007010000_unify_wuzapi_conversation_identity/migration.sql";
test("la migracion une chats WuzAPI sin perder mensajes; no mezcla Meta ni chats cerrados", async () => {
    const sql = await readFile(new URL(`../prisma/migrations/${migrationName}`, import.meta.url), "utf8");
    const tenantSql = await readFile(new URL(`../prisma/tenant-migrations/${migrationName}`, import.meta.url), "utf8");
    assert.equal(sql, tenantSql);
    const db = new PGlite();
    try {
        await db.exec(`
            CREATE TABLE "Conversation" (
                "id" TEXT PRIMARY KEY, "contactId" TEXT NOT NULL, "status" TEXT DEFAULT 'active',
                "source_type" TEXT DEFAULT 'wuzapi', "source_id" TEXT, "assignedUserId" TEXT,
                "botActive" BOOLEAN DEFAULT true, "isMuted" BOOLEAN DEFAULT false, "isFavorite" BOOLEAN DEFAULT false,
                "createdAt" TIMESTAMP DEFAULT '2026-10-06', "updatedAt" TIMESTAMP DEFAULT '2026-10-06'
            );
            CREATE UNIQUE INDEX "Conversation_active_source_unique"
                ON "Conversation" ("contactId", "source_type", COALESCE("source_id", '')) WHERE "status" = 'active';
            CREATE TABLE "Message" (
                "id" TEXT PRIMARY KEY, "conversationId" TEXT REFERENCES "Conversation"("id"), "direction" TEXT,
                "senderType" TEXT, "status" TEXT DEFAULT 'sent', "content" TEXT, "createdAt" TIMESTAMP
            );
            CREATE TABLE "CatalogConversationState" (
                "id" TEXT PRIMARY KEY, "conversationId" TEXT UNIQUE REFERENCES "Conversation"("id"),
                "updatedAt" TIMESTAMP, "pendingPdf" BOOLEAN
            );
            CREATE TABLE "BulkCampaignRecipient" (
                "id" TEXT PRIMARY KEY, "conversationId" TEXT REFERENCES "Conversation"("id")
            );
            INSERT INTO "Conversation" ("id", "contactId", "source_id", "assignedUserId") VALUES
                ('original', 'client', NULL, 'owner'), ('duplicate', 'client', 'instance', NULL),
                ('manual', 'client2', NULL, NULL), ('manual-duplicate', 'client2', 'instance', 'agent'),
                ('bot', 'client3', NULL, NULL), ('bot-duplicate', 'client3', 'instance', NULL),
                ('single-instance', 'client4', 'instance', NULL);
            UPDATE "Conversation" SET "botActive" = false, "isMuted" = true WHERE "id" = 'manual-duplicate';
            UPDATE "Conversation" SET "isFavorite" = true, "updatedAt" = '2026-10-07' WHERE "id" = 'duplicate';
            INSERT INTO "Conversation" ("id", "contactId", "source_type", "source_id", "status") VALUES
                ('meta1', 'client', 'meta', 'account1', 'active'),
                ('meta2', 'client', 'meta', 'account2', 'active'),
                ('closed', 'client', 'wuzapi', 'previous-instance', 'closed');
            INSERT INTO "Message" ("id", "conversationId", "direction", "senderType", "content", "createdAt") VALUES
                ('old', 'original', 'inbound', NULL, 'Historial', '2026-10-06'),
                ('human', 'duplicate', 'outbound', 'human', 'Alan', '2026-10-07 12:49'),
                ('bot-send', 'bot-duplicate', 'outbound', 'bot', 'Respuesta', '2026-10-07 12:50'),
                ('meta-msg', 'meta1', 'inbound', NULL, 'Otro canal', '2026-10-06'),
                ('closed-msg', 'closed', 'outbound', 'human', 'Cerrado', '2026-10-05');
            INSERT INTO "CatalogConversationState" VALUES
                ('old-state', 'original', '2026-10-06', false), ('new-state', 'duplicate', '2026-10-07', true);
            INSERT INTO "BulkCampaignRecipient" VALUES ('recipient', 'duplicate');
        `);
        const before = (await db.query('SELECT "id", "content", "createdAt", "senderType" FROM "Message" ORDER BY "id"')).rows;
        await db.exec(sql);
        const after = (await db.query('SELECT "id", "content", "createdAt", "senderType" FROM "Message" ORDER BY "id"')).rows;
        assert.deepEqual(after, before);
        const chats = (await db.query<{ id: string; botActive: boolean; assignedUserId: string | null; source_id: string | null; isFavorite: boolean; isMuted: boolean }>('SELECT * FROM "Conversation"')).rows;
        assert.equal(chats.length, 7);
        assert.equal(chats.find((c) => c.id === "original")?.botActive, false);
        assert.equal(chats.find((c) => c.id === "original")?.assignedUserId, "owner");
        assert.equal(chats.find((c) => c.id === "original")?.isFavorite, true);
        assert.equal(chats.find((c) => c.id === "manual")?.assignedUserId, "agent");
        assert.equal(chats.find((c) => c.id === "manual")?.botActive, false);
        assert.equal(chats.find((c) => c.id === "manual")?.isMuted, true);
        assert.equal(chats.find((c) => c.id === "bot")?.botActive, true);
        assert.equal(chats.find((c) => c.id === "single-instance")?.source_id, null);
        assert.equal(chats.find((c) => c.id === "closed")?.source_id, "previous-instance");
        assert.deepEqual((await db.query('SELECT "conversationId" FROM "Message" WHERE "id" = \'human\'')).rows, [{ conversationId: "original" }]);
        assert.deepEqual((await db.query('SELECT "conversationId" FROM "BulkCampaignRecipient"')).rows, [{ conversationId: "original" }]);
        assert.deepEqual((await db.query('SELECT "id", "conversationId", "pendingPdf" FROM "CatalogConversationState"')).rows, [{ id: "new-state", conversationId: "original", pendingPdf: true }]);
        // A new instance ID cannot bypass the active WuzAPI uniqueness constraint.
        await assert.rejects(db.exec(`INSERT INTO "Conversation" ("id", "contactId", "source_id") VALUES ('again', 'client', 'different-instance')`));
        await db.exec(sql); // Safe to run again without changing the preserved history/modes.
        assert.deepEqual((await db.query('SELECT "id", "content", "createdAt", "senderType" FROM "Message" ORDER BY "id"')).rows, before);
    } finally {
        await db.close();
    }
});
