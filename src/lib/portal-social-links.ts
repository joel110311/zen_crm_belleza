export const SOCIAL_NETWORKS = [
    { id: "instagram", label: "Instagram", placeholder: "https://www.instagram.com/tu-negocio" },
    { id: "tiktok", label: "TikTok", placeholder: "https://www.tiktok.com/@tu-negocio" },
    { id: "facebook", label: "Página de Facebook", placeholder: "https://www.facebook.com/tu-negocio" },
    { id: "youtube", label: "YouTube", placeholder: "https://www.youtube.com/@tu-negocio" },
    { id: "linkedin", label: "LinkedIn", placeholder: "https://www.linkedin.com/company/tu-negocio" },
    { id: "x", label: "X", placeholder: "https://x.com/tu-negocio" },
    { id: "website", label: "Sitio web", placeholder: "https://tu-negocio.com" },
    { id: "other", label: "Otro enlace", placeholder: "https://..." },
] as const;

export type PortalSocialLink = { network: typeof SOCIAL_NETWORKS[number]["id"]; url: string; enabled: boolean };

function safeUrl(value: string): string {
    if (!value.trim()) return "";
    const url = new URL(value.trim());
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || !url.hostname.includes(".")) {
        throw new Error("Usa un enlace completo que comience con https:// o http://, sin credenciales.");
    }
    return url.href;
}

/** Strict on writes; tolerant of old/malformed persisted values on reads. */
export function normalizePortalSocialLinks(value: unknown, strict = false): PortalSocialLink[] {
    if (strict && (!Array.isArray(value) || value.length > SOCIAL_NETWORKS.length)) {
        throw new Error("La lista de redes sociales no es válida.");
    }
    const rows = Array.isArray(value) ? value : [];
    const seen = new Set<string>();
    const result: PortalSocialLink[] = [];
    for (const row of rows) {
        try {
            if (!row || typeof row !== "object" || !("network" in row) || !("url" in row) || !("enabled" in row)) throw new Error("Red social no válida.");
            const network = SOCIAL_NETWORKS.find((item) => item.id === row.network);
            if (!network || seen.has(network.id) || typeof row.url !== "string" || row.url.length > 2048 || typeof row.enabled !== "boolean") throw new Error("Red social no válida o duplicada.");
            const url = safeUrl(row.url);
            if (row.enabled && !url) throw new Error(`Completa el enlace de ${network.label} antes de mostrarlo.`);
            seen.add(network.id);
            result.push({ network: network.id, url, enabled: row.enabled });
        } catch (error) {
            if (strict) throw error;
        }
    }
    return result;
}

export function publicPortalSocialLinks(value: unknown) {
    return normalizePortalSocialLinks(value).filter((link) => link.enabled && link.url);
}
