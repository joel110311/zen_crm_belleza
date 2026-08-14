"use client";

import { useEffect } from "react";
import {
    applyUnreadBrowserBadge,
    readUnreadCounts,
} from "@/lib/inbox-browser-badge";

export function UnreadTabBadge() {
    useEffect(() => {
        const syncBadge = () => {
            applyUnreadBrowserBadge(readUnreadCounts());
        };

        syncBadge();

        window.addEventListener("storage", syncBadge);
        document.addEventListener("visibilitychange", syncBadge);

        return () => {
            window.removeEventListener("storage", syncBadge);
            document.removeEventListener("visibilitychange", syncBadge);
        };
    }, []);

    return null;
}
