export const ACTIVE_TENANT_COOKIE = "synapselogik-active-business";
export const TENANT_SLUG_HEADER = "x-synapselogik-business";
export const TENANT_USER_HEADER = "x-synapselogik-user";
export const TENANT_SCOPE_HEADER = "x-synapselogik-scope";

const TENANT_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])?$/;

export function normalizeRequestTenantSlug(value: string | null | undefined): string | null {
    if (!value) return null;
    const normalized = value.trim().toLowerCase();
    return TENANT_SLUG_PATTERN.test(normalized) ? normalized : null;
}

export function tenantSlugFromPath(pathname: string): string | null {
    const match = pathname.match(/^\/t\/([^/]+)(?:\/|$)/);
    if (!match) return null;

    try {
        return normalizeRequestTenantSlug(decodeURIComponent(match[1]));
    } catch {
        return null;
    }
}

export function tenantDashboardPath(slug: string, legacyPathname: string): string {
    const suffix = legacyPathname === "/dashboard"
        ? "/dashboard"
        : legacyPathname.slice("/dashboard".length) || "/dashboard";
    return `/t/${encodeURIComponent(slug)}${suffix}`;
}
