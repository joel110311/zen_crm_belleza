import { workspaceBillingState } from "../../../scripts/lib/billing-retention-policy.mjs";

export { workspaceBillingState };
export type ExpiredWorkspaceNotice = NonNullable<ReturnType<typeof workspaceBillingState>["notice"]> & {
    tenantSlug: string;
    canManage: boolean;
};

// Deliberately select no billing identifiers, tokens, amounts or customer data for the shell.
export const workspaceBillingSelection = {
    billingStatus: true,
    trial: { select: { status: true, endsAt: true } },
    subscriptions: { select: { status: true, currentPeriodEndsAt: true, pastDueAt: true } },
} as const;
