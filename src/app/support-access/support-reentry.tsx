"use client";

import { useState } from "react";

export function SupportReentry({ tenantId, name, returnTo, mode }: { tenantId: string; name: string; returnTo: string; mode: "FULL" | "READ_ONLY" }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    async function resume() {
        setBusy(true); setError(null);
        try {
            const response = await fetch("/api/control/support", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tenantId, returnTo, mode, reason: "Continuar la revisión del negocio tras vencer o reemplazarse el acceso" }) });
            const payload = await response.json();
            if (!response.ok || !payload.destination) throw new Error(payload.error || "No se pudo reabrir la revisión.");
            window.location.assign(payload.destination);
        } catch (error) { setError(error instanceof Error ? error.message : "No fue posible conectar. Intenta nuevamente."); }
        finally { setBusy(false); }
    }
    return <div className="mt-5 space-y-3"><p className="text-sm">Reabrir {name} por 16 horas · {mode === "FULL" ? "consultar y editar" : "solo consultar"}. Esto sustituye cualquier otra revisión abierta.</p>
        <button type="button" onClick={resume} disabled={busy} className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">{busy ? "Reabriendo..." : "Volver a abrir esta revisión"}</button>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </div>;
}
