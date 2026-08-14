export function getSafeMediaUrl(url: string | null | undefined): string | undefined {
    if (!url) return undefined;

    let cleanUrl = url.trim();

    if (typeof window !== "undefined") {
        const origin = window.location.origin;
        if (cleanUrl.startsWith(origin)) {
            cleanUrl = cleanUrl.replace(origin, "");
        }
    }

    if (cleanUrl.includes("localhost:3000")) {
        cleanUrl = cleanUrl.replace(/https?:\/\/localhost:3000/, "");
    }

    if (cleanUrl.includes("/uploads/") && cleanUrl.startsWith("http")) {
        cleanUrl = cleanUrl.substring(cleanUrl.indexOf("/uploads/"));
    }

    if (cleanUrl.startsWith("/uploads/")) {
        const filename = cleanUrl.substring("/uploads/".length);
        return `/api/media/${filename}`;
    }

    return cleanUrl;
}

function getLocalMediaFilename(url: string) {
    try {
        const parsed = new URL(url, "https://crm.local");
        const pathname = parsed.pathname;
        const prefix = pathname.startsWith("/uploads/")
            ? "/uploads/"
            : pathname.startsWith("/api/media/")
                ? "/api/media/"
                : null;

        if (!prefix) return null;

        const fileName = pathname.slice(prefix.length);
        return fileName ? decodeURIComponent(fileName) : null;
    } catch {
        return null;
    }
}

export function getPublicMediaUrl(url: string, appBaseUrl?: string | null): string {
    const cleanUrl = url.trim();
    const configuredBaseUrl = (appBaseUrl || "").trim().replace(/\/+$/, "");
    const isAbsoluteUrl = /^https?:\/\//i.test(cleanUrl);
    const parsed = (() => {
        try {
            return new URL(cleanUrl, configuredBaseUrl || "https://crm.local");
        } catch {
            return null;
        }
    })();

    const inferredBaseUrl = isAbsoluteUrl && parsed
        ? `${parsed.protocol}//${parsed.host}`
        : "";
    const baseUrl = configuredBaseUrl || inferredBaseUrl;
    const localFileName = getLocalMediaFilename(cleanUrl);

    if (localFileName && baseUrl) {
        return `${baseUrl}/api/media/${encodeURIComponent(localFileName)}`;
    }

    if (isAbsoluteUrl) {
        return cleanUrl;
    }

    if (!baseUrl) {
        throw new Error("APP_BASE_URL o AUTH_URL es requerido para publicar archivos multimedia.");
    }

    return `${baseUrl}${cleanUrl.startsWith("/") ? "" : "/"}${cleanUrl}`;
}
