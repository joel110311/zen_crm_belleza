import "dotenv/config";
import crypto from "node:crypto";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL?.trim();
const whatsappInstanceName = process.env.WHATSAPP_INSTANCE_NAME?.trim() || "zen-crm";

if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to seed a tenant database.");
}

const pipelineStages = [
    { name: "Nuevo Lead", color: "#3B82F6", order: 0, isIncoming: true, isClosedWon: false, isClosedLost: false },
    { name: "Calificado", color: "#8B5CF6", order: 1, isIncoming: false, isClosedWon: false, isClosedLost: false },
    { name: "Propuesta", color: "#F59E0B", order: 2, isIncoming: false, isClosedWon: false, isClosedLost: false },
    { name: "Seguimiento", color: "#F97316", order: 3, isIncoming: false, isClosedWon: false, isClosedLost: false },
    { name: "Cerrado Ganado", color: "#22C55E", order: 4, isIncoming: false, isClosedWon: true, isClosedLost: false },
    { name: "Cerrado Perdido", color: "#CBD5E1", order: 5, isIncoming: false, isClosedWon: false, isClosedLost: true },
];

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

    const { rows } = await client.query('SELECT COUNT(*) AS count FROM "PipelineStage"');
    const stageCount = Number.parseInt(rows[0].count, 10);

    if (stageCount === 0) {
        for (const stage of pipelineStages) {
            await client.query(
                `
                INSERT INTO "PipelineStage" (
                    id,
                    name,
                    color,
                    "order",
                    "isIncoming",
                    "isClosedWon",
                    "isClosedLost",
                    "createdAt",
                    "updatedAt"
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
                `,
                [
                    crypto.randomUUID().replace(/-/g, "").slice(0, 25),
                    stage.name,
                    stage.color,
                    stage.order,
                    stage.isIncoming,
                    stage.isClosedWon,
                    stage.isClosedLost,
                ],
            );
        }
        console.log(`[Tenant seed] Created ${pipelineStages.length} pipeline stages.`);
    } else {
        console.log(`[Tenant seed] Pipeline already contains ${stageCount} stages; no defaults added.`);
    }

    console.log("[Tenant seed] Tenant defaults are ready.");
} finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('zen-crm:tenant-seed'))").catch(() => {});
    client.release();
    await pool.end();
}
