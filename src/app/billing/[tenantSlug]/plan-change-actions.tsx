"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Quote = { id: string; direction: string; amountTodayCents: number; monthlyAmountCents: number; currency: string; planName: string; effectiveAt: string; expiresAt: string; consentVersion: string };
const money = (cents: number, currency: string) => new Intl.NumberFormat("es-MX", { style: "currency", currency }).format(cents / 100);

export function PlanChangeActions({ tenantSlug, planSlug, planName, upgrade }: { tenantSlug: string; planSlug: string; planName: string; upgrade: boolean }) {
    const router = useRouter();
    const [quote, setQuote] = useState<Quote | null>(null);
    const [consent, setConsent] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    async function act(accept: boolean) {
        setBusy(true); setError(null); setMessage(null);
        try {
            if (accept && (!quote || !consent || Date.now() >= new Date(quote.expiresAt).getTime())) throw new Error("La confirmación venció. Consulta de nuevo el importe antes de aceptar.");
            const response = await fetch("/api/billing/subscription", { method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify(accept ? { tenantSlug, action: "accept_change", changeId: quote!.id, consent, consentVersion: quote!.consentVersion }
                    : { tenantSlug, action: "quote_change", planSlug }) });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || "No se confirmó el cambio de plan.");
            if (payload.url) { window.location.assign(payload.url); return; }
            if (payload.quote) { setQuote(payload.quote); setConsent(false); }
            else { setQuote(null); setMessage("Cambio confirmado para la próxima renovación. Conservas tu plan actual hasta terminar el periodo pagado."); router.refresh(); }
        } catch (error) { setError(error instanceof Error ? error.message : "No se pudo verificar el cambio."); }
        finally { setBusy(false); }
    }

    return <div className="space-y-3">
        <button type="button" disabled={busy} onClick={() => act(false)} className="w-full rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
            {busy ? "Verificando..." : upgrade ? `Mejorar al plan ${planName}` : "Cambiar al siguiente periodo"}
        </button>
        {quote ? <section aria-label="Confirmar cambio de plan" className="space-y-3 rounded-lg border bg-muted/30 p-3 text-sm">
            <p>Hoy: <strong>{money(quote.amountTodayCents, quote.currency)}</strong>{quote.direction === "UPGRADE" ? " · sólo la diferencia proporcional del periodo vigente." : " · no hay cargo por este cambio."}</p>
            <p>Desde el {new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeZone: "America/Mexico_City" }).format(new Date(quote.effectiveAt))}: <strong>{money(quote.monthlyAmountCents, quote.currency)} al mes</strong>, en la misma suscripción y fecha de renovación.</p>
            <p className="text-xs text-muted-foreground">{quote.direction === "UPGRADE" ? "La mejora se activa después de aprobar el proporcional y confirmar la renovación con Mercado Pago. No agrega otro mes." : "Conservas todas las funciones de tu plan actual hasta el corte."} Este importe es válido por 10 minutos.</p>
            <label className="flex items-start gap-2 text-xs leading-5">
                <input type="checkbox" className="mt-1 size-4 shrink-0" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} />
                <span>Acepto {quote.direction === "UPGRADE" ? `pagar ${money(quote.amountTodayCents, quote.currency)} hoy y ` : ""}cambiar la renovación automática a {money(quote.monthlyAmountCents, quote.currency)} al mes hasta que la cancele.</span>
            </label>
            <button type="button" disabled={busy || !consent} onClick={() => act(true)} className="w-full rounded-md border px-3 py-2 font-semibold disabled:opacity-50">{quote.direction === "UPGRADE" ? "Aceptar y pagar el proporcional" : "Aceptar cambio para el próximo periodo"}</button>
            <button type="button" disabled={busy} onClick={() => { setQuote(null); setConsent(false); }} className="text-xs underline">Volver sin aceptar</button>
        </section> : null}
        {message ? <p role="status" className="text-sm">{message}</p> : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </div>;
}
