export type MercadoPagoEnvironment = "test" | "production";

/** Checkout Pro's automatically created test seller can belong to a different application. */
export function resolveMercadoPagoApplicationId(env: Record<string, string | undefined>, environment: MercadoPagoEnvironment) {
    const key = environment === "production" ? "MERCADO_PAGO_PRODUCTION_APPLICATION_ID" : "MERCADO_PAGO_TEST_APPLICATION_ID";
    return env[key]?.trim() || env.MERCADO_PAGO_APPLICATION_ID?.trim() || "";
}

export function resolveMercadoPagoCredentials(
    env: Record<string, string | undefined>,
    environment: MercadoPagoEnvironment,
    legacyEnvironment: MercadoPagoEnvironment,
) {
    const prefix = environment === "production" ? "MERCADO_PAGO_PRODUCTION" : "MERCADO_PAGO_TEST";
    return {
        accessToken: env[`${prefix}_ACCESS_TOKEN`]?.trim()
            || (environment === legacyEnvironment ? env.MERCADO_PAGO_ACCESS_TOKEN?.trim() : "")
            || "",
        // Eventtia uses one app-level webhook secret; explicit environment secrets take precedence.
        webhookSecret: env[`${prefix}_WEBHOOK_SECRET`]?.trim()
            || env.MERCADO_PAGO_WEBHOOK_SECRET?.trim()
            || "",
    };
}

export async function resolveMercadoPagoWebhookPayment<
    TPayment extends { id: string | number; live_mode?: boolean },
    TRuntime extends { environment: MercadoPagoEnvironment },
>(paymentId: string, runtimes: TRuntime[], fetchPayment: (runtime: TRuntime) => Promise<TPayment>) {
    for (const runtime of runtimes) {
        let payment: TPayment;
        try {
            payment = await fetchPayment(runtime);
        } catch (error) {
            const status = error && typeof error === "object" && "status" in error ? error.status : null;
            // A shared signature can match both environments. The other token may own the payment.
            if (status === 401 || status === 403 || status === 404) continue;
            throw error;
        }
        if (String(payment.id) === paymentId && payment.live_mode === (runtime.environment === "production")) {
            return { payment, runtime };
        }
    }
    throw new Error("No fue posible verificar el pago con las credenciales del entorno correspondiente.");
}
