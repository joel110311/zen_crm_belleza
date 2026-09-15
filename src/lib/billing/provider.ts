import "server-only";

export type ActiveBillingProvider = "STRIPE" | "MERCADO_PAGO";

export function getActiveBillingProvider(): ActiveBillingProvider {
    const configured = process.env.BILLING_PROVIDER?.trim().toLowerCase();
    return configured === "mercado_pago" || configured === "mercadopago"
        ? "MERCADO_PAGO"
        : "STRIPE";
}

