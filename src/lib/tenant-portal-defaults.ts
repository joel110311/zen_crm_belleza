const SEEDED_NAMES = new Set(["zen crm cuidado personal", "zen crm belleza", "zen crm oftalmo"]);

function isSeededName(value: string) {
    return !value.trim() || SEEDED_NAMES.has(value.trim().toLowerCase());
}

export function resolveTenantPortalName(portalName: string | null | undefined, businessName: string | null | undefined, tenantName: string, configured = false) {
    const portal = portalName?.trim() || "";
    if (portal && (configured || !isSeededName(portal))) return portal;
    const business = businessName?.trim() || "";
    return (!isSeededName(business) ? business : tenantName.trim()) || "Tu negocio";
}

/** Keep a customized portal title; otherwise follow the business name saved in step one. */
export function portalNameAfterBusinessChange(portalName: string | null | undefined, previousBusinessName: string | null | undefined, nextBusinessName: string, customized = false) {
    const portal = portalName?.trim() || "";
    if (customized && portal) return portal;
    return isSeededName(portal) || portal === previousBusinessName?.trim()
        ? nextBusinessName.trim() : portal;
}

/** Older clients omit the toggle: they must not accidentally reactivate a disabled portal. */
export function portalEnabledFromInput(enabled: boolean | undefined, previousEnabled = true) {
    return enabled ?? previousEnabled;
}
