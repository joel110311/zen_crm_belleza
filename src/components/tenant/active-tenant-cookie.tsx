"use client";

import { useEffect } from "react";

/** Persists the business only after the server layout has validated the membership. */
export function ActiveTenantCookie({ tenantSlug }: { tenantSlug: string }) {
    useEffect(() => {
        const controller = new AbortController();
        void fetch(`/api/t/${encodeURIComponent(tenantSlug)}/activate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
        }).catch(() => undefined);
        return () => controller.abort();
    }, [tenantSlug]);

    return null;
}
