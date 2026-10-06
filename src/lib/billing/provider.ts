import "server-only";

import { resolveActiveBillingProvider, type ActiveBillingProvider } from "./provider-policy";
export type { ActiveBillingProvider } from "./provider-policy";

export function getActiveBillingProvider(): ActiveBillingProvider {
    return resolveActiveBillingProvider(process.env);
}

