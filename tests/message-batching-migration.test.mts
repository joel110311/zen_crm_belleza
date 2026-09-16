import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const legacyMigrationUrl = new URL(
    "../prisma/migrations/20260912_add_message_batching/migration.sql",
    import.meta.url,
);
const tenantMigrationUrl = new URL(
    "../prisma/tenant-migrations/20260912000000_add_message_batching/migration.sql",
    import.meta.url,
);

function normalizeSql(value: string) {
    return value.replace(/\r\n/g, "\n").trim();
}

test("message batching migration is applied to legacy and tenant databases", async () => {
    const [legacySql, tenantSql] = await Promise.all([
        readFile(legacyMigrationUrl, "utf8"),
        readFile(tenantMigrationUrl, "utf8"),
    ]);

    assert.equal(normalizeSql(tenantSql), normalizeSql(legacySql));
});
