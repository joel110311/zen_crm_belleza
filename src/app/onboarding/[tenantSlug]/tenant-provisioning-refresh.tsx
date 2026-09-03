"use client";

import { useEffect } from "react";

export function TenantProvisioningRefresh() {
    useEffect(() => {
        const timer = window.setTimeout(() => window.location.reload(), 4_000);
        return () => window.clearTimeout(timer);
    }, []);

    return <p className="mt-4 text-sm text-muted-foreground">Esta página se actualizará automáticamente.</p>;
}
