export type LandingPlan = {
    slug: string;
    name: string;
    description: string | null;
    currency: string;
    monthlyAmountCents: number | null;
};

export type LandingOffer = { trialDays: number | null; plans: LandingPlan[] };

/** Local preview only. The public page reads the actual commercial catalog. */
export const LANDING_PREVIEW_OFFER: LandingOffer = {
    trialDays: 14,
    plans: [
        { slug: "esencial", name: "Esencial", description: "CRM, agenda, portal y operación sin chatbot.", currency: "MXN", monthlyAmountCents: 20000 },
        { slug: "automatiza", name: "Automatiza", description: "Todo lo esencial y hasta 5,000 respuestas del chatbot al mes.", currency: "MXN", monthlyAmountCents: 50000 },
        { slug: "pro", name: "Pro", description: "Chatbot sin límite visible, sujeto a uso razonable.", currency: "MXN", monthlyAmountCents: 80000 },
    ],
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
