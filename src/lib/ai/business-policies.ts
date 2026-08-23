export const BUSINESS_POLICIES_VERSION = 1 as const;
export const BUSINESS_POLICY_MAX_LENGTH = 2000;

export type BusinessPolicies = {
    version: typeof BUSINESS_POLICIES_VERSION;
    cancellationAndRescheduling: string;
    depositsAndPayments: string;
    preparationInstructions: string;
    customQuotes: string;
    humanEscalation: string;
};

export type BusinessPolicyField = Exclude<keyof BusinessPolicies, "version">;

export const EMPTY_BUSINESS_POLICIES: BusinessPolicies = {
    version: BUSINESS_POLICIES_VERSION,
    cancellationAndRescheduling: "",
    depositsAndPayments: "",
    preparationInstructions: "",
    customQuotes: "",
    humanEscalation: "",
};

function normalizePolicyText(value: unknown) {
    if (typeof value !== "string") return "";
    return value.replace(/\r\n/g, "\n").trim().slice(0, BUSINESS_POLICY_MAX_LENGTH);
}

export function normalizeBusinessPolicies(value?: unknown): BusinessPolicies {
    const source = value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};

    return {
        version: BUSINESS_POLICIES_VERSION,
        cancellationAndRescheduling: normalizePolicyText(source.cancellationAndRescheduling),
        depositsAndPayments: normalizePolicyText(source.depositsAndPayments),
        preparationInstructions: normalizePolicyText(source.preparationInstructions),
        customQuotes: normalizePolicyText(source.customQuotes),
        humanEscalation: normalizePolicyText(source.humanEscalation),
    };
}

export function hasConfiguredBusinessPolicies(policies: BusinessPolicies) {
    return Object.entries(policies).some(([key, value]) => key !== "version" && Boolean(value));
}
