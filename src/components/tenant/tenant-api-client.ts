export type TenantApiError = {
    code: string;
    message: string;
    requestId?: string;
    details?: Record<string, unknown>;
};

type TenantEnvelope<T> = {
    data?: T;
    meta?: { requestId?: string };
    error?: TenantApiError;
};

export async function tenantApi<T>(url: string, init?: RequestInit): Promise<T> {
    const method = (init?.method || "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (!["GET", "HEAD"].includes(method) && !headers.has("Idempotency-Key")) {
        headers.set("Idempotency-Key", crypto.randomUUID());
    }
    const response = await fetch(url, { ...init, headers, cache: "no-store" });
    const envelope = await response.json().catch(() => ({})) as TenantEnvelope<T>;
    if (!response.ok || envelope.data === undefined) {
        throw new Error(envelope.error?.message || "No fue posible completar la solicitud.");
    }
    return envelope.data;
}

export function tenantApiBase(tenantSlug: string) {
    return `/api/t/${encodeURIComponent(tenantSlug)}/v1`;
}
