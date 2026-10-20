export const AI_PRIMARY = "primary";
export const AI_FALLBACK = "fallback";
export const MAX_AI_PROVIDERS = 8;

export type PlatformAiProvider = {
    id: string;
    name: string;
    baseUrl: string;
    model: string;
    enabled: boolean;
};
export type PlatformAiRouter = {
    enabled: boolean;
    timeoutMs: number;
    primaryEnabled: boolean;
    fallbackEnabled: boolean;
    order: string[];
    providers: PlatformAiProvider[];
};
export type PlatformAiProviderView = PlatformAiProvider & { apiKeyConfigured: boolean };
export type PlatformAiRouterView = Omit<PlatformAiRouter, "providers"> & { providers: PlatformAiProviderView[] };

export function aiRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function normalizePlatformRouter(value: unknown): PlatformAiRouter {
    const row = aiRecord(value);
    const seen = new Set<string>();
    const providers: PlatformAiProvider[] = (Array.isArray(row.providers) ? row.providers : []).slice(0, MAX_AI_PROVIDERS).flatMap(value => {
        const p = aiRecord(value), id = typeof p.id === "string" ? p.id : "";
        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || [AI_PRIMARY, AI_FALLBACK].includes(id) || seen.has(id)) return [];
        seen.add(id);
        return [{ id, name: String(p.name || "").slice(0, 80), baseUrl: String(p.baseUrl || "").slice(0, 500), model: String(p.model || "").slice(0, 150), enabled: p.enabled === true }];
    });
    const valid = new Set([...providers.map(p => p.id), AI_PRIMARY, AI_FALLBACK]);
    const order = [...new Set((Array.isArray(row.order) ? row.order : []).filter((id): id is string => typeof id === "string" && valid.has(id)))];
    for (const id of valid) if (!order.includes(id)) order.push(id);
    return { enabled: row.enabled === true, timeoutMs: Math.max(1500, Math.min(10000, Number(row.timeoutMs) || 4000)), primaryEnabled: row.primaryEnabled !== false, fallbackEnabled: row.fallbackEnabled === true, order, providers };
}

/** Accept a base URL or the full chat endpoint. Preserve Google's /openai path. */
export function compatibleChatEndpoint(value: string) {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || (url.port && url.port !== "443")
        || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || !host.includes(".")
        || /^[\d.]+$/.test(host) || host.includes(":")) throw new Error("Usa una URL HTTPS pública, sin credenciales ni parámetros.");
    url.pathname = url.pathname.replace(/\/+$/, "");
    if (!url.pathname.endsWith("/chat/completions")) url.pathname = `${url.pathname || "/v1"}/chat/completions`;
    return url.toString();
}
