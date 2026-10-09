/** This identity is reserved for platform control, never for a workspace membership. */
export const ENVIRONMENT_ADMIN_ID = "platform-env-admin";

/** One workday per explicitly opened workspace; revocation is checked on every request. */
export const PLATFORM_SUPPORT_DURATION_SECONDS = 16 * 60 * 60;

/** A support re-entry may return only to a route inside the explicitly selected workspace. */
export function supportWorkspaceReturnPath(slug: string, value: unknown): string | null {
    if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return null;
    try {
        const url = new URL(value, "https://support.invalid");
        const prefix = `/t/${encodeURIComponent(slug)}`;
        const onboarding = `/onboarding/${encodeURIComponent(slug)}`;
        if (url.origin !== "https://support.invalid" || !(url.pathname === prefix || url.pathname.startsWith(`${prefix}/`) || url.pathname === onboarding)) return null;
        url.searchParams.delete("_rsc");
        return `${url.pathname}${url.search}${url.hash}`;
    } catch { return null; }
}
