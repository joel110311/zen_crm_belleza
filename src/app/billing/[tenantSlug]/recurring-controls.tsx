"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RECURRING_CONSENT_VERSION } from "@/lib/billing/recurring-policy";

export function RecurringCheckout({ tenantSlug, planSlug, price, amountCents, currency, disabled }: { tenantSlug: string; planSlug: string; price: string; amountCents: number; currency: string; disabled: boolean }) {
    const [consent, setConsent] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    async function start() {
        setBusy(true); setError(null);
        try {
            const response = await fetch("/api/billing/subscription", { method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "start", tenantSlug, planSlug, consent, consentVersion: RECURRING_CONSENT_VERSION, amountCents, currency }) });
            const payload = await response.json();
            if (!response.ok || !payload.url) throw new Error(payload.error || "No se confirmó la autorización.");
            window.location.assign(payload.url);
        } catch (error) { setError(error instanceof Error ? error.message : "No se pudo conectar con facturación."); }
        finally { setBusy(false); }
    }
    return <div className="space-y-3">
        <label className="flex items-start gap-2 text-xs leading-5">
            <input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} disabled={disabled || busy} className="mt-1 size-4 shrink-0" />
            <span>Acepto una suscripción de {price} al mes, con renovación automática hasta que cancele. Puedo cancelar la renovación desde este CRM.</span>
        </label>
        <button type="button" onClick={start} disabled={!consent || busy || disabled} className="h-10 w-full rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">{busy ? "Abriendo autorización..." : "Autorizar suscripción mensual"}</button>
        {disabled ? <p className="text-xs text-muted-foreground">Administra la suscripción existente antes de contratar otro plan.</p> : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </div>;
}

export function RecurringManagement({ tenantSlug, canCancel }: { tenantSlug: string; canCancel: boolean }) {
    const router = useRouter();
    const [confirming, setConfirming] = useState(false);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    async function act(action: "sync" | "cancel") {
        setBusy(true); setError(null); setMessage(null);
        try {
            const response = await fetch("/api/billing/subscription", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tenantSlug, action, confirmCancel: action === "cancel" }) });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || "No se confirmó la operación.");
            setMessage(action === "cancel" ? "Renovación cancelada. Conservas el periodo pagado; un cobro ya iniciado podría seguir procesándose." : "Estado actualizado con Mercado Pago.");
            setConfirming(false); router.refresh();
        } catch (error) { setError(error instanceof Error ? error.message : "No se pudo conectar con facturación."); }
        finally { setBusy(false); }
    }
    return <div className="mt-4 space-y-3">
        <div className="flex flex-wrap gap-3">
            <button type="button" disabled={busy} onClick={() => act("sync")} className="rounded-md border px-4 py-2 text-sm font-semibold disabled:opacity-50">{busy ? "Verificando..." : "Actualizar estado con Mercado Pago"}</button>
            {canCancel ? <button type="button" disabled={busy} onClick={() => setConfirming(true)} className="rounded-md border px-4 py-2 text-sm font-semibold disabled:opacity-50">Cancelar renovación</button> : null}
        </div>
        {confirming ? <section role="alert" className="rounded-lg border border-amber-500/40 p-4 text-sm">
            <p>¿Cancelar los próximos cobros automáticos? No perderás el periodo ya pagado. Esto no reembolsa ni detiene un cobro que ya esté procesándose.</p>
            <div className="mt-3 flex gap-3"><button type="button" disabled={busy} onClick={() => act("cancel")} className="rounded-md bg-primary px-4 py-2 font-semibold text-primary-foreground">Sí, cancelar renovación</button><button type="button" disabled={busy} onClick={() => setConfirming(false)} className="rounded-md border px-4 py-2">Volver</button></div>
        </section> : null}
        {message ? <p role="status" className="text-sm">{message}</p> : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </div>;
}
