"use client";

import { useRef, useState, type FormEvent } from "react";
import { Copy, TicketPercent } from "lucide-react";
import styles from "./coupons.module.css";

type Plan = { slug: string; name: string };
export type CouponRow = { id: string; code: string; discountPercent: number; allowedPlanSlugs: string[]; maxUses: number; expiresAt: string; active: boolean; reservedUses: number; appliedUses: number };

export function CouponControlCenter({ plans, initialCoupons }: { plans: Plan[]; initialCoupons: CouponRow[] }) {
    const [coupons, setCoupons] = useState(initialCoupons);
    const [pending, setPending] = useState<string | null>(null);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");
    const lock = useRef(false);

    async function save(body: Record<string, unknown>, key: string, creating = false) {
        if (lock.current) return false;
        lock.current = true; setPending(key); setError(""); setMessage("");
        try {
            const response = await fetch("/api/control/coupons", { method: creating ? "POST" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "No se pudo guardar el cupón.");
            setMessage(creating ? `Cupón creado: ${result.coupon.code}` : body.active ? "Cupón reactivado." : "Cupón pausado. Los beneficios ya concedidos se conservan.");
            const list = await fetch("/api/control/coupons", { cache: "no-store" });
            const data = await list.json();
            if (!list.ok || !Array.isArray(data.coupons)) throw new Error("El cambio se guardó, pero no se pudo actualizar la lista. Recarga el panel antes de crear otro cupón.");
            setCoupons(data.coupons);
            return true;
        } catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo conectar. Revisa la lista antes de reintentar."); return false; }
        finally { lock.current = false; setPending(null); }
    }

    async function create(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        const date = new Date(String(data.get("expiresAt")));
        if (!Number.isFinite(date.getTime())) { setError("Selecciona la fecha de vencimiento."); return; }
        if (await save({ discountPercent: Number(data.get("discountPercent")), maxUses: Number(data.get("maxUses")), allowedPlanSlugs: data.getAll("plans"), expiresAt: date.toISOString() }, "create", true)) form.reset();
    }

    async function copy(code: string) {
        try { await navigator.clipboard.writeText(code); setMessage("Código copiado."); }
        catch { setError("No se pudo copiar. Selecciona el código y cópialo manualmente."); }
    }

    return <section className={styles.section} aria-labelledby="coupon-control-title" id="cupones">
        <header className={styles.heading}><TicketPercent aria-hidden="true" className="size-6 text-primary" /><div><h2 id="coupon-control-title">Cupones de bienvenida</h2><p>Un mes con 50% o 100% de descuento. Tú decides los planes, los usos y la vigencia.</p></div></header>
        <p className={styles.note}>La prueba gratuita de 7 o 14 días se configura en «Prueba y recuperación de pago» y se conserva completa. Después del mes promocional, el negocio deberá contratar al precio normal. No se activa una renovación automática al canjear.</p>
        <form onSubmit={create} className={styles.form}>
            <fieldset disabled={pending !== null} className={styles.fields}>
                <legend className="sr-only">Crear cupón</legend>
                <label>Descuento<select name="discountPercent" defaultValue="50"><option value="50">50% · paga la mitad</option><option value="100">100% · un mes gratis</option></select></label>
                <label>Límite de usos<input name="maxUses" type="number" min="1" max="100000" required defaultValue="1" inputMode="numeric" /></label>
                <label>Vence el<input name="expiresAt" type="datetime-local" required aria-describedby="coupon-timezone" /><span id="coupon-timezone" className={styles.hint}>Hora local de este dispositivo.</span></label>
                <fieldset className={styles.plans}><legend>Planes permitidos</legend>{plans.map(plan => <label key={plan.slug}><input name="plans" type="checkbox" value={plan.slug} defaultChecked /><span>{plan.name}</span></label>)}</fieldset>
                <button type="submit" className={styles.primary}>{pending === "create" ? "Generando…" : "Generar cupón"}</button>
            </fieldset>
        </form>
        {message && <p role="status" className={styles.feedback}>{message}</p>}
        {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
        <div className={styles.list} aria-label="Cupones generados">
            {coupons.length === 0 && <p className={styles.empty}>Todavía no hay cupones. Genera el primero para compartirlo con un negocio.</p>}
            {coupons.map(coupon => {
                const expired = new Date(coupon.expiresAt).getTime() <= Date.now();
                const status = !coupon.active ? "Pausado" : expired ? "Vencido" : coupon.reservedUses >= coupon.maxUses ? "Sin usos disponibles" : "Disponible";
                return <article key={coupon.id} className={styles.coupon}>
                    <div className={styles.couponTitle}><strong>{coupon.discountPercent}% <span>el primer mes</span></strong><span className={styles.status}>{status}</span></div>
                    <div className={styles.code}><code>{coupon.code}</code><button type="button" onClick={() => copy(coupon.code)} aria-label={`Copiar ${coupon.code}`}><Copy className="size-4" aria-hidden="true" /></button></div>
                    <p>{coupon.allowedPlanSlugs.map(slug => plans.find(plan => plan.slug === slug)?.name || slug).join(" · ")}</p>
                    <p><strong>{coupon.appliedUses}</strong> canjeados · <strong>{coupon.reservedUses - coupon.appliedUses}</strong> reservados · límite <strong>{coupon.maxUses}</strong></p>
                    <p>Vence {new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date(coupon.expiresAt))}</p>
                    <button type="button" className={styles.secondary} disabled={pending !== null || (expired && !coupon.active)} onClick={() => void save({ id: coupon.id, active: !coupon.active }, coupon.id)}>{pending === coupon.id ? "Guardando…" : coupon.active ? "Pausar cupón" : "Reactivar cupón"}</button>
                </article>;
            })}
        </div>
        <p className={styles.note}>Una promoción por negocio. Los pagos pendientes reservan un uso para evitar exceder el límite. Si una conexión falla después de crear el pago, la reserva queda protegida para revisión. Se muestran los últimos 200 cupones.</p>
    </section>;
}
