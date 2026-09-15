import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

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

function getAccessToken() {
    if (!isMercadoPagoBillingEnabled()) {
        throw new MercadoPagoBillingConfigurationError("El cobro con Mercado Pago aún no está habilitado.");
    }
    const value = process.env.MERCADO_PAGO_ACCESS_TOKEN?.trim();
    if (!value) throw new MercadoPagoBillingConfigurationError("Falta configurar MERCADO_PAGO_ACCESS_TOKEN.");
    return value;
}

export function getMercadoPagoWebhookSecret() {
    const value = process.env.MERCADO_PAGO_WEBHOOK_SECRET?.trim();
    if (!value) throw new MercadoPagoBillingConfigurationError("Falta configurar MERCADO_PAGO_WEBHOOK_SECRET.");
    return value;
}

export function isMercadoPagoProduction() {
    return process.env.MERCADO_PAGO_ENVIRONMENT?.trim().toLowerCase() === "production";
}

async function requestMercadoPago<T>(path: string, init?: RequestInit & { idempotencyKey?: string }): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${path}`, {
        ...init,
        cache: "no-store",
        headers: {
            Authorization: `Bearer ${getAccessToken()}`,
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
    return requestMercadoPago<MercadoPagoPreference>("/checkout/preferences", {
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

export function getMercadoPagoPayment(paymentId: string) {
    return requestMercadoPago<MercadoPagoPayment>(`/v1/payments/${encodeURIComponent(paymentId)}`);
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

