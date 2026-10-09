export const RECURRING_CONSENT_VERSION = "monthly-auto-renewal-v1";

export class RecurringBillingError extends Error {
    readonly status: number;
    constructor(message: string, status = 409) { super(message); this.status = status; }
}

export function providerDate(value: unknown): Date | null {
    if (typeof value !== "string" || !value) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
}

export function providerAmountCents(value: unknown): number | null {
    if ((typeof value !== "number" && typeof value !== "string") || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.round(number * 100) : null;
}

export function hostedSubscriptionUrl(value: unknown, id: string): string | null {
    if (typeof value !== "string") return null;
    try {
        const url = new URL(value);
        return url.protocol === "https:" && url.hostname === "www.mercadopago.com.mx"
            && url.pathname === "/subscriptions/checkout" && url.searchParams.get("preapproval_id") === id
            && !url.username && !url.password ? url.href : null;
    } catch { return null; }
}

export function agreementIdentityError(agreement: { providerSubscriptionId: string | null; externalReference: string; applicationId: string }, resource: { id: string; external_reference?: string | number; application_id?: string | number }) {
    if (!resource.id || (agreement.providerSubscriptionId && agreement.providerSubscriptionId !== resource.id)) return "La suscripción no coincide.";
    if (String(resource.external_reference) !== agreement.externalReference) return "La referencia no coincide.";
    if (String(resource.application_id) !== agreement.applicationId) return "La aplicación no coincide.";
    return null;
}

export function agreementValidationError(agreement: {
    providerSubscriptionId: string | null; externalReference: string; applicationId: string; amountCents: number; currency: string; startsAt?: Date;
}, resource: {
    id: string; external_reference?: string | number; application_id?: string | number;
    auto_recurring?: { frequency?: number; frequency_type?: string; transaction_amount?: number | string; currency_id?: string; start_date?: string };
}) {
    const identity = agreementIdentityError(agreement, resource);
    if (identity) return identity;
    if (resource.auto_recurring?.frequency !== 1 || resource.auto_recurring.frequency_type !== "months") return "La periodicidad no coincide.";
    if (resource.auto_recurring.currency_id !== agreement.currency || providerAmountCents(resource.auto_recurring.transaction_amount) !== agreement.amountCents) return "El precio autorizado no coincide.";
    const start = providerDate(resource.auto_recurring.start_date);
    if (agreement.startsAt && (!start || Math.abs(start.getTime() - agreement.startsAt.getTime()) > 1000)) return "La fecha de inicio autorizada no coincide.";
    return null;
}
