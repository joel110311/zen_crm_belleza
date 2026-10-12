import { STANDARD_PLANS } from "./plan-catalog.ts";

export type LandingPlan = {
    slug: string;
    name: string;
    description: string | null;
    currency: string;
    monthlyAmountCents: number | null;
    limits?: unknown;
    features?: unknown;
};

export type LandingOffer = { trialDays: number | null; plans: LandingPlan[]; automaticRenewal?: boolean };

/** Local preview only. The public page reads the actual commercial catalog. */
export const LANDING_PREVIEW_OFFER: LandingOffer = {
    trialDays: 14,
    automaticRenewal: true,
    plans: STANDARD_PLANS.map((plan) => ({
        slug: plan.slug, name: plan.name, currency: "MXN", monthlyAmountCents: plan.monthlyAmountCents,
        description: `CRM y chatbot con hasta ${plan.chatbotMessagesPerMonth.toLocaleString("es-MX")} respuestas al mes.`,
        limits: { chatbotMessagesPerMonth: plan.chatbotMessagesPerMonth }, features: { chatbot: true },
    })),
};

export function landingTrialLabel(days: number | null) {
    return days && days > 0 ? `Probar gratis ${days} días` : "Crear mi cuenta";
}

export function landingStartingPrice(plans: LandingPlan[]) {
    const amounts = plans.filter((plan) => plan.currency === "MXN" && plan.monthlyAmountCents !== null && plan.monthlyAmountCents > 0)
        .map((plan) => plan.monthlyAmountCents!);
    return amounts.length ? Math.min(...amounts) : null;
}

export function landingMoney(amountCents: number, currency = "MXN") {
    return new Intl.NumberFormat("es-MX", { style: "currency", currency, maximumFractionDigits: amountCents % 100 ? 2 : 0 }).format(amountCents / 100);
}
