function normalizeHostname(value: string | null | undefined) {
    const candidate = String(value || "").split(",")[0]?.trim().toLowerCase() || "";
    if (!candidate) return "";
    try {
        return new URL(`http://${candidate}`).hostname.toLowerCase();
    } catch {
        return "";
    }
}

function configuredHostnames(value: string | null | undefined) {
    return String(value || "")
        .split(",")
        .map((entry) => normalizeHostname(entry))
        .filter(Boolean);
}

export function legacyApplicationHosts() {
    return new Set(configuredHostnames(
        process.env.LEGACY_APP_HOSTS || "crm-belleza.synapselogik.com",
    ));
}

export function requestHostname(headers: Headers) {
    return normalizeHostname(headers.get("x-forwarded-host") || headers.get("host"));
}

export function isLegacyApplicationRequest(headers: Headers) {
    return legacyApplicationHosts().has(requestHostname(headers));
}

function configuredApplicationOrigins() {
    const origins = new Set<string>();
    for (const value of [process.env.APP_BASE_URL, process.env.AUTH_URL, process.env.NEXTAUTH_URL]) {
        if (!value) continue;
        try {
            origins.add(new URL(value).origin);
        } catch {
            // Deployment validation reports malformed public URLs separately.
        }
    }
    for (const hostname of legacyApplicationHosts()) origins.add(`https://${hostname}`);
    return origins;
}

export function trustedRequestOrigin(headers: Headers) {
    const hostname = requestHostname(headers);
    const forwardedProto = String(headers.get("x-forwarded-proto") || "https").split(",")[0]?.trim().toLowerCase();
    const protocol = forwardedProto === "http" ? "http" : "https";
    const candidate = hostname ? `${protocol}://${hostname}` : "";
    const allowed = configuredApplicationOrigins();
    if (candidate && allowed.has(candidate)) return candidate;
    return [...allowed][0] || "http://localhost:3000";
}

export function isTrustedApplicationRedirect(value: string) {
    try {
        return configuredApplicationOrigins().has(new URL(value).origin);
    } catch {
        return false;
    }
}
