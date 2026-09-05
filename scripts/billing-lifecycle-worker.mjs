import "dotenv/config";

import crypto from "node:crypto";
import { Pool } from "pg";
import Stripe from "stripe";

const controlDatabaseUrl = process.env.CONTROL_DATABASE_URL?.trim();
const maxBatch = positiveInteger(process.env.BILLING_LIFECYCLE_MAX_BATCH, 100);

if (!controlDatabaseUrl) throw new Error("CONTROL_DATABASE_URL is required by the billing lifecycle worker.");

function positiveInteger(value, fallback) {
    const parsed = Number.parseInt(value || "", 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function createId() {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 25);
}

function publicBaseUrl() {
    const raw = process.env.APP_BASE_URL?.trim() || process.env.AUTH_URL?.trim() || process.env.NEXTAUTH_URL?.trim();
    return raw ? new URL(raw).origin : null;
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character);
}

function formatDate(value, timeZone) {
    return new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeStyle: "short", timeZone: timeZone || "America/Mexico_City" }).format(value);
}

async function sendLifecycleEmail(pool, item, template, subject, title, copy) {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    const from = process.env.EMAIL_FROM?.trim();
    const baseUrl = publicBaseUrl();
    if (!apiKey || !from || !baseUrl || !item.email) return false;
    const url = `${baseUrl}/billing/${encodeURIComponent(item.slug)}`;
    const deliveryId = createId();
    await pool.query(
        `INSERT INTO "EmailDelivery" (id, "userId", "recipientEmail", template, provider, status, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, 'resend', 'PENDING', NOW(), NOW())`,
        [deliveryId, item.userId, item.email, template],
    );
    try {
        const response = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                from,
                to: item.email,
                subject,
                text: `${copy} ${url}`,
                html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#172033;line-height:1.5"><h1 style="font-size:22px">${escapeHtml(title)}</h1><p>${escapeHtml(copy)}</p><p><a href="${escapeHtml(url)}" style="display:inline-block;background:#268bad;color:white;padding:12px 18px;border-radius:999px;text-decoration:none;font-weight:600">Ver planes</a></p></body></html>`,
                ...(process.env.EMAIL_REPLY_TO?.trim() ? { reply_to: process.env.EMAIL_REPLY_TO.trim() } : {}),
            }),
            signal: AbortSignal.timeout(20_000),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof payload.message === "string" ? payload.message : `resend_${response.status}`);
        await pool.query(`UPDATE "EmailDelivery" SET status='SENT', "externalId"=$2, "sentAt"=NOW(), "updatedAt"=NOW() WHERE id=$1`, [deliveryId, typeof payload.id === "string" ? payload.id : null]);
        return true;
    } catch (error) {
        await pool.query(`UPDATE "EmailDelivery" SET status='FAILED', "errorCode"=$2, "updatedAt"=NOW() WHERE id=$1`, [deliveryId, String(error instanceof Error ? error.message : error).slice(0, 160)]);
        throw error;
    }
}

async function warningCandidates(pool, field, hoursExpression) {
    const lowerBound = field === "warningSentAt" ? `AND tr."endsAt">NOW()+(24*INTERVAL '1 hour')` : "";
    const { rows } = await pool.query(
        `SELECT tr.id, tr."endsAt", tr."tenantId", t.slug, t."displayName", t."timeZone", u.id AS "userId", u.email
         FROM "Trial" tr
         INNER JOIN "Tenant" t ON t.id=tr."tenantId"
         LEFT JOIN LATERAL (
            SELECT u.id, u.email FROM "TenantMembership" m INNER JOIN "User" u ON u.id=m."userId"
            WHERE m."tenantId"=tr."tenantId" AND m.role='OWNER' AND m."isActive"=true ORDER BY m."createdAt" LIMIT 1
         ) u ON true
         WHERE tr.status IN ('ACTIVE','ENDING') AND tr."endsAt">NOW()
           AND tr."endsAt"<=NOW()+(COALESCE(${hoursExpression}, 48)*INTERVAL '1 hour')
           ${lowerBound}
           AND tr."${field}" IS NULL
         ORDER BY tr."endsAt" LIMIT $1`,
        [maxBatch],
    );
    return rows;
}

async function processWarnings(pool, field, hoursExpression, template, isFinal) {
    let sent = 0;
    for (const item of await warningCandidates(pool, field, hoursExpression)) {
        const claim = await pool.query(`UPDATE "Trial" SET "${field}"=NOW(), status='ENDING', "updatedAt"=NOW() WHERE id=$1 AND "${field}" IS NULL RETURNING id`, [item.id]);
        if (!claim.rowCount) continue;
        const remaining = Math.max(1, Math.ceil((new Date(item.endsAt).getTime() - Date.now()) / 3_600_000));
        const unit = remaining <= 24 ? "menos de un día" : `${Math.ceil(remaining / 24)} días`;
        try {
            const copy = `A tu prueba de ${item.displayName} le quedan ${unit}. Termina el ${formatDate(new Date(item.endsAt), item.timeZone)}. Elige un plan para conservar el acceso.`;
            const delivered = await sendLifecycleEmail(pool, item, template, isFinal ? "Tu prueba termina mañana" : "Te quedan 2 días de prueba", isFinal ? "Tu prueba termina pronto" : "Te quedan 2 días de prueba", copy);
            if (!delivered) {
                await pool.query(`UPDATE "Trial" SET "${field}"=NULL, "updatedAt"=NOW() WHERE id=$1`, [item.id]);
                continue;
            }
            await pool.query(`INSERT INTO "CommercialEvent" (id, "tenantId", "userId", event, source, metadata, "createdAt") VALUES ($1,$2,$3,$4,'billing_worker',$5::jsonb,NOW())`, [createId(), item.tenantId, item.userId, isFinal ? "trial_final_warning" : "trial_warning", JSON.stringify({ remainingHours: remaining })]);
            sent += 1;
        } catch (error) {
            await pool.query(`UPDATE "Trial" SET "${field}"=NULL, "updatedAt"=NOW() WHERE id=$1`, [item.id]);
            console.error(`[Billing lifecycle] ${template} failed for ${item.tenantId}:`, error instanceof Error ? error.message : error);
        }
    }
    return sent;
}

async function expireTrials(pool) {
    const client = await pool.connect();
    let expired = 0;
    try {
        await client.query("BEGIN");
        const { rows } = await client.query(
            `SELECT tr.id, tr."tenantId" FROM "Trial" tr
             WHERE tr.status IN ('ACTIVE','ENDING') AND tr."endsAt"<=NOW()
               AND NOT EXISTS (
                 SELECT 1 FROM "Subscription" s WHERE s."tenantId"=tr."tenantId" AND s.status IN ('ACTIVE','TRIALING')
               )
             ORDER BY tr."endsAt" FOR UPDATE OF tr SKIP LOCKED LIMIT $1`,
            [maxBatch],
        );
        for (const item of rows) {
            await client.query(`UPDATE "Trial" SET status='EXPIRED', "expiredAt"=COALESCE("expiredAt",NOW()), "updatedAt"=NOW() WHERE id=$1`, [item.id]);
            await client.query(`UPDATE "Tenant" SET "billingStatus"='CANCELED', "accessMode"='BILLING_ONLY', "updatedAt"=NOW() WHERE id=$1`, [item.tenantId]);
            await client.query(`INSERT INTO "CommercialEvent" (id,"tenantId",event,source,"createdAt") VALUES ($1,$2,'trial_expired','billing_worker',NOW())`, [createId(), item.tenantId]);
            expired += 1;
        }
        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        client.release();
    }
    return expired;
}

function subscriptionState(value) {
    const status = String(value || "incomplete").toUpperCase();
    return ["TRIALING", "ACTIVE", "PAST_DUE", "UNPAID", "CANCELED", "INCOMPLETE", "INCOMPLETE_EXPIRED", "PAUSED"].includes(status)
        ? status
        : "INCOMPLETE";
}

async function activateScheduledSelections(pool) {
    const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
    if (!secretKey || process.env.BILLING_STRIPE_ENABLED !== "true") return 0;
    const stripe = new Stripe(secretKey);
    let activated = 0;
    for (let index = 0; index < maxBatch; index += 1) {
        const { rows } = await pool.query(
            `UPDATE "BillingSelection" SET status='PROCESSING', "updatedAt"=NOW()
             WHERE id=(
                SELECT s.id FROM "BillingSelection" s
                WHERE s.status='SCHEDULED' AND s."scheduledFor"<=NOW()
                ORDER BY s."scheduledFor" FOR UPDATE SKIP LOCKED LIMIT 1
             ) RETURNING *`,
        );
        const selection = rows[0];
        if (!selection) break;
        try {
            const price = (await pool.query(`SELECT "externalPriceId" FROM "BillingPrice" WHERE id=$1 AND provider='STRIPE' AND "isActive"=true`, [selection.billingPriceId])).rows[0];
            if (!price?.externalPriceId) throw new Error("stripe_price_unavailable");
            const tenant = (await pool.query(`SELECT slug FROM "Tenant" WHERE id=$1`, [selection.tenantId])).rows[0];
            if (!tenant) throw new Error("tenant_unavailable");
            const subscription = await stripe.subscriptions.create({
                customer: selection.providerCustomerId,
                items: [{ price: price.externalPriceId }],
                default_payment_method: selection.providerPaymentMethod,
                payment_behavior: "default_incomplete",
                payment_settings: { save_default_payment_method: "on_subscription" },
                metadata: { tenantId: selection.tenantId, tenantSlug: tenant.slug, planId: selection.planId },
            }, { idempotencyKey: `billing-selection:${selection.id}` });
            const status = subscriptionState(subscription.status);
            const starts = subscription.items.data.map((item) => item.current_period_start).filter(Number.isFinite);
            const ends = subscription.items.data.map((item) => item.current_period_end).filter(Number.isFinite);
            const client = await pool.connect();
            try {
                await client.query("BEGIN");
                await client.query(
                    `INSERT INTO "Subscription" (id,"tenantId","planId",provider,"providerCustomerId","providerSubscriptionId",status,"currentPeriodStartsAt","currentPeriodEndsAt","createdAt","updatedAt")
                     VALUES ($1,$2,$3,'STRIPE',$4,$5,$6::"SubscriptionStatus",$7,$8,NOW(),NOW())
                     ON CONFLICT ("providerSubscriptionId") DO UPDATE SET status=EXCLUDED.status,"currentPeriodStartsAt"=EXCLUDED."currentPeriodStartsAt","currentPeriodEndsAt"=EXCLUDED."currentPeriodEndsAt","updatedAt"=NOW()`,
                    [createId(), selection.tenantId, selection.planId, selection.providerCustomerId, subscription.id, status, starts.length ? new Date(Math.min(...starts) * 1_000) : null, ends.length ? new Date(Math.max(...ends) * 1_000) : null],
                );
                await client.query(`UPDATE "BillingSelection" SET status='ACTIVATED', "activatedAt"=NOW(), "lastError"=NULL, "updatedAt"=NOW() WHERE id=$1`, [selection.id]);
                if (status === "ACTIVE" || status === "TRIALING") {
                    await client.query(`UPDATE "Tenant" SET "billingStatus"=$2::"BillingStatus", "accessMode"='FULL', "updatedAt"=NOW() WHERE id=$1`, [selection.tenantId, status]);
                    await client.query(`UPDATE "Trial" SET status='CONVERTED', "convertedAt"=COALESCE("convertedAt",NOW()), "updatedAt"=NOW() WHERE "tenantId"=$1 AND status<>'CONVERTED'`, [selection.tenantId]);
                }
                await client.query(`INSERT INTO "CommercialEvent" (id,"tenantId",event,source,metadata,"createdAt") VALUES ($1,$2,'scheduled_plan_activated','billing_worker',$3::jsonb,NOW())`, [createId(), selection.tenantId, JSON.stringify({ planId: selection.planId, subscriptionStatus: status })]);
                await client.query("COMMIT");
            } catch (error) {
                await client.query("ROLLBACK").catch(() => {});
                throw error;
            } finally {
                client.release();
            }
            activated += 1;
        } catch (error) {
            const message = String(error instanceof Error ? error.message : error).slice(0, 1000);
            await pool.query(`UPDATE "BillingSelection" SET status='FAILED', "lastError"=$2, "updatedAt"=NOW() WHERE id=$1`, [selection.id, message]);
            await pool.query(`INSERT INTO "CommercialEvent" (id,"tenantId",event,source,metadata,"createdAt") VALUES ($1,$2,'scheduled_plan_failed','billing_worker',$3::jsonb,NOW())`, [createId(), selection.tenantId, JSON.stringify({ reason: message })]);
        }
    }
    return activated;
}

async function expirePaymentGrace(pool) {
    const { rows } = await pool.query(
        `UPDATE "Tenant" t SET "accessMode"='BILLING_ONLY', "updatedAt"=NOW()
         FROM "Subscription" s
         WHERE s."tenantId"=t.id AND s.status='PAST_DUE' AND s."graceEndsAt"<=NOW() AND t."accessMode"<>'BILLING_ONLY'
         RETURNING t.id`,
    );
    return rows.length;
}

const pool = new Pool({ connectionString: controlDatabaseUrl });
try {
    const warning48 = await processWarnings(pool, "warningSentAt", 'tr."warningHours"', "trial_ending_48h", false);
    const warning24 = await processWarnings(pool, "finalWarningAt", 'tr."finalWarningHours"', "trial_ending_24h", true);
    const selectionsActivated = await activateScheduledSelections(pool);
    const expired = await expireTrials(pool);
    const graceExpired = await expirePaymentGrace(pool);
    console.log(`[Billing lifecycle] warnings48=${warning48} warnings24=${warning24} selectionsActivated=${selectionsActivated} expired=${expired} graceExpired=${graceExpired}`);
} finally {
    await pool.end();
}
