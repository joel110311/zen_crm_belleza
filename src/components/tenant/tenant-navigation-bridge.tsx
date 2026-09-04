"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { tenantDashboardPath } from "@/lib/tenant-request-routing";

/**
 * Established CRM components still emit /dashboard links. Capture ordinary same-window clicks
 * so the App Router keeps the transition inside the validated business without a redirect hop.
 */
export function TenantNavigationBridge({ tenantSlug }: { tenantSlug: string }) {
    const router = useRouter();

    useEffect(() => {
        const onClick = (event: MouseEvent) => {
            if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            const target = event.target;
            if (!(target instanceof Element)) return;
            const anchor = target.closest("a[href]");
            if (!(anchor instanceof HTMLAnchorElement) || anchor.target || anchor.hasAttribute("download")) return;

            const url = new URL(anchor.href, window.location.href);
            if (url.origin !== window.location.origin || (url.pathname !== "/dashboard" && !url.pathname.startsWith("/dashboard/"))) return;

            event.preventDefault();
            router.push(`${tenantDashboardPath(tenantSlug, url.pathname)}${url.search}${url.hash}`);
        };

        document.addEventListener("click", onClick, true);
        return () => document.removeEventListener("click", onClick, true);
    }, [router, tenantSlug]);

    return null;
}
