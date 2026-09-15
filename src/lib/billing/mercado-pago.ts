import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getMercadoPagoEnvironment, getMercadoPagoEnvironmentFallback, type MercadoPagoEnvironment } from "@/lib/billing/platform-runtime";

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
    const legacyEnvironment = getMercadoPagoEnvironmentFallback();
    return {
        accessToken: (environment === "production"
            ? process.env.MERCADO_PAGO_PRODUCTION_ACCESS_TOKEN
            : process.env.MERCADO_PAGO_TEST_ACCESS_TOKEN)?.trim()
            || (environment === legacyEnvironment ? process.env.MERCADO_PAGO_ACCESS_TOKEN?.trim() : "")
            || "",
        webhookSecret: (environment === "production"
            ? process.env.MERCADO_PAGO_PRODUCTION_WEBHOOK_SECRET
            : process.env.MERCADO_PAGO_TEST_WEBHOOK_SECRET)?.trim()
            || (environment === legacyEnvironment ? process.env.MERCADO_PAGO_WEBHOOK_SECRET?.trim() : "")
            || "",
    };
}

export async function getMercadoPagoRuntimeConfiguration(): Promise<MercadoPagoRuntimeConfiguration> {
    if (!isMercadoPagoBillingEnabled()) {
        throw new MercadoPagoBillingConfigurationError("El cobro con Mercado Pago aún no está habilitado.");
    }
    const environment = await getMercadoPagoEnvironment();
    const applicationId = process.env.MERCADO_PAGO_APPLICATION_ID?.trim() || "";
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
    const applicationId = process.env.MERCADO_PAGO_APPLICATION_ID?.trim() || "";
    if (!applicationId) throw new MercadoPagoBillingConfigurationError("Falta configurar MERCADO_PAGO_APPLICATION_ID.");
    const configurations = (["test", "production"] as const).flatMap((environment) => {
        const credentials = environmentCredentials(environment);
        return credentials.accessToken && credentials.webhookSecret
            ? [{ environment, applicationId, ...credentials }]
            : [];
    });
    if (!configurations.length) throw new MercadoPagoBillingConfigurationError("No hay credenciales completas de Mercado Pago.");
    return configurations;
}

async function requestMercadoPago<T>(runtime: MercadoPagoRuntimeConfiguration, path: string, init?: RequestInit & { idempotencyKey?: string }): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${path}`, {
        ...init,
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
}) {
    const runtime = await getMercadoPagoRuntimeConfiguration();
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

export function getMercadoPagoPayment(paymentId: string, runtime: MercadoPagoRuntimeConfiguration) {
    return requestMercadoPago<MercadoPagoPayment>(runtime, `/v1/payments/${encodeURIComponent(paymentId)}`);
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
