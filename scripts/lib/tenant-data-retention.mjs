import { workspaceBillingState } from "./billing-retention-policy.mjs";

export const RETENTION_SNAPSHOT_SQL = `SELECT t.id, t.status, t."accessMode", t."billingStatus", t."timeZone",
    (SELECT jsonb_build_object('status',tr.status,'endsAt',tr."endsAt" AT TIME ZONE 'UTC') FROM "Trial" tr WHERE tr."tenantId"=t.id) AS trial,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('status',s.status,'currentPeriodEndsAt',s."currentPeriodEndsAt" AT TIME ZONE 'UTC','pastDueAt',s."pastDueAt" AT TIME ZONE 'UTC')) FROM "Subscription" s WHERE s."tenantId"=t.id),'[]'::jsonb) AS subscriptions
    FROM "Tenant" t WHERE t.id=$1`;

// Prisma stores DateTime as UTC timestamp-without-zone. node-postgres otherwise interprets
// those columns in the worker's local timezone, shifting deadlines on a Mexican host.
export const RETENTION_JOB_COLUMNS = `"tenantId",status,"expiredAt" AT TIME ZONE 'UTC' AS "expiredAt",
    "warningAt" AT TIME ZONE 'UTC' AS "warningAt","deletionAt" AT TIME ZONE 'UTC' AS "deletionAt",
    "nextRunAt" AT TIME ZONE 'UTC' AS "nextRunAt","claimedAt" AT TIME ZONE 'UTC' AS "claimedAt"`;

/** Each snapshot is checked again under the same tenant lock used by recurring payments. */
export async function synchronizeTenantRetention(pool, { limit = 100, now = new Date() } = {}) {
    const candidates = (await pool.query(`SELECT t.id FROM "Tenant" t
        LEFT JOIN "TenantDataRetention" r ON r."tenantId"=t.id
        WHERE t.status='READY' AND t."accessMode"<>'SUSPENDED'
          AND (EXISTS (SELECT 1 FROM "Trial" tr WHERE tr."tenantId"=t.id)
               OR EXISTS (SELECT 1 FROM "Subscription" s WHERE s."tenantId"=t.id))
          AND (r.status IS NULL OR r.status NOT IN ('PURGING','RETRY','COMPLETED'))
        ORDER BY COALESCE(r."updatedAt",TIMESTAMP '1970-01-01'),t.id LIMIT $1`, [limit])).rows;
    let scheduled = 0;
    for (const candidate of candidates) {
        const tx = await pool.connect();
        try {
            await tx.query("BEGIN");
            await tx.query('SELECT id FROM "Tenant" WHERE id=$1 FOR UPDATE', [candidate.id]);
            const tenant = (await tx.query(RETENTION_SNAPSHOT_SQL, [candidate.id])).rows[0];
            const previous = (await tx.query(`SELECT ${RETENTION_JOB_COLUMNS} FROM "TenantDataRetention" WHERE "tenantId"=$1 FOR UPDATE`, [candidate.id])).rows[0];
            if (!tenant || ["PURGING", "RETRY", "COMPLETED"].includes(previous?.status)) { await tx.query("COMMIT"); continue; }
            const state = workspaceBillingState(tenant, now);
            if (state.notice) {
                const { expiredAt, warningAt, deletionAt } = state.notice;
                // Never erase an old workspace immediately when first adopting this policy.
                // Overdue records first discovered after their deadline require manual review.
                const sameExpiry = previous && new Date(previous.expiredAt).toISOString() === expiredAt;
                const status = sameExpiry && previous.status === "REVIEW_REQUIRED" || !sameExpiry && new Date(deletionAt) <= now ? "REVIEW_REQUIRED" : "RETAINED";
                await tx.query(`INSERT INTO "TenantDataRetention" ("tenantId","expiredAt","warningAt","deletionAt",status,"nextRunAt","createdAt","updatedAt")
                    VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
                    ON CONFLICT ("tenantId") DO UPDATE SET "expiredAt"=EXCLUDED."expiredAt","warningAt"=EXCLUDED."warningAt","deletionAt"=EXCLUDED."deletionAt",
                        status=EXCLUDED.status,"nextRunAt"=CASE WHEN "TenantDataRetention"."expiredAt"=EXCLUDED."expiredAt" THEN GREATEST("TenantDataRetention"."nextRunAt",EXCLUDED."nextRunAt") ELSE EXCLUDED."nextRunAt" END,"claimedAt"=NULL,"lastError"=NULL,"updatedAt"=NOW()`,
                    [tenant.id, expiredAt, warningAt, deletionAt, status, deletionAt]);
                await tx.query('UPDATE "Tenant" SET "accessMode"=$2::"TenantAccessMode","updatedAt"=NOW() WHERE id=$1 AND status=\'READY\' AND "accessMode"<>\'SUSPENDED\'', [tenant.id, state.accessMode]);
                scheduled++;
            } else {
                // A verified renewal or an administrator-granted new trial cancels the old job.
                // Keep a row even for live accounts so batched scans do not starve newer tenants.
                await tx.query(`INSERT INTO "TenantDataRetention" ("tenantId","expiredAt","warningAt","deletionAt",status,"createdAt","updatedAt")
                    VALUES ($1,$2,$2,$2,'REACTIVATED',NOW(),NOW())
                    ON CONFLICT ("tenantId") DO UPDATE SET status='REACTIVATED',"claimedAt"=NULL,"lastError"=NULL,"updatedAt"=NOW()`, [tenant.id, now.toISOString()]);
                if (state.accessMode === "FULL") await tx.query('UPDATE "Tenant" SET "accessMode"=\'FULL\',"updatedAt"=NOW() WHERE id=$1 AND status=\'READY\' AND "accessMode"<>\'SUSPENDED\'', [tenant.id]);
            }
            await tx.query("COMMIT");
        } catch (error) { await tx.query("ROLLBACK").catch(() => {}); throw error; }
        finally { tx.release(); }
    }
    return scheduled;
}

/** Tenant-only cleanup: never delete the global login or another business owned by that user. */
export async function runTenantRetentionOnce(pool, admin, purgeTenant, now = new Date()) {
    const lock = await pool.connect();
    let tenantId;
    try {
        if (!(await lock.query("SELECT pg_try_advisory_lock(735190405) AS locked")).rows[0].locked) return false;
        const job = (await pool.query(`SELECT ${RETENTION_JOB_COLUMNS} FROM "TenantDataRetention" WHERE status IN ('RETAINED','PURGING','RETRY')
            AND "deletionAt"<=$1 AND "nextRunAt"<=$1 ORDER BY "deletionAt" LIMIT 1`, [now.toISOString()])).rows[0];
        if (!job) return false;
        tenantId = job.tenantId;
        await lock.query("BEGIN");
        await lock.query('SELECT id FROM "Tenant" WHERE id=$1 FOR UPDATE', [tenantId]);
        const tenant = (await lock.query(RETENTION_SNAPSHOT_SQL, [tenantId])).rows[0];
        const current = (await lock.query(`SELECT ${RETENTION_JOB_COLUMNS} FROM "TenantDataRetention" WHERE "tenantId"=$1 FOR UPDATE`, [tenantId])).rows[0];
        if (!current || !["RETAINED","PURGING","RETRY"].includes(current.status) || new Date(current.deletionAt) > now) { await lock.query("COMMIT"); return false; }
        const resuming = tenant?.status === "ARCHIVED" && tenant.accessMode === "SUSPENDED" && current.claimedAt && ["PURGING","RETRY"].includes(current.status);
        if (tenant && !resuming) {
            const state = workspaceBillingState(tenant, now);
            if (tenant.status !== "READY" || tenant.accessMode === "SUSPENDED" || !state.notice || state.notice.phase !== "DELETION_DUE"
                || state.notice.expiredAt !== new Date(current.expiredAt).toISOString() || state.notice.deletionAt !== new Date(current.deletionAt).toISOString()) {
                await lock.query('UPDATE "TenantDataRetention" SET status=\'REACTIVATED\',"updatedAt"=NOW() WHERE "tenantId"=$1', [tenantId]);
                await lock.query("COMMIT"); return false;
            }
            // An unsettled, recent payment is reconciled before any irreversible cleanup.
            const unsettled = await lock.query(`SELECT 1 FROM "BillingCheckoutAttempt" WHERE "tenantId"=$1
                AND status IN ('CREATED','PENDING') AND "createdAt">$2::timestamp-INTERVAL '48 hours' LIMIT 1`, [tenantId, now.toISOString()]);
            if (unsettled.rowCount) {
                await lock.query('UPDATE "TenantDataRetention" SET "nextRunAt"=$2,"updatedAt"=NOW() WHERE "tenantId"=$1', [tenantId, new Date(now.getTime() + 15 * 60_000).toISOString()]);
                await lock.query("COMMIT"); return false;
            }
            await lock.query('UPDATE "Tenant" SET status=\'ARCHIVED\',"accessMode"=\'SUSPENDED\',"updatedAt"=NOW() WHERE id=$1', [tenantId]);
            await lock.query('UPDATE "TenantMembership" SET "isActive"=false,"updatedAt"=NOW() WHERE "tenantId"=$1', [tenantId]);
        }
        await lock.query('UPDATE "TenantDataRetention" SET status=\'PURGING\',"claimedAt"=COALESCE("claimedAt",NOW()),"updatedAt"=NOW() WHERE "tenantId"=$1', [tenantId]);
        await lock.query("COMMIT");
        await purgeTenant(pool, admin, tenantId);
        await pool.query('UPDATE "TenantDataRetention" SET status=\'COMPLETED\',"completedAt"=NOW(),"lastError"=NULL,"updatedAt"=NOW() WHERE "tenantId"=$1', [tenantId]);
        return true;
    } catch {
        await lock.query("ROLLBACK").catch(() => {});
        if (tenantId) await pool.query('UPDATE "TenantDataRetention" SET status=\'RETRY\',"lastError"=\'cleanup_failed\',"nextRunAt"=(NOW() AT TIME ZONE \'UTC\')+INTERVAL \'1 minute\',"updatedAt"=NOW() WHERE "tenantId"=$1 AND "claimedAt" IS NOT NULL', [tenantId]);
        console.error("[Tenant retention] Cleanup failed; retry scheduled.");
        return false;
    } finally { await lock.query("SELECT pg_advisory_unlock(735190405)"); lock.release(); }
}
