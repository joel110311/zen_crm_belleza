import "server-only";

import { getControlDb } from "@/lib/control-db";

export const PLATFORM_BILLING_RUNTIME_KEY = "billing.runtime";

export type MercadoPagoEnvironment = "test" | "production";

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function normalizeEnvironment(value: unknown): MercadoPagoEnvironment {
    return value === "production" ? "production" : "test";
}

export function getMercadoPagoEnvironmentFallback() {
    return normalizeEnvironment(process.env.MERCADO_PAGO_ENVIRONMENT?.trim().toLowerCase());
}

export async function getMercadoPagoEnvironment(): Promise<MercadoPagoEnvironment> {
    if (process.env.MULTITENANT_RUNTIME_ENABLED !== "true") return getMercadoPagoEnvironmentFallback();

    try {
        const setting = await getControlDb().platformRuntimeSetting.findUnique({
            where: { key: PLATFORM_BILLING_RUNTIME_KEY },
            select: { value: true },
        });
        return normalizeEnvironment(record(setting?.value).mercadoPagoEnvironment || getMercadoPagoEnvironmentFallback());
    } catch (error) {
        console.warn("[Billing] Could not read the Mercado Pago environment; using the deployment fallback:", error);
        return getMercadoPagoEnvironmentFallback();
    }
}

function configured(value: string | undefined) {
    return Boolean(value?.trim());
}

export async function getMercadoPagoControlState() {
    const legacyEnvironment = getMercadoPagoEnvironmentFallback();
    const legacyAccessTokenConfigured = configured(process.env.MERCADO_PAGO_ACCESS_TOKEN);
    const legacyWebhookSecretConfigured = configured(process.env.MERCADO_PAGO_WEBHOOK_SECRET);
    return {
        environment: await getMercadoPagoEnvironment(),
        applicationIdConfigured: configured(process.env.MERCADO_PAGO_APPLICATION_ID),
        testAccessTokenConfigured: configured(process.env.MERCADO_PAGO_TEST_ACCESS_TOKEN) || (legacyEnvironment === "test" && legacyAccessTokenConfigured),
        testWebhookSecretConfigured: configured(process.env.MERCADO_PAGO_TEST_WEBHOOK_SECRET) || (legacyEnvironment === "test" && legacyWebhookSecretConfigured),
        productionAccessTokenConfigured: configured(process.env.MERCADO_PAGO_PRODUCTION_ACCESS_TOKEN) || (legacyEnvironment === "production" && legacyAccessTokenConfigured),
        productionWebhookSecretConfigured: configured(process.env.MERCADO_PAGO_PRODUCTION_WEBHOOK_SECRET) || (legacyEnvironment === "production" && legacyWebhookSecretConfigured),
    };
}
