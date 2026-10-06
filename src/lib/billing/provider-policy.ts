export type ActiveBillingProvider = "STRIPE" | "MERCADO_PAGO";

/** Mercado Pago is the current stage; Stripe requires a deliberate future opt-in. */
export function resolveActiveBillingProvider(env: Record<string, string | undefined>): ActiveBillingProvider {
    return env.BILLING_PROVIDER?.trim().toLowerCase() === "stripe"
        && env.BILLING_STRIPE_ENABLED === "true" ? "STRIPE" : "MERCADO_PAGO";
}

export function hasActiveTrial(trial: { status: string; endsAt: Date } | null, now: Date) {
    return Boolean(trial && ["ACTIVE", "ENDING"].includes(trial.status) && trial.endsAt > now);
}
