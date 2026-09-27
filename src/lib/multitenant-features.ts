import "server-only";

export function isMultitenantRuntimeEnabled(): boolean {
    return process.env.MULTITENANT_RUNTIME_ENABLED === "true";
}

export function isMultitenantAuthEnabled(): boolean {
    return process.env.MULTITENANT_AUTH_ENABLED === "true";
}

/** Keep the public site key runtime-configurable for prebuilt Docker images. */
export function getTurnstileSiteKey(): string {
    return process.env.TURNSTILE_SITE_KEY?.trim()
        || process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim()
        || "";
}

export function isPublicTenantSignupEnabled(): boolean {
    const hasPublicUrl = Boolean(process.env.APP_BASE_URL?.trim() || process.env.AUTH_URL?.trim() || process.env.NEXTAUTH_URL?.trim());
    return isMultitenantAuthEnabled()
        && process.env.MULTITENANT_PUBLIC_SIGNUP_ENABLED === "true"
        && Boolean(process.env.TURNSTILE_SECRET_KEY?.trim())
        && Boolean(getTurnstileSiteKey())
        && Boolean(process.env.RESEND_API_KEY?.trim())
        && Boolean(process.env.EMAIL_FROM?.trim())
        && Boolean(process.env.SECURITY_HASH_SALT?.trim() || process.env.AUTH_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim())
        && hasPublicUrl;
}

/** Team invitations are separately gated so a partially configured mail provider never opens access. */
export function isMultitenantInvitationsEnabled(): boolean {
    return isMultitenantRuntimeEnabled()
        && isMultitenantAuthEnabled()
        && process.env.MULTITENANT_INVITATIONS_ENABLED === "true"
        && Boolean(process.env.RESEND_API_KEY?.trim())
        && Boolean(process.env.EMAIL_FROM?.trim())
        && Boolean(process.env.SECURITY_HASH_SALT?.trim() || process.env.AUTH_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim())
        && Boolean(process.env.APP_BASE_URL?.trim() || process.env.AUTH_URL?.trim() || process.env.NEXTAUTH_URL?.trim());
}

/** The new public portal has no legacy database fallback once this flag is enabled. */
export function isMultitenantPublicPortalEnabled(): boolean {
    return isMultitenantRuntimeEnabled()
        && process.env.MULTITENANT_PUBLIC_PORTAL_ENABLED === "true"
        && Boolean(process.env.SECURITY_HASH_SALT?.trim() || process.env.AUTH_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim());
}

/** Provider credentials and webhook routing remain closed until both the control plane and an HMAC salt exist. */
export function isMultitenantChannelsEnabled(): boolean {
    return isMultitenantRuntimeEnabled()
        && isMultitenantAuthEnabled()
        && process.env.MULTITENANT_CHANNELS_ENABLED === "true"
        && Boolean(process.env.SECURITY_HASH_SALT?.trim() || process.env.AUTH_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim())
        && Boolean(process.env.TENANT_CREDENTIALS_ENCRYPTION_KEY?.trim());
}

/** Private storage cannot open accidentally just because an endpoint or a bucket exists. */
export function isMultitenantPrivateStorageEnabled(): boolean {
    return isMultitenantRuntimeEnabled()
        && process.env.MULTITENANT_PRIVATE_STORAGE_ENABLED === "true"
        && Boolean(process.env.TENANT_STORAGE_S3_ENDPOINT?.trim())
        && Boolean(process.env.TENANT_STORAGE_S3_BUCKET?.trim())
        && Boolean(process.env.TENANT_STORAGE_S3_ACCESS_KEY_ID?.trim())
        && Boolean(process.env.TENANT_STORAGE_S3_SECRET_ACCESS_KEY?.trim())
        && Boolean(process.env.SECURITY_HASH_SALT?.trim() || process.env.AUTH_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim());
}
