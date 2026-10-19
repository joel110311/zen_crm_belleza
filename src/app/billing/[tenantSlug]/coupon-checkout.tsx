"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { ChevronDown, TicketPercent } from "lucide-react";
import styles from "./billing.module.css";

type Plan = {
  slug: string;
  name: string;
  monthlyAmountCents: number | null;
  currency: string;
};
type Quote = {
  code: string;
  discountPercent: number;
  originalCents: number;
  amountCents: number;
  currency: string;
  resume: boolean;
};
const money = (amount: number, currency: string) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency }).format(
    amount / 100,
  );

export function CouponCheckout({
  tenantSlug,
  plan,
  disabled,
  unavailableReason,
}: {
  tenantSlug: string;
  plan: Plan;
  disabled: boolean;
  unavailableReason?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);

  function reset() {
    setQuote(null);
    setConsent(false);
    setError("");
  }

  async function act(action: "preview" | "redeem", event?: FormEvent) {
    event?.preventDefault();
    if (
      lock.current ||
      disabled ||
      (action === "redeem" && (!quote || !consent))
    )
      return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/billing/coupon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantSlug,
          action,
          code: quote?.code || code,
          planSlug: plan.slug,
          amountCents: quote?.amountCents,
          consent,
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "No fue posible aplicar el cupón.");
      if (action === "preview") {
        setQuote(data.quote);
        setConsent(false);
      } else if (data.url) window.location.assign(data.url);
      else
        throw new Error(
          "No se confirmó la promoción. Revisa su estado antes de reintentar.",
        );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "No fue posible conectar. Inténtalo nuevamente.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <section className={styles.coupon} aria-label={`Cupón para ${plan.name}`}>
      <button
        type="button"
        className={styles.couponToggle}
        aria-expanded={open}
        aria-controls={`${id}-fields`}
        onClick={() => setOpen(!open)}
      >
        <TicketPercent
          aria-hidden="true"
          className="size-4 shrink-0 text-primary"
        />
        <span>¿Tienes un cupón?</span>
        <ChevronDown aria-hidden="true" className={styles.couponChevron} />
      </button>
      {open && (
        <div id={`${id}-fields`} className={styles.couponBody}>
          <p>
            Un mes de descuento en {plan.name}. Conservas tu prueba gratis;
            después contratas al precio normal, sin renovación automática del
            cupón.
          </p>
          {disabled ? (
            <p role="status">
              {unavailableReason ||
                "Ya tienes una autorización automática. Adminístrala antes de utilizar una promoción."}
            </p>
          ) : (
            <>
              <form
                className={styles.couponFields}
                onSubmit={(event) => void act("preview", event)}
              >
                <label htmlFor={`${id}-code`}>
                  Código del cupón
                  <input
                    id={`${id}-code`}
                    value={code}
                    required
                    minLength={4}
                    maxLength={40}
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                    disabled={busy}
                    onChange={(event) => {
                      setCode(event.target.value.toUpperCase());
                      reset();
                    }}
                  />
                </label>
                <button
                  className={styles.couponApply}
                  type="submit"
                  disabled={busy || !code.trim()}
                >
                  {busy && !quote ? "Verificando…" : "Aplicar cupón"}
                </button>
              </form>
              {quote && (
                <div className={styles.couponQuote}>
                  <p role="status">
                    <strong>{quote.discountPercent}% de descuento</strong> en{" "}
                    {plan.name} · un mes
                  </p>
                  <p className={styles.couponPrice}>
                    <s>{money(quote.originalCents, quote.currency)}</s>
                    <strong>{money(quote.amountCents, quote.currency)}</strong>
                    <span>por el mes promocional</span>
                  </p>
                  <p>
                    Después: {money(quote.originalCents, quote.currency)}/mes al
                    contratar una suscripción. No se cobrará automáticamente al
                    terminar la promoción.
                  </p>
                  <label className={styles.couponConsent}>
                    <input
                      type="checkbox"
                      checked={consent}
                      disabled={busy}
                      onChange={(event) => setConsent(event.target.checked)}
                    />
                    <span>
                      Confirmo{" "}
                      {quote.amountCents === 0
                        ? "activar un mes sin costo"
                        : `pagar ${money(quote.amountCents, quote.currency)} por un mes`}
                      , sin renovación automática.
                    </span>
                  </label>
                  <button
                    type="button"
                    className={styles.couponConfirm}
                    disabled={busy || !consent}
                    onClick={() => void act("redeem")}
                  >
                    {busy
                      ? "Preparando…"
                      : quote.resume
                        ? "Continuar pago promocional"
                        : quote.amountCents === 0
                          ? "Activar mes gratis"
                          : `Pagar ${money(quote.amountCents, quote.currency)}`}
                  </button>
                </div>
              )}
            </>
          )}
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
