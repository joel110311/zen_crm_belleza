/** Keep historical slugs stable: subscriptions and payment references already use them. */
export const STANDARD_PLANS = [
    { slug: "esencial", name: "Esencial", monthlyAmountCents: 29900, chatbotMessagesPerMonth: 1000, recommendation: "Recomendado para negocios con 1 o 2 lugares" },
    { slug: "automatiza", name: "Crecimiento", monthlyAmountCents: 49900, chatbotMessagesPerMonth: 3000, recommendation: "Recomendado para negocios con 3 a 5 lugares" },
    { slug: "pro", name: "Elite", monthlyAmountCents: 79900, chatbotMessagesPerMonth: 10000, recommendation: "Recomendado para 6 o más sillas o multisucursal" },
] as const;

export function planRecommendation(slug: string) {
    return STANDARD_PLANS.find((plan) => plan.slug === slug)?.recommendation ?? null;
}

export function planChatbotLimit(limits: unknown): number | null {
    if (!limits || typeof limits !== "object" || Array.isArray(limits)) return null;
    const limit = (limits as Record<string, unknown>).chatbotMessagesPerMonth;
    return typeof limit === "number" && Number.isInteger(limit) && limit >= 0 ? limit : null;
}

export function planFeatures(plan: { limits?: unknown; features?: unknown }) {
    const chatbot = !!plan.features && typeof plan.features === "object"
        && !Array.isArray(plan.features) && (plan.features as Record<string, unknown>).chatbot === true;
    const limit = planChatbotLimit(plan.limits);
    return [
        "Agenda en línea y gestión de citas",
        "Página de reservas personalizada",
        "Registro e historial de clientes",
        "Catálogo de servicios y profesionales",
        "Bandeja de conversaciones de WhatsApp",
        ...(chatbot ? [limit === null ? "Chatbot con IA sin límite de respuestas" : `Chatbot con IA: ${limit.toLocaleString("es-MX")} respuestas al mes`] : []),
    ];
}
