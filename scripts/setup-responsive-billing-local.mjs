import { config } from "dotenv";
import { Pool } from "pg";
config({ path: ".env.local", quiet: true });
const tenantUrl =
  "postgresql://crm_local:local_training_only@127.0.0.1:5446/crm_training";
const controlUrl =
  "postgresql://crm_local:local_training_only@127.0.0.1:5446/crm_retention_control";
if (
  process.env.NODE_ENV === "production" ||
  process.env.DATABASE_URL !== tenantUrl ||
  process.env.CONTROL_DATABASE_URL !== controlUrl
)
  throw new Error("Only dedicated localhost UI fixtures are allowed.");
const mode = process.argv[2] || "trial";
if (!["trial", "active", "pending", "overdue", "canceled"].includes(mode))
  throw new Error("Unknown fixture mode");
const pool = new Pool({ connectionString: controlUrl });
const db = await pool.connect();
const tenantId = "localexpirytest";
try {
  await db.query("BEGIN");
  const other = await db.query(
    'SELECT id FROM "Subscription" WHERE "tenantId"=$1 AND id<>$2',
    [tenantId, "ui-billing-subscription"],
  );
  const agreements = await db.query(
    'SELECT id FROM "MercadoPagoAgreement" WHERE "tenantId"=$1 AND id<>$2',
    [tenantId, "ui-billing-agreement"],
  );
  if (other.rowCount || agreements.rowCount)
    throw new Error("Refusing to alter a tenant with other billing data.");
  for (const [slug, name, amount, limit] of [
    ["esencial", "Esencial", 29900, 1000],
    ["automatiza", "Crecimiento", 49900, 3000],
    ["pro", "Elite", 79900, 10000],
  ]) {
    await db.query(
      `INSERT INTO "Plan" (id,slug,name,currency,"monthlyAmountCents",limits,features,"isActive","updatedAt") VALUES ($1,$2,$3,'MXN',$4,$5::jsonb,'{"chatbot":true}'::jsonb,true,NOW()) ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name,"monthlyAmountCents"=EXCLUDED."monthlyAmountCents",limits=EXCLUDED.limits,features=EXCLUDED.features,"isActive"=true,"updatedAt"=NOW()`,
      [
        "ui-billing-plan-" + slug,
        slug,
        name,
        amount,
        JSON.stringify({ chatbotMessagesPerMonth: limit }),
      ],
    );
  }
  await db.query('DELETE FROM "Subscription" WHERE id=$1 AND "tenantId"=$2', [
    "ui-billing-subscription",
    tenantId,
  ]);
  await db.query(
    'DELETE FROM "MercadoPagoAgreement" WHERE id=$1 AND "tenantId"=$2',
    ["ui-billing-agreement", tenantId],
  );
  const expired = mode === "overdue";
  const end = new Date(Date.now() + (expired ? -2 : 23) * 86400000);
  await db.query(
    'UPDATE "Trial" SET status=$1,"endsAt"=$2,"expiredAt"=$3,"updatedAt"=NOW() WHERE id=$4',
    [
      mode === "trial" ? "ACTIVE" : "EXPIRED",
      mode === "trial" ? end : new Date(Date.now() - 30 * 86400000),
      mode === "trial" ? null : new Date(Date.now() - 30 * 86400000),
      "local-expiry-trial",
    ],
  );
  await db.query(
    'UPDATE "Tenant" SET "accessMode"=$1,"billingStatus"=$2,"updatedAt"=NOW() WHERE id=$3',
    [
      expired ? "BILLING_ONLY" : "FULL",
      mode === "trial"
        ? "TRIALING"
        : expired
          ? "PAST_DUE"
          : mode === "pending"
            ? "INCOMPLETE"
            : "ACTIVE",
      tenantId,
    ],
  );
  if (mode !== "trial") {
    const plan = (
      await db.query('SELECT id FROM "Plan" WHERE slug=$1', ["automatiza"])
    ).rows[0];
    const user = (
      await db.query(
        'SELECT "userId" FROM "TenantMembership" WHERE "tenantId"=$1 AND role=$2 LIMIT 1',
        [tenantId, "OWNER"],
      )
    ).rows[0];
    const start = new Date(Date.now() - 7 * 86400000);
    await db.query(
      `INSERT INTO "MercadoPagoAgreement" (id,"tenantId","planId","activeKey","externalReference","providerSubscriptionId",environment,"applicationId","amountCents",currency,status,"startsAt","nextPaymentAt","consentAt","consentUserId","consentVersion","lastError","updatedAt") VALUES ($1,$2,$3,$4,'ui-billing-reference','ui-billing-provider-subscription','test','LOCAL_UI_ONLY',49900,'MXN',$5,$6,$7,NOW(),$8,'local-ui-only',$9,NOW())`,
      [
        "ui-billing-agreement",
        tenantId,
        plan.id,
        mode === "canceled" ? null : tenantId,
        mode === "pending"
          ? "PENDING"
          : mode === "canceled"
            ? "CANCELED"
            : "AUTHORIZED",
        start,
        end,
        user.userId,
        expired
          ? "Ejemplo local: no se confirmó el último pago. Revisa tu medio de pago en Mercado Pago antes de reintentar. Referencia_de_prueba_con_texto_largo_para_comprobar_su_lectura_en_celular."
          : null,
      ],
    );
    await db.query(
      `INSERT INTO "Subscription" (id,"tenantId","planId",provider,"providerSubscriptionId",status,"currentPeriodStartsAt","currentPeriodEndsAt","updatedAt") VALUES ($1,$2,$3,'MERCADO_PAGO','ui-billing-provider-subscription',$4,$5,$6,NOW())`,
      [
        "ui-billing-subscription",
        tenantId,
        plan.id,
        mode === "pending"
          ? "INCOMPLETE"
          : expired
            ? "PAST_DUE"
            : mode === "canceled"
              ? "CANCELED"
              : "ACTIVE",
        mode === "pending" ? null : start,
        mode === "pending" ? null : end,
      ],
    );
  }
  await db.query("COMMIT");
  console.log(
    `Dedicated local billing fixtures: ${mode}. No migrations or provider calls.`,
  );
} catch (error) {
  await db.query("ROLLBACK");
  throw error;
} finally {
  db.release();
  await pool.end();
}
