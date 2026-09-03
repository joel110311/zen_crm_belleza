import type { BillingStatus, SubscriptionStatus, TenantAccessMode } from "@/generated/control-plane";

export function toSubscriptionStatus(value: string | null | undefined): SubscriptionStatus {
    switch (value) {
        case "trialing": return "TRIALING";
        case "active": return "ACTIVE";
        case "past_due": return "PAST_DUE";
        case "unpaid": return "UNPAID";
        case "canceled": return "CANCELED";
        case "incomplete_expired": return "INCOMPLETE_EXPIRED";
        case "paused": return "PAUSED";
        case "incomplete":
        default: return "INCOMPLETE";
    }
}

export function toBillingStatus(status: SubscriptionStatus): BillingStatus {
    switch (status) {
        case "TRIALING": return "TRIALING";
        case "ACTIVE": return "ACTIVE";
        case "PAST_DUE": return "PAST_DUE";
        case "UNPAID": return "UNPAID";
        case "CANCELED": return "CANCELED";
        case "INCOMPLETE":
        case "INCOMPLETE_EXPIRED":
        case "PAUSED":
        default: return "INCOMPLETE";
    }
}

/**
 * Initial beta policy: active and trialing customers can use the product; all other states can
 * still reach billing but not tenant data. Replace this with a configurable grace-period policy
 * before changing commercial terms.
 */
export function accessModeForSubscription(status: SubscriptionStatus): TenantAccessMode {
    return status === "ACTIVE" || status === "TRIALING" ? "FULL" : "BILLING_ONLY";
}
