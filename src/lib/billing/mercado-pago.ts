import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getMercadoPagoEnvironment, getMercadoPagoEnvironmentFallback, type MercadoPagoEnvironment } from "@/lib/billing/platform-runtime";
import { resolveMercadoPagoCredentials, resolveMercadoPagoApplicationId } from "@/lib/billing/mercado-pago-runtime-helpers";

const API_BASE_URL = "https://api.mercadopago.com";

export class MercadoPagoBillingConfigurationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "MercadoPagoBillingConfigurationError";
    }
}

export class MercadoPagoApiError extends Error {
    constructor(readonly status: number, message: string) {
        super(message);
        this.name = "MercadoPagoApiError";
    }
}

export function isMercadoPagoBillingEnabled() {
    return process.env.MERCADO_PAGO_ENABLED === "true";
}

export type MercadoPagoRuntimeConfiguration = {
    environment: MercadoPagoEnvironment;
    applicationId: string;
    accessToken: string;
    webhookSecret: string;
};

function environmentCredentials(environment: MercadoPagoEnvironment) {
    return resolveMercadoPagoCredentials(process.env, environment, getMercadoPagoEnvironmentFallback());
}

export async function getMercadoPagoRuntimeConfiguration(): Promise<MercadoPagoRuntimeConfiguration> {
    if (!isMercadoPagoBillingEnabled()) {
        throw new MercadoPagoBillingConfigurationError("El cobro con Mercado Pago aún no está habilitado.");
    }
    const environment = await getMercadoPagoEnvironment();
    const applicationId = resolveMercadoPagoApplicationId(process.env, environment);
    const { accessToken, webhookSecret } = environmentCredentials(environment);
    if (!applicationId) throw new MercadoPagoBillingConfigurationError("Falta configurar MERCADO_PAGO_APPLICATION_ID.");
    if (!accessToken) throw new MercadoPagoBillingConfigurationError(`Falta configurar el Access Token de ${environment === "production" ? "producción" : "prueba"}.`);
    if (!webhookSecret) throw new MercadoPagoBillingConfigurationError(`Falta configurar el secreto del webhook de ${environment === "production" ? "producción" : "prueba"}.`);
    return { environment, applicationId, accessToken, webhookSecret };
}

export function getMercadoPagoWebhookRuntimeConfigurations(): MercadoPagoRuntimeConfiguration[] {
    if (!isMercadoPagoBillingEnabled()) {
        throw new MercadoPagoBillingConfigurationError("El cobro con Mercado Pago aún no está habilitado.");
    }
    const configurations = (["test", "production"] as const).flatMap((environment) => {
        const applicationId = resolveMercadoPagoApplicationId(process.env, environment);
        const credentials = environmentCredentials(environment);
        return applicationId && credentials.accessToken && credentials.webhookSecret
            ? [{ environment, applicationId, ...credentials }]
            : [];
    });
    if (!configurations.length) throw new MercadoPagoBillingConfigurationError("No hay credenciales completas de Mercado Pago.");
    return configurations;
}

async function requestMercadoPago<T>(runtime: MercadoPagoRuntimeConfiguration, path: string, init?: RequestInit & { idempotencyKey?: string }): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${path}`, {
        ...init,
        signal: init?.signal || AbortSignal.timeout(8_000),
        cache: "no-store",
        headers: {
            Authorization: `Bearer ${runtime.accessToken}`,
            "Content-Type": "application/json",
            ...(init?.idempotencyKey ? { "X-Idempotency-Key": init.idempotencyKey } : {}),
            ...init?.headers,
        },
    });
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) {
        const providerMessage = typeof payload?.message === "string" ? payload.message : "Respuesta no válida del proveedor.";
        throw new MercadoPagoApiError(response.status, providerMessage);
    }
    return payload as T;
}

export type MercadoPagoPreference = {
    id: string;
    init_point?: string;
    sandbox_init_point?: string;
    environment: MercadoPagoEnvironment;
};

export async function createMercadoPagoPreference(input: {
    idempotencyKey: string;
    externalReference: string;
    title: string;
    description: string;
    amountCents: number;
    currency: string;
    payerEmail: string;
    successUrl: string;
    pendingUrl: string;
    failureUrl: string;
    notificationUrl: string;
    tenantId: string;
    planId: string;
    runtime?: MercadoPagoRuntimeConfiguration;
    expiresAt?: Date;
}) {
    const runtime = input.runtime || await getMercadoPagoRuntimeConfiguration();
    const preference = await requestMercadoPago<Omit<MercadoPagoPreference, "environment">>(runtime, "/checkout/preferences", {
        method: "POST",
        idempotencyKey: input.idempotencyKey,
        body: JSON.stringify({
            items: [{
                id: input.planId,
                title: input.title,
                description: input.description,
                quantity: 1,
                currency_id: input.currency,
                unit_price: input.amountCents / 100,
            }],
            payer: { email: input.payerEmail },
            external_reference: input.externalReference,
            back_urls: {
                success: input.successUrl,
                pending: input.pendingUrl,
                failure: input.failureUrl,
            },
            auto_return: "approved",
            notification_url: input.notificationUrl,
            statement_descriptor: "SYNAPSELOGIK",
            ...(input.expiresAt ? { expires: true, expiration_date_from: new Date().toISOString(), expiration_date_to: input.expiresAt.toISOString() } : {}),
            metadata: {
                checkout_attempt_id: input.idempotencyKey,
                tenant_id: input.tenantId,
                plan_id: input.planId,
            },
        }),
    });
    return { ...preference, environment: runtime.environment };
}

export type MercadoPagoPayment = {
    id: number | string;
    status?: string;
    status_detail?: string;
    external_reference?: string | null;
    transaction_amount?: number;
    currency_id?: string;
    date_approved?: string | null;
    live_mode?: boolean;
    application_id?: number | string | null;
    payer?: { id?: number | string | null; email?: string | null };
};

export type MercadoPagoPreapproval = {
    id: string;
    application_id?: string | number;
    external_reference?: string | number;
    status?: string;
    init_point?: string;
    next_payment_date?: string;
    last_modified?: string;
    auto_recurring?: { frequency?: number; frequency_type?: string; transaction_amount?: number | string; currency_id?: string; start_date?: string };
};

export type MercadoPagoInvoice = {
    id: string | number;
    preapproval_id?: string;
    external_reference?: string | number;
    debit_date?: string;
    currency_id?: string;
    transaction_amount?: number | string;
    payment?: { id?: string | number; status?: string };
};

export function isMercadoPagoSubscriptionsEnabled() {
    return isMercadoPagoBillingEnabled() && process.env.MERCADO_PAGO_SUBSCRIPTIONS_ENABLED === "true";
}

/** Existing agreements always use their original environment, never the control-panel selector. */
export function getMercadoPagoAgreementRuntime(environment: string, applicationId: string) {
    const runtime = getMercadoPagoWebhookRuntimeConfigurations().find((item) => item.environment === environment && item.applicationId === applicationId);
    if (!runtime) throw new MercadoPagoBillingConfigurationError("Faltan las credenciales originales de la suscripción.");
    return runtime;
}

export function createMercadoPagoPreapproval(runtime: MercadoPagoRuntimeConfiguration, input: {
    externalReference: string; title: string; payerEmail: string; amountCents: number; currency: string; startsAt: Date; backUrl: string;
}) {
    return requestMercadoPago<MercadoPagoPreapproval>(runtime, "/preapproval", {
        method: "POST",
        body: JSON.stringify({
            reason: input.title, external_reference: input.externalReference, payer_email: input.payerEmail,
            auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: input.amountCents / 100, currency_id: input.currency, start_date: input.startsAt.toISOString() },
            back_url: input.backUrl, status: "pending",
        }),
    });
}

export function getMercadoPagoPreapproval(id: string, runtime: MercadoPagoRuntimeConfiguration) {
    return requestMercadoPago<MercadoPagoPreapproval>(runtime, `/preapproval/${encodeURIComponent(id)}`);
}

export function cancelMercadoPagoPreapproval(id: string, runtime: MercadoPagoRuntimeConfiguration) {
    return requestMercadoPago<MercadoPagoPreapproval>(runtime, `/preapproval/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ status: "canceled" }) });
}

/** Change only the recurring price: never restart/reactivate or shift the billing date. */
export function updateMercadoPagoSubscriptionPrice(id: string, amountCents: number, currency: string, runtime: MercadoPagoRuntimeConfiguration) {
    return requestMercadoPago<MercadoPagoPreapproval>(runtime, `/preapproval/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ auto_recurring: { transaction_amount: amountCents / 100, currency_id: currency } }) });
}

export function refundMercadoPagoPayment(id: string, idempotencyKey: string, runtime: MercadoPagoRuntimeConfiguration) {
    return requestMercadoPago<{ id?: number | string }>(runtime, `/v1/payments/${encodeURIComponent(id)}/refunds`, { method: "POST", idempotencyKey, body: "{}" });
}

export function searchMercadoPagoPreapprovals(reference: string, runtime: MercadoPagoRuntimeConfiguration) {
    return requestMercadoPago<{ results?: MercadoPagoPreapproval[] }>(runtime, `/preapproval/search?external_reference=${encodeURIComponent(reference)}&limit=100`);
}

export function getMercadoPagoInvoice(id: string, runtime: MercadoPagoRuntimeConfiguration) {
    return requestMercadoPago<MercadoPagoInvoice>(runtime, `/authorized_payments/${encodeURIComponent(id)}`);
}

export function searchMercadoPagoInvoices(filters: { preapproval_id?: string; payment_id?: string; offset?: number; limit?: number }, runtime: MercadoPagoRuntimeConfiguration) {
    return requestMercadoPago<{ results?: MercadoPagoInvoice[]; paging?: { total?: number } }>(runtime, `/authorized_payments/search?${new URLSearchParams(Object.entries({ limit: 20, ...filters }).map(([key, value]) => [key, String(value)]))}`);
}

export function getMercadoPagoPayment(paymentId: string, runtime: MercadoPagoRuntimeConfiguration) {
    return requestMercadoPago<MercadoPagoPayment>(runtime, `/v1/payments/${encodeURIComponent(paymentId)}`);
}

export function searchMercadoPagoPayments(reference: string, runtime: MercadoPagoRuntimeConfiguration) {
    return requestMercadoPago<{ results?: MercadoPagoPayment[] }>(runtime, `/v1/payments/search?external_reference=${encodeURIComponent(reference)}&sort=date_created&criteria=desc&limit=50`);
}

export function verifyMercadoPagoWebhookSignature(input: {
    xSignature: string;
    xRequestId: string | null;
    dataId: string | null;
    secret: string;
}) {
    const parts = new Map(input.xSignature.split(",").map((part) => {
        const [key, ...value] = part.trim().split("=");
        return [key, value.join("=")];
    }));
    const timestamp = parts.get("ts");
    const received = parts.get("v1");
    if (!timestamp || !received || !/^[a-f0-9]{64}$/i.test(received)) return false;

    let manifest = "";
    if (input.dataId) manifest += `id:${input.dataId.toLowerCase()};`;
    if (input.xRequestId) manifest += `request-id:${input.xRequestId};`;
    manifest += `ts:${timestamp};`;
    const expected = createHmac("sha256", input.secret).update(manifest).digest("hex");
    const expectedBuffer = Buffer.from(expected, "hex");
    const receivedBuffer = Buffer.from(received, "hex");
    return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}
