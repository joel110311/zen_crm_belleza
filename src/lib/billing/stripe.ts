import "server-only";
import Stripe from "stripe";

export class StripeBillingConfigurationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "StripeBillingConfigurationError";
    }
}

export function isStripeBillingEnabled(): boolean {
    return process.env.BILLING_STRIPE_ENABLED === "true";
}

export function getStripeClient(): Stripe {
    if (!isStripeBillingEnabled()) {
        throw new StripeBillingConfigurationError("El cobro con Stripe aún no está habilitado.");
    }

    const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
    if (!secretKey) {
        throw new StripeBillingConfigurationError("Falta configurar STRIPE_SECRET_KEY.");
    }

    return new Stripe(secretKey);
}

export function getStripeWebhookSecret(): string {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
    if (!webhookSecret) {
        throw new StripeBillingConfigurationError("Falta configurar STRIPE_WEBHOOK_SECRET.");
    }
    return webhookSecret;
}

export function getPlatformBaseUrl(): string {
    const value = process.env.APP_BASE_URL?.trim() || process.env.AUTH_URL?.trim();
    if (!value) {
        throw new StripeBillingConfigurationError("APP_BASE_URL es obligatorio para redirigir desde Checkout.");
    }

    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        throw new StripeBillingConfigurationError("APP_BASE_URL debe ser una URL absoluta válida.");
    }

    if (parsed.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && parsed.protocol === "http:")) {
        throw new StripeBillingConfigurationError("APP_BASE_URL debe usar HTTPS en producción.");
    }

    return parsed.origin;
}
