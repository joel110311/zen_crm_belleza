import crypto from "node:crypto";
import { readFile, writeFile, copyFile } from "node:fs/promises";
import { parse } from "dotenv";
import bcrypt from "bcryptjs";
import { Pool } from "pg";
import { addBusinessMonths } from "./lib/billing-retention-policy.mjs";

const tenantUrl = "postgresql://crm_local:local_training_only@127.0.0.1:5446/crm_training";
const controlUrl = "postgresql://crm_local:local_training_only@127.0.0.1:5446/crm_retention_control";
if (process.env.NODE_ENV === "production") throw new Error("Local fixtures cannot run in production.");
const original = await readFile(".env.local", "utf8");
const configuration = parse(original);
if (configuration.DATABASE_URL !== tenantUrl || configuration.CONTROL_DATABASE_URL && configuration.CONTROL_DATABASE_URL !== controlUrl) throw new Error("This demo requires the dedicated local training databases.");
try { await copyFile(".env.local", ".env.local.before-expiry-demo", 1); } catch (error) { if (error.code !== "EEXIST") throw error; }
const key = configuration.TENANT_CREDENTIALS_ENCRYPTION_KEY || crypto.randomBytes(32).toString("base64");
const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(key, "base64"), iv);
const encrypted = Buffer.concat([cipher.update(tenantUrl, "utf8"), cipher.final()]);
const envelope = Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
const id = "localexpirytest";
const ownerId = "local-expiry-owner";
const endsAt = process.argv.includes("--warning") ? addBusinessMonths(new Date(), -2) : new Date(Date.now() - 2 * 86_400_000);
const pool = new Pool({ connectionString: controlUrl });
try {
    await pool.query(`INSERT INTO "User" (id,email,name,"passwordHash","emailVerifiedAt","updatedAt") VALUES ($1,'owner-expiry@crm.local','Propietario local',$2,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET "passwordHash"=EXCLUDED."passwordHash","updatedAt"=NOW()`, [ownerId, await bcrypt.hash("CRM-Local-Expiry-2026!", 12)]);
    await pool.query(`INSERT INTO "Tenant" (id,slug,"displayName",status,"provisioningStatus","billingStatus","accessMode","createdByUserId","updatedAt")
        VALUES ($1,'negocio-local','Negocio de prueba','READY','SUCCEEDED','CANCELED','BILLING_ONLY',$2,NOW())
        ON CONFLICT (id) DO UPDATE SET status='READY',"accessMode"='BILLING_ONLY',"billingStatus"='CANCELED',"updatedAt"=NOW()`, [id, ownerId]);
    await pool.query(`INSERT INTO "TenantMembership" (id,"tenantId","userId",role,"isActive","updatedAt") VALUES ('local-expiry-membership',$1,$2,'OWNER',true,NOW())
        ON CONFLICT (id) DO UPDATE SET "isActive"=true,"updatedAt"=NOW()`, [id, ownerId]);
    await pool.query(`INSERT INTO "TenantDatabase" (id,"tenantId","clusterKey","databaseName","runtimeUrlCiphertext","runtimeSecretKeyVersion",status,"updatedAt")
        VALUES ('local-expiry-database',$1,'local','crm_training',$2,1,'READY',NOW()) ON CONFLICT (id) DO UPDATE SET "runtimeUrlCiphertext"=EXCLUDED."runtimeUrlCiphertext","updatedAt"=NOW()`, [id, envelope]);
    await pool.query(`INSERT INTO "Trial" (id,"tenantId",status,"startsAt","endsAt","expiredAt","updatedAt") VALUES ('local-expiry-trial',$1,'EXPIRED',$2::timestamp-INTERVAL '14 days',$2,$2,NOW())
        ON CONFLICT (id) DO UPDATE SET status='EXPIRED',"startsAt"=EXCLUDED."startsAt","endsAt"=EXCLUDED."endsAt","expiredAt"=EXCLUDED."expiredAt","updatedAt"=NOW()`, [id, endsAt.toISOString()]);
} finally { await pool.end(); }
let updated = original;
for (const [name, value] of Object.entries({ CONTROL_DATABASE_URL: controlUrl, MULTITENANT_RUNTIME_ENABLED: "true", MULTITENANT_AUTH_ENABLED: "true", TENANT_CREDENTIALS_ENCRYPTION_KEY: key, TENANT_CREDENTIALS_KEY_VERSION: "1", AUTH_URL: "http://localhost:3108", APP_BASE_URL: "http://localhost:3108" })) {
    const pattern = new RegExp(`^${name}=.*$`, "m");
    updated = pattern.test(updated) ? updated.replace(pattern, `${name}=${value}`) : `${updated.trimEnd()}\n${name}=${value}\n`;
}
await writeFile(".env.local", updated);
console.log(`Local expired-workspace fixture ready (${process.argv.includes("--warning") ? "second-month warning" : "trial expired"}). No provider keys or customer data configured.`);
