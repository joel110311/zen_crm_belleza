"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function BillingStatusRefresh({ enabled }: { enabled: boolean }) {
    const router = useRouter();
    useEffect(() => {
        if (!enabled) return;
        let refreshes = 0;
        const timer = window.setInterval(() => {
            refreshes += 1;
            router.refresh();
            if (refreshes >= 10) window.clearInterval(timer);
        }, 3_000);
        return () => window.clearInterval(timer);
    }, [enabled, router]);
    return null;
}
