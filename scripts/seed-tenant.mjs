import "dotenv/config";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL?.trim();
const whatsappInstanceName = process.env.WHATSAPP_INSTANCE_NAME?.trim() || "zen-crm";

if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to seed a tenant database.");
}

const pool = new Pool({ connectionString: databaseUrl });
const client = await pool.connect();

try {
    await client.query("SELECT pg_advisory_lock(hashtext('zen-crm:tenant-seed'))");

    await client.query(
        `
        INSERT INTO "SystemSettings" (id, "whatsappInstanceName", "updatedAt")
        VALUES ('default', $1, NOW())
        ON CONFLICT (id) DO NOTHING
        `,
        [whatsappInstanceName],
    );

    console.log("[Tenant seed] Tenant defaults are ready.");
} finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('zen-crm:tenant-seed'))").catch(() => {});
    client.release();
    await pool.end();
}
