"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { ChatbotUsage } from "@/lib/billing/chatbot-usage";

export function ChatbotUsageCounter() {
    const pathname = usePathname();
    const tenantSlug = pathname.match(/^\/t\/([^/]+)(?:\/|$)/)?.[1];
    const [result, setResult] = useState<{ tenantSlug: string; usage: ChatbotUsage | null; failed?: boolean } | null>(null);

    useEffect(() => {
        if (!tenantSlug) return;
        const controller = new AbortController();
        let loading = false;
        async function refresh() {
            if (document.hidden || loading || controller.signal.aborted) return;
            loading = true;
            try {
                const response = await fetch(`/api/t/${tenantSlug}/v1/chatbot-usage`, { cache: "no-store", signal: controller.signal });
                if (!response.ok) throw new Error("Usage unavailable");
                const { data } = await response.json();
                if (!controller.signal.aborted) setResult({ tenantSlug: tenantSlug!, usage: data });
            } catch {
                if (!controller.signal.aborted) setResult({ tenantSlug: tenantSlug!, usage: null, failed: true });
            } finally { loading = false; }
        }
        void refresh();
        const timer = window.setInterval(refresh, 60_000);
        window.addEventListener("focus", refresh);
        document.addEventListener("visibilitychange", refresh);
        return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
    }, [tenantSlug]);

    if (!tenantSlug) return null;
    if (!result || result.tenantSlug !== tenantSlug) return <p className="text-xs text-muted-foreground">Consultando consumo del chatbot…</p>;
    if (result.failed) return <p className="text-xs text-muted-foreground">Consumo no disponible temporalmente.</p>;
    if (!result.usage) return <p className="text-xs text-muted-foreground">Sin cupo activo de respuestas del chatbot.</p>;
    const { used, limit, periodEnd, isTrial } = result.usage;
    const exhausted = limit !== null && used >= limit;
    return <div className="space-y-1 text-xs text-muted-foreground" aria-live="polite">
        <p className="tabular-nums">{used.toLocaleString("es-MX")} / {limit === null ? "sin límite" : limit.toLocaleString("es-MX")} respuestas <span aria-hidden="true">·</span> {isTrial ? "Prueba hasta el" : "Se renueva el"} {new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone: "America/Mexico_City" }).format(new Date(periodEnd))}</p>
        {exhausted ? <p className="text-amber-700 dark:text-amber-400">Cupo agotado. Puedes seguir respondiendo manualmente.</p> : null}
    </div>;
}
