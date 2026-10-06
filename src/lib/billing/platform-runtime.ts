import "server-only";

import { getControlDb } from "@/lib/control-db";
import { resolveMercadoPagoCredentials, type MercadoPagoEnvironment } from "@/lib/billing/mercado-pago-runtime-helpers";

export const PLATFORM_BILLING_RUNTIME_KEY = "billing.runtime";

export type { MercadoPagoEnvironment } from "@/lib/billing/mercado-pago-runtime-helpers";

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
    const testCredentials = resolveMercadoPagoCredentials(process.env, "test", legacyEnvironment);
    const productionCredentials = resolveMercadoPagoCredentials(process.env, "production", legacyEnvironment);
    return {
        environment: await getMercadoPagoEnvironment(),
        applicationIdConfigured: configured(process.env.MERCADO_PAGO_APPLICATION_ID),
        testAccessTokenConfigured: configured(testCredentials.accessToken),
        testWebhookSecretConfigured: configured(testCredentials.webhookSecret),
        productionAccessTokenConfigured: configured(productionCredentials.accessToken),
        productionWebhookSecretConfigured: configured(productionCredentials.webhookSecret),
    };
}
