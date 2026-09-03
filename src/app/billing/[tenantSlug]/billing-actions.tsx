"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

type BillingAction = "checkout" | "portal";

export function BillingActions({
    tenantSlug,
    planSlug,
    interval,
    canManage,
}: {
    tenantSlug: string;
    planSlug?: string;
    interval?: "monthly" | "annual";
    canManage?: boolean;
}) {
    const [pendingAction, setPendingAction] = useState<BillingAction | null>(null);
    const [error, setError] = useState<string | null>(null);

    async function start(action: BillingAction) {
        setError(null);
        setPendingAction(action);
        try {
            const response = await fetch(`/api/billing/${action}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(action === "checkout"
                    ? { tenantSlug, planSlug, interval }
                    : { tenantSlug }),
            });
            const payload = await response.json() as { error?: string; url?: string; portalAvailable?: boolean };
            if (!response.ok || !payload.url) {
                if (payload.portalAvailable) {
                    setError("Ya existe una suscripción. Usa el botón para administrarla.");
                } else {
                    setError(payload.error || "No fue posible continuar.");
                }
                return;
            }
            window.location.assign(payload.url);
        } catch {
            setError("No fue posible conectar con facturación. Inténtalo de nuevo.");
        } finally {
            setPendingAction(null);
        }
    }

    return (
        <div className="space-y-3">
            {planSlug && interval ? (
                <button type="button" onClick={() => start("checkout")} disabled={pendingAction !== null} className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60">
                    {pendingAction === "checkout" ? <><Loader2 className="mr-2 size-4 animate-spin" />Abriendo pago...</> : "Continuar a pago seguro"}
                </button>
            ) : null}
            {canManage ? (
                <button type="button" onClick={() => start("portal")} disabled={pendingAction !== null} className="inline-flex h-10 w-full items-center justify-center rounded-md border px-4 text-sm font-semibold disabled:opacity-60">
                    {pendingAction === "portal" ? <><Loader2 className="mr-2 size-4 animate-spin" />Abriendo portal...</> : "Administrar suscripción"}
                </button>
            ) : null}
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </div>
    );
}
