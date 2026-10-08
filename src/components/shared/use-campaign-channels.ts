"use client";
import { useEffect, useState } from "react";
import type { CampaignChannel } from "@/lib/campaign-channel-availability";

export function useCampaignChannels(enabled = true) {
    const [channels, setChannels] = useState<CampaignChannel[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState("");
    useEffect(() => {
        if (!enabled) return;
        let disposed = false;
        let revision = 0;
        const controller = new AbortController();
        async function refresh() {
            const current = ++revision;
            try {
                const response = await fetch("/api/bulk-campaigns/channels", { cache: "no-store", signal: controller.signal });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || "No se pudieron verificar los canales.");
                if (disposed || current !== revision) return;
                setChannels(Array.isArray(result.channels) ? result.channels : []);
                setError("");
            } catch (failure) {
                if (disposed || current !== revision) return;
                setChannels([]);
                setError(failure instanceof Error ? failure.message : "No se pudieron verificar los canales.");
            } finally {
                if (!disposed && current === revision) setIsLoading(false);
            }
        }
        setIsLoading(true);
        void refresh();
        const interval = setInterval(() => { if (!document.hidden) void refresh(); }, 20_000);
        const onFocus = () => { void refresh(); };
        window.addEventListener("focus", onFocus);
        return () => { disposed = true; controller.abort(); clearInterval(interval); window.removeEventListener("focus", onFocus); };
    }, [enabled]);
    return { channels, isLoading, error };
}
