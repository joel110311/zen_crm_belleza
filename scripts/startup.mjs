import { Pool } from "pg";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { spawn } from "node:child_process";

const DATABASE_URL = process.env.DATABASE_URL;
const DEFAULT_INITIAL_ADMIN_EMAIL = "owner@zencrm.local";
const DEFAULT_INITIAL_ADMIN_NAME = "Owner";
const DEFAULT_INITIAL_ADMIN_PASSWORD = "ChangeMe123!";
const DEFAULT_WHATSAPP_INSTANCE_NAME =
    process.env.WHATSAPP_INSTANCE_NAME?.trim() || "zen-crm";
const STARTUP_DB_MAX_ATTEMPTS = Number.parseInt(process.env.STARTUP_DB_MAX_ATTEMPTS || "20", 10);
const STARTUP_DB_RETRY_MS = Number.parseInt(process.env.STARTUP_DB_RETRY_MS || "5000", 10);

function readEnv(name, fallback = "") {
    const value = process.env[name];
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function getInitialAdminConfig() {
    const email = readEnv("INITIAL_ADMIN_EMAIL", DEFAULT_INITIAL_ADMIN_EMAIL);
    const name = readEnv("INITIAL_ADMIN_NAME", DEFAULT_INITIAL_ADMIN_NAME);
    const password = readEnv("INITIAL_ADMIN_PASSWORD", DEFAULT_INITIAL_ADMIN_PASSWORD);

    return {
        email,
        name,
        password,
        usingFallbackEmail: email === DEFAULT_INITIAL_ADMIN_EMAIL,
        usingFallbackPassword: password === DEFAULT_INITIAL_ADMIN_PASSWORD,
    };
}

async function runSafeQuery(pool, query, params = []) {
    return pool.query(query, params).catch(() => {});
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDatabase(pool) {
    let lastError = null;

    for (let attempt = 1; attempt <= STARTUP_DB_MAX_ATTEMPTS; attempt += 1) {
        try {
            await pool.query("SELECT 1");
            if (attempt > 1) {
                console.log(`[Startup] Database ready after ${attempt} attempts.`);
            }
            return;
        } catch (error) {
            lastError = error;
            const message = error instanceof Error ? error.message : String(error);
            console.warn(
                `[Startup] Database not ready (attempt ${attempt}/${STARTUP_DB_MAX_ATTEMPTS}): ${message}`,
            );

            if (attempt < STARTUP_DB_MAX_ATTEMPTS) {
                await sleep(STARTUP_DB_RETRY_MS);
            }
        }
    }

    throw lastError instanceof Error
        ? lastError
        : new Error("Database unavailable after startup retries.");
}

async function runPrismaDbPush() {
    console.log("[Startup] Running Prisma db push...");

    await new Promise((resolve, reject) => {
        const child = spawn(
            "node",
            [
                "./node_modules/prisma/build/index.js",
                "db",
                "push",
                "--accept-data-loss",
                "--schema",
                "./prisma/schema.prisma",
            ],
            {
                stdio: "inherit",
                env: process.env,
            },
        );

        child.on("error", reject);
        child.on("exit", (code) => {
            if (code === 0) {
                resolve(undefined);
                return;
            }
            reject(new Error(`Prisma db push failed with exit code ${code}`));
        });
    });
}

async function migrateLegacyOfficialWhatsAppData(pool) {
    console.log("[Startup] Migrating legacy official WhatsApp data to Meta Cloud API...");

    // Preserve useful reminder/template configuration before Prisma removes the old provider columns.
    await runSafeQuery(pool, 'ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "appointmentReminderMetaTemplate24h" TEXT');
    await runSafeQuery(pool, 'ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "appointmentReminderMetaTemplate4h" TEXT');
    await runSafeQuery(pool, 'ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "appointmentReminderMetaLanguage" TEXT DEFAULT \'es\'');
    await runSafeQuery(pool, `
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'SystemSettings' AND column_name = 'appointmentReminderYcloudTemplate24h') THEN
                EXECUTE 'UPDATE "SystemSettings" SET "appointmentReminderMetaTemplate24h" = COALESCE("appointmentReminderMetaTemplate24h", "appointmentReminderYcloudTemplate24h")';
            END IF;
            IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'SystemSettings' AND column_name = 'appointmentReminderYcloudTemplate4h') THEN
                EXECUTE 'UPDATE "SystemSettings" SET "appointmentReminderMetaTemplate4h" = COALESCE("appointmentReminderMetaTemplate4h", "appointmentReminderYcloudTemplate4h")';
            END IF;
            IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'SystemSettings' AND column_name = 'appointmentReminderYcloudLanguage') THEN
                EXECUTE 'UPDATE "SystemSettings" SET "appointmentReminderMetaLanguage" = COALESCE("appointmentReminderMetaLanguage", "appointmentReminderYcloudLanguage", ''es'')';
            END IF;
        END $$;
    `);

    // Old databases restricted these values with CHECK constraints; remove them before renaming the source.
    await runSafeQuery(pool, 'ALTER TABLE "Message" DROP CONSTRAINT IF EXISTS "Message_source_type_check"');
    await runSafeQuery(pool, 'ALTER TABLE "Conversation" DROP CONSTRAINT IF EXISTS "Conversation_source_type_check"');
    await runSafeQuery(pool, 'UPDATE "Message" SET "source_type" = \'meta\' WHERE "source_type" = \'ycloud\'');
    await runSafeQuery(pool, 'UPDATE "Conversation" SET "source_type" = \'meta\' WHERE "source_type" = \'ycloud\'');
    await runSafeQuery(pool, 'UPDATE "BulkCampaign" SET "source_type" = \'meta\' WHERE "source_type" = \'ycloud\'');
    await runSafeQuery(pool, 'UPDATE "SystemSettings" SET "appointmentReminderProvider" = \'meta\' WHERE "appointmentReminderProvider" = \'ycloud\'');
}

async function startup() {
    if (!DATABASE_URL) {
        console.warn("[Startup] No DATABASE_URL, skipping DB setup.");
        return;
    }

    const pool = new Pool({ connectionString: DATABASE_URL });

    try {
        await waitForDatabase(pool);
        await migrateLegacyOfficialWhatsAppData(pool);
        await runPrismaDbPush();
        console.log("[Startup] Checking schema...");

        await runSafeQuery(
            pool,
            'ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "botActive" BOOLEAN DEFAULT true',
        );
        await runSafeQuery(
            pool,
            'ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "sessionExpiresAt" TIMESTAMP(3)',
        );
        await runSafeQuery(
            pool,
            'ALTER TABLE "Conversation" ALTER COLUMN "botActive" SET DEFAULT true',
        );
        await runSafeQuery(
            pool,
            'UPDATE "Conversation" SET "botActive" = true WHERE "botActive" IS NULL',
        );
        await runSafeQuery(
            pool,
            'ALTER TABLE "Conversation" ALTER COLUMN "botActive" SET NOT NULL',
        );

        await runSafeQuery(pool, 'ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "senderType" TEXT');
        await runSafeQuery(pool, 'ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "reaction" TEXT');
        await runSafeQuery(
            pool,
            'ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "providerMessageId" TEXT',
        );
        await runSafeQuery(
            pool,
            'CREATE INDEX IF NOT EXISTS "Message_providerMessageId_idx" ON "Message" ("providerMessageId")',
        );

        await runSafeQuery(
            pool,
            `ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "openaiModel" TEXT DEFAULT 'gpt-4o-mini'`,
        );
        await runSafeQuery(pool, 'ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "whatsappBaseUrl" TEXT');
        await runSafeQuery(pool, 'ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "whatsappAdminToken" TEXT');
        await runSafeQuery(pool, 'ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "whatsappUserToken" TEXT');
        await runSafeQuery(
            pool,
            `ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "whatsappInstanceName" TEXT DEFAULT 'zen-crm'`,
        );
        await runSafeQuery(
            pool,
            'ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "whatsappProxyEnabled" BOOLEAN DEFAULT false',
        );
        await runSafeQuery(pool, 'ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "whatsappProxyUrl" TEXT');
        await runSafeQuery(
            pool,
            'UPDATE "SystemSettings" SET "whatsappProxyEnabled" = false WHERE "whatsappProxyEnabled" IS NULL',
        );
        await runSafeQuery(
            pool,
            'ALTER TABLE "SystemSettings" ALTER COLUMN "whatsappProxyEnabled" SET DEFAULT false',
        );
        await runSafeQuery(
            pool,
            `ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "agentName" TEXT DEFAULT 'Asistente Zen'`,
        );
        await runSafeQuery(pool, 'ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "agentPrompt" TEXT');
        await runSafeQuery(
            pool,
            'ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "agentTemperature" DOUBLE PRECISION DEFAULT 0.3',
        );
        await runSafeQuery(
            pool,
            'ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "knowledgeTopK" INTEGER DEFAULT 6',
        );
        await runSafeQuery(
            pool,
            'ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "autoReplyDelayMs" INTEGER DEFAULT 1200',
        );
        await runSafeQuery(
            pool,
            'ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "leadScoringEnabled" BOOLEAN DEFAULT true',
        );
        await runSafeQuery(
            pool,
            'ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "captureLeadName" BOOLEAN DEFAULT false',
        );
        await runSafeQuery(
            pool,
            'ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "captureLeadEmail" BOOLEAN DEFAULT false',
        );
        await runSafeQuery(
            pool,
            'ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "leadInterestThreshold" INTEGER DEFAULT 45',
        );
        await runSafeQuery(
            pool,
            'ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "businessWeeklySchedule" JSONB',
        );
        await runSafeQuery(
            pool,
            'UPDATE "SystemSettings" SET "agentTemperature" = 0.3 WHERE "agentTemperature" IS NULL',
        );
        await runSafeQuery(
            pool,
            'UPDATE "SystemSettings" SET "knowledgeTopK" = 6 WHERE "knowledgeTopK" IS NULL',
        );
        await runSafeQuery(
            pool,
            'UPDATE "SystemSettings" SET "autoReplyDelayMs" = 1200 WHERE "autoReplyDelayMs" IS NULL',
        );
        await runSafeQuery(
            pool,
            'UPDATE "SystemSettings" SET "leadScoringEnabled" = true WHERE "leadScoringEnabled" IS NULL',
        );
        await runSafeQuery(
            pool,
            'UPDATE "SystemSettings" SET "captureLeadName" = false WHERE "captureLeadName" IS NULL',
        );
        await runSafeQuery(
            pool,
            'UPDATE "SystemSettings" SET "captureLeadEmail" = false WHERE "captureLeadEmail" IS NULL',
        );
        await runSafeQuery(
            pool,
            'UPDATE "SystemSettings" SET "leadInterestThreshold" = 45 WHERE "leadInterestThreshold" IS NULL',
        );
        await runSafeQuery(
            pool,
            `
            UPDATE "SystemSettings"
            SET "businessWeeklySchedule" = jsonb_build_object(
                'monday', jsonb_build_object('enabled', true, 'start', COALESCE("businessHoursStart", '09:00'), 'end', COALESCE("businessHoursEnd", '18:00')),
                'tuesday', jsonb_build_object('enabled', true, 'start', COALESCE("businessHoursStart", '09:00'), 'end', COALESCE("businessHoursEnd", '18:00')),
                'wednesday', jsonb_build_object('enabled', true, 'start', COALESCE("businessHoursStart", '09:00'), 'end', COALESCE("businessHoursEnd", '18:00')),
                'thursday', jsonb_build_object('enabled', true, 'start', COALESCE("businessHoursStart", '09:00'), 'end', COALESCE("businessHoursEnd", '18:00')),
                'friday', jsonb_build_object('enabled', true, 'start', COALESCE("businessHoursStart", '09:00'), 'end', COALESCE("businessHoursEnd", '18:00')),
                'saturday', jsonb_build_object('enabled', true, 'start', COALESCE("businessHoursStart", '09:00'), 'end', COALESCE("businessHoursEnd", '18:00')),
                'sunday', jsonb_build_object('enabled', true, 'start', COALESCE("businessHoursStart", '09:00'), 'end', COALESCE("businessHoursEnd", '18:00'))
            )
            WHERE "businessWeeklySchedule" IS NULL
            `,
        );
        await runSafeQuery(
            pool,
            'ALTER TABLE "SystemSettings" ALTER COLUMN "agentTemperature" SET DEFAULT 0.3',
        );
        await runSafeQuery(
            pool,
            'ALTER TABLE "SystemSettings" ALTER COLUMN "knowledgeTopK" SET DEFAULT 6',
        );
        await runSafeQuery(
            pool,
            'ALTER TABLE "SystemSettings" ALTER COLUMN "autoReplyDelayMs" SET DEFAULT 1200',
        );
        await runSafeQuery(
            pool,
            'ALTER TABLE "SystemSettings" ALTER COLUMN "leadScoringEnabled" SET DEFAULT true',
        );
        await runSafeQuery(
            pool,
            'ALTER TABLE "SystemSettings" ALTER COLUMN "captureLeadName" SET DEFAULT false',
        );
        await runSafeQuery(
            pool,
            'ALTER TABLE "SystemSettings" ALTER COLUMN "captureLeadEmail" SET DEFAULT false',
        );
        await runSafeQuery(
            pool,
            'ALTER TABLE "SystemSettings" ALTER COLUMN "leadInterestThreshold" SET DEFAULT 45',
        );
        await runSafeQuery(
            pool,
            'ALTER TABLE "SystemSettings" ALTER COLUMN "agentTemperature" SET NOT NULL',
        );
        await runSafeQuery(
            pool,
            'ALTER TABLE "SystemSettings" ALTER COLUMN "knowledgeTopK" SET NOT NULL',
        );
        await runSafeQuery(
            pool,
            'ALTER TABLE "SystemSettings" ALTER COLUMN "autoReplyDelayMs" SET NOT NULL',
        );
        await runSafeQuery(
            pool,
            'ALTER TABLE "SystemSettings" ALTER COLUMN "leadScoringEnabled" SET NOT NULL',
        );
        await runSafeQuery(
            pool,
            'ALTER TABLE "SystemSettings" ALTER COLUMN "captureLeadName" SET NOT NULL',
        );
        await runSafeQuery(
            pool,
            'ALTER TABLE "SystemSettings" ALTER COLUMN "captureLeadEmail" SET NOT NULL',
        );
        await runSafeQuery(
            pool,
            'ALTER TABLE "SystemSettings" ALTER COLUMN "leadInterestThreshold" SET NOT NULL',
        );
        await runSafeQuery(pool, 'ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "operationCountry" TEXT NOT NULL DEFAULT \'MX\'');
        await runSafeQuery(pool, 'ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "phoneDefaultCountry" TEXT NOT NULL DEFAULT \'MX\'');
        await runSafeQuery(pool, 'ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "paymentEnabledCurrencies" JSONB NOT NULL DEFAULT \'["MXN"]\'::jsonb');
        await runSafeQuery(pool, 'UPDATE "SystemSettings" SET "operationCountry" = COALESCE(NULLIF("operationCountry", \'\'), \'MX\')');
        await runSafeQuery(pool, 'UPDATE "SystemSettings" SET "phoneDefaultCountry" = COALESCE(NULLIF("phoneDefaultCountry", \'\'), \'MX\')');
        await runSafeQuery(pool, 'UPDATE "SystemSettings" SET "paymentDefaultCurrency" = COALESCE(NULLIF("paymentDefaultCurrency", \'\'), \'MXN\')');
        await runSafeQuery(pool, 'UPDATE "SystemSettings" SET "businessTimeZone" = COALESCE(NULLIF("businessTimeZone", \'\'), \'America/Mexico_City\')');
        await runSafeQuery(pool, 'UPDATE "SystemSettings" SET "paymentEnabledCurrencies" = \'["MXN"]\'::jsonb WHERE "paymentEnabledCurrencies" IS NULL');

        await runSafeQuery(pool, 'ALTER TABLE "User" ADD COLUMN IF NOT EXISTS permissions JSONB');
        await runSafeQuery(pool, 'ALTER TABLE "User" ALTER COLUMN permissions SET DEFAULT \'[]\'::jsonb');
        await runSafeQuery(pool, 'UPDATE "User" SET permissions = \'[]\'::jsonb WHERE permissions IS NULL');
        await runSafeQuery(
            pool,
            `
            UPDATE "User"
            SET role = CASE
                WHEN role = 'SUPERADMIN' THEN 'ADMINISTRADOR'
                WHEN role = 'ADMIN' THEN 'RECEPCION'
                WHEN role IN ('ADMINISTRADOR', 'PROFESIONAL', 'RECEPCION') THEN role
                ELSE 'RECEPCION'
            END
            `,
        );
        await runSafeQuery(pool, 'ALTER TABLE "User" ALTER COLUMN role SET DEFAULT \'RECEPCION\'');
        await runSafeQuery(
            pool,
            `
            WITH first_user AS (
                SELECT id
                FROM "User"
                ORDER BY "createdAt" ASC
                LIMIT 1
            )
            UPDATE "User"
            SET role = 'ADMINISTRADOR'
            WHERE id IN (SELECT id FROM first_user)
              AND NOT EXISTS (
                  SELECT 1
                  FROM "User"
                  WHERE role = 'ADMINISTRADOR'
                     OR permissions @> '["system.fullAccess"]'::jsonb
              )
            `,
        );

        await runSafeQuery(pool, 'CREATE EXTENSION IF NOT EXISTS vector');

        await runSafeQuery(
            pool,
            `
            CREATE TABLE IF NOT EXISTS "KnowledgeSource" (
                "id" TEXT PRIMARY KEY,
                "title" TEXT NOT NULL,
                "type" TEXT NOT NULL,
                "status" TEXT NOT NULL DEFAULT 'pending',
                "sourceUri" TEXT,
                "rawContent" TEXT,
                "mimeType" TEXT,
                "error" TEXT,
                "chunkCount" INTEGER NOT NULL DEFAULT 0,
                "metadata" JSONB,
                "syncedAt" TIMESTAMP(3),
                "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
                "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW()
            )
            `,
        );

        await runSafeQuery(
            pool,
            `
            CREATE TABLE IF NOT EXISTS "KnowledgeChunk" (
                "id" TEXT PRIMARY KEY,
                "sourceId" TEXT NOT NULL REFERENCES "KnowledgeSource"("id") ON DELETE CASCADE,
                "title" TEXT,
                "content" TEXT NOT NULL,
                "chunkIndex" INTEGER NOT NULL,
                "tokenCount" INTEGER,
                "metadata" JSONB,
                "embedding" vector(1536),
                "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW()
            )
            `,
        );

        await runSafeQuery(
            pool,
            `
            CREATE TABLE IF NOT EXISTS "LeadIntelligence" (
                "id" TEXT PRIMARY KEY,
                "dealId" TEXT NOT NULL UNIQUE REFERENCES "Deal"("id") ON DELETE CASCADE,
                "score" INTEGER NOT NULL DEFAULT 0,
                "interestStatus" TEXT NOT NULL DEFAULT 'nuevo',
                "currentStep" TEXT NOT NULL DEFAULT 'inicio',
                "stepProgress" INTEGER NOT NULL DEFAULT 0,
                "pendingCaptureField" TEXT,
                "nameCaptured" BOOLEAN NOT NULL DEFAULT false,
                "emailCaptured" BOOLEAN NOT NULL DEFAULT false,
                "nameDeclined" BOOLEAN NOT NULL DEFAULT false,
                "emailDeclined" BOOLEAN NOT NULL DEFAULT false,
                "capturedName" TEXT,
                "capturedEmail" TEXT,
                "askedForNameAt" TIMESTAMP(3),
                "askedForEmailAt" TIMESTAMP(3),
                "capturedNameAt" TIMESTAMP(3),
                "capturedEmailAt" TIMESTAMP(3),
                "interestDetectedAt" TIMESTAMP(3),
                "lastScoredAt" TIMESTAMP(3),
                "sameDayInboundCount" INTEGER NOT NULL DEFAULT 0,
                "lastSummary" TEXT,
                "signals" JSONB,
                "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
                "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW()
            )
            `,
        );

        await runSafeQuery(
            pool,
            `
            CREATE TABLE IF NOT EXISTS "Template" (
                "id" TEXT PRIMARY KEY,
                "name" TEXT NOT NULL,
                "content" TEXT NOT NULL,
                "category" TEXT,
                "language" TEXT NOT NULL DEFAULT 'es',
                "status" TEXT NOT NULL DEFAULT 'approved',
                "type" TEXT NOT NULL DEFAULT 'text',
                "mediaUrl" TEXT,
                "mediaType" TEXT,
                "mediaFileName" TEXT,
                "shortcut" TEXT UNIQUE,
                "variables" JSONB,
                "isFavorite" BOOLEAN NOT NULL DEFAULT false,
                "isActive" BOOLEAN NOT NULL DEFAULT true,
                "sortOrder" INTEGER NOT NULL DEFAULT 0,
                "usageCount" INTEGER NOT NULL DEFAULT 0,
                "lastUsedAt" TIMESTAMP(3),
                "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
                "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW()
            )
            `,
        );
        await runSafeQuery(pool, 'ALTER TABLE "Template" ADD COLUMN IF NOT EXISTS "type" TEXT DEFAULT \'text\'');
        await runSafeQuery(pool, 'ALTER TABLE "Template" ADD COLUMN IF NOT EXISTS "mediaUrl" TEXT');
        await runSafeQuery(pool, 'ALTER TABLE "Template" ADD COLUMN IF NOT EXISTS "mediaType" TEXT');
        await runSafeQuery(pool, 'ALTER TABLE "Template" ADD COLUMN IF NOT EXISTS "mediaFileName" TEXT');
        await runSafeQuery(pool, 'ALTER TABLE "Template" ADD COLUMN IF NOT EXISTS "shortcut" TEXT');
        await runSafeQuery(pool, 'ALTER TABLE "Template" ADD COLUMN IF NOT EXISTS "variables" JSONB');
        await runSafeQuery(pool, 'ALTER TABLE "Template" ADD COLUMN IF NOT EXISTS "isFavorite" BOOLEAN DEFAULT false');
        await runSafeQuery(pool, 'ALTER TABLE "Template" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN DEFAULT true');
        await runSafeQuery(pool, 'ALTER TABLE "Template" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER DEFAULT 0');
        await runSafeQuery(pool, 'ALTER TABLE "Template" ADD COLUMN IF NOT EXISTS "usageCount" INTEGER DEFAULT 0');
        await runSafeQuery(pool, 'ALTER TABLE "Template" ADD COLUMN IF NOT EXISTS "lastUsedAt" TIMESTAMP(3)');
        await runSafeQuery(pool, 'UPDATE "Template" SET "type" = \'text\' WHERE "type" IS NULL');
        await runSafeQuery(pool, 'UPDATE "Template" SET "isFavorite" = false WHERE "isFavorite" IS NULL');
        await runSafeQuery(pool, 'UPDATE "Template" SET "isActive" = true WHERE "isActive" IS NULL');
        await runSafeQuery(pool, 'UPDATE "Template" SET "sortOrder" = 0 WHERE "sortOrder" IS NULL');
        await runSafeQuery(pool, 'UPDATE "Template" SET "usageCount" = 0 WHERE "usageCount" IS NULL');
        await runSafeQuery(pool, 'ALTER TABLE "Template" ALTER COLUMN "type" SET DEFAULT \'text\'');
        await runSafeQuery(pool, 'ALTER TABLE "Template" ALTER COLUMN "isFavorite" SET DEFAULT false');
        await runSafeQuery(pool, 'ALTER TABLE "Template" ALTER COLUMN "isActive" SET DEFAULT true');
        await runSafeQuery(pool, 'ALTER TABLE "Template" ALTER COLUMN "sortOrder" SET DEFAULT 0');
        await runSafeQuery(pool, 'ALTER TABLE "Template" ALTER COLUMN "usageCount" SET DEFAULT 0');
        await runSafeQuery(pool, 'ALTER TABLE "Template" ALTER COLUMN "type" SET NOT NULL');
        await runSafeQuery(pool, 'ALTER TABLE "Template" ALTER COLUMN "isFavorite" SET NOT NULL');
        await runSafeQuery(pool, 'ALTER TABLE "Template" ALTER COLUMN "isActive" SET NOT NULL');
        await runSafeQuery(pool, 'ALTER TABLE "Template" ALTER COLUMN "sortOrder" SET NOT NULL');
        await runSafeQuery(pool, 'ALTER TABLE "Template" ALTER COLUMN "usageCount" SET NOT NULL');

        console.log("[Startup] Creating database indexes...");
        await runSafeQuery(
            pool,
            'CREATE INDEX IF NOT EXISTS "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt" DESC)',
        );
        await runSafeQuery(
            pool,
            'CREATE INDEX IF NOT EXISTS "Conversation_updatedAt_idx" ON "Conversation"("updatedAt" DESC)',
        );
        await runSafeQuery(
            pool,
            'CREATE INDEX IF NOT EXISTS "Conversation_contactId_idx" ON "Conversation"("contactId")',
        );
        await runSafeQuery(pool, 'CREATE INDEX IF NOT EXISTS "Deal_stageId_idx" ON "Deal"("stageId")');
        await runSafeQuery(pool, 'CREATE INDEX IF NOT EXISTS "Deal_contactId_idx" ON "Deal"("contactId")');
        await runSafeQuery(
            pool,
            'CREATE INDEX IF NOT EXISTS "Appointment_startTime_idx" ON "Appointment"("startTime")',
        );
        await runSafeQuery(
            pool,
            'CREATE INDEX IF NOT EXISTS "Appointment_contactId_idx" ON "Appointment"("contactId")',
        );
        await runSafeQuery(
            pool,
            'CREATE INDEX IF NOT EXISTS "KnowledgeSource_type_status_idx" ON "KnowledgeSource"("type", "status")',
        );
        await runSafeQuery(
            pool,
            'CREATE INDEX IF NOT EXISTS "KnowledgeSource_updatedAt_idx" ON "KnowledgeSource"("updatedAt" DESC)',
        );
        await runSafeQuery(
            pool,
            'CREATE INDEX IF NOT EXISTS "KnowledgeChunk_sourceId_chunkIndex_idx" ON "KnowledgeChunk"("sourceId", "chunkIndex")',
        );
        await runSafeQuery(
            pool,
            'CREATE INDEX IF NOT EXISTS "LeadIntelligence_interestStatus_idx" ON "LeadIntelligence"("interestStatus")',
        );
        await runSafeQuery(
            pool,
            'CREATE INDEX IF NOT EXISTS "LeadIntelligence_score_idx" ON "LeadIntelligence"("score")',
        );
        await runSafeQuery(
            pool,
            'CREATE INDEX IF NOT EXISTS "Template_isActive_category_idx" ON "Template"("isActive", "category")',
        );
        await runSafeQuery(
            pool,
            'CREATE INDEX IF NOT EXISTS "Template_isFavorite_updatedAt_idx" ON "Template"("isFavorite", "updatedAt" DESC)',
        );
        await runSafeQuery(
            pool,
            'CREATE UNIQUE INDEX IF NOT EXISTS "Template_shortcut_key" ON "Template"("shortcut") WHERE "shortcut" IS NOT NULL',
        );

        console.log("[Startup] Schema up to date");

        const { rows: stageRows } = await pool.query('SELECT COUNT(*) AS count FROM "PipelineStage"');
        const stageCount = Number.parseInt(stageRows[0].count, 10);

        if (stageCount > 0) {
            console.log(`[Startup] DB already seeded (${stageCount} pipeline stages). Skipping seed.`);
        } else {
            console.log("[Startup] Empty DB detected. Auto-seeding...");
            const initialAdmin = getInitialAdminConfig();

            await pool.query(
                `
                INSERT INTO "SystemSettings" (
                    id,
                    "openaiModel",
                    "whatsappInstanceName",
                    "agentName",
                    "agentTemperature",
                    "knowledgeTopK",
                    "autoReplyDelayMs",
                    "operationCountry",
                    "phoneDefaultCountry",
                    "paymentDefaultCurrency",
                    "paymentEnabledCurrencies",
                    "businessTimeZone",
                    "isBotEnabled",
                    "updatedAt"
                )
                VALUES ('default', 'gpt-4o-mini', $1, 'Asistente Zen', 0.3, 6, 1200, 'MX', 'MX', 'MXN', '["MXN"]'::jsonb, 'America/Mexico_City', false, NOW())
                ON CONFLICT (id) DO NOTHING
                `,
                [DEFAULT_WHATSAPP_INSTANCE_NAME],
            );
            console.log("[Startup] Seeded default system settings");

            const adminPassword = await bcrypt.hash(initialAdmin.password, 12);
            const adminId = crypto.randomUUID().replace(/-/g, "").slice(0, 25);

            await pool.query(
                `
                INSERT INTO "User" (id, email, name, password, role, permissions, "createdAt", "updatedAt")
                VALUES ($1, $2, $3, $4, 'ADMINISTRADOR', '[]'::jsonb, NOW(), NOW())
                ON CONFLICT (email) DO NOTHING
                `,
                [adminId, initialAdmin.email, initialAdmin.name, adminPassword],
            );
            console.log(`[Startup] Seeded initial administrator (${initialAdmin.email})`);
            if (initialAdmin.usingFallbackEmail || initialAdmin.usingFallbackPassword) {
                console.warn(
                    "[Startup] WARNING: Using fallback superadmin credentials. Define INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD in production.",
                );
            }

            const stages = [
                { name: "Nuevo Lead", color: "#3B82F6", order: 0, isIncoming: true, isClosedWon: false, isClosedLost: false },
                { name: "Calificado", color: "#8B5CF6", order: 1, isIncoming: false, isClosedWon: false, isClosedLost: false },
                { name: "Propuesta", color: "#F59E0B", order: 2, isIncoming: false, isClosedWon: false, isClosedLost: false },
                { name: "Seguimiento", color: "#F97316", order: 3, isIncoming: false, isClosedWon: false, isClosedLost: false },
                { name: "Cerrado Ganado", color: "#22C55E", order: 4, isIncoming: false, isClosedWon: true, isClosedLost: false },
                { name: "Cerrado Perdido", color: "#CBD5E1", order: 5, isIncoming: false, isClosedWon: false, isClosedLost: true },
            ];

            for (const stage of stages) {
                const stageId = crypto.randomUUID().replace(/-/g, "").slice(0, 25);
                await pool.query(
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
                        stageId,
                        stage.name,
                        stage.color,
                        stage.order,
                        stage.isIncoming,
                        stage.isClosedWon,
                        stage.isClosedLost,
                    ],
                );
            }

            console.log(`[Startup] Seeded ${stages.length} pipeline stages`);
            console.log("[Startup] Auto-seed complete");
        }
    } catch (error) {
        console.error("[Startup] Error:", error instanceof Error ? error.message : error);
        throw error;
    } finally {
        await pool.end().catch(() => {});
    }
}

try {
    await startup();
    console.log("[Startup] Starting Next.js server...");
    import("./server.js");
} catch (error) {
    console.error("[Startup] Fatal startup failure:", error instanceof Error ? error.message : error);
    process.exit(1);
}
