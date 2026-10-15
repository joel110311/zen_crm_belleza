"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import styles from "./account-deletion.module.css";

type Business = { id: string; name: string; soleOwner: boolean; successors: { id: string; name: string }[] };
export function AccountDeletionPanel() {
    const [businesses, setBusinesses] = useState<Business[] | null>(null);
    const [decisions, setDecisions] = useState<Record<string,string>>({});
    const [password, setPassword] = useState("");
    const [confirmation, setConfirmation] = useState("");
    const [error, setError] = useState("");
    const [loginRequired, setLoginRequired] = useState(false);
    const [busy, setBusy] = useState(false);
    const busyRef = useRef(false);
    const [checking, setChecking] = useState(false);
    const checkingRef = useRef(false);
    const [receipt, setReceipt] = useState("");
    const [status, setStatus] = useState("");

    async function checkStatus(token: string) {
        if (checkingRef.current) return;
        checkingRef.current = true; setChecking(true); setError("");
        try {
            const response = await fetch("/api/public/account-deletion/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ receipt: token }) });
            if (!response.ok) throw new Error("No se pudo consultar el estado. Inténtalo de nuevo.");
            const result = await response.json();
            setStatus(result.status);
        } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo consultar la solicitud."); }
        finally { checkingRef.current = false; setChecking(false); }
    }

    useEffect(() => {
        const token = window.location.hash.slice(1);
        if (/^[a-f0-9]{64}$/.test(token)) { setReceipt(token); void checkStatus(token); return; }
        let active = true;
        fetch("/api/account/deletion", { cache: "no-store" }).then(async (response) => {
            if (!active) return;
            if (response.status === 401) { setLoginRequired(true); return; }
            if (!response.ok) throw new Error("No se pudieron consultar tus negocios.");
            const result = await response.json();
            if (active) setBusinesses(result.businesses);
        }).catch(() => { if (active) setError("No se pudieron consultar tus negocios. Recarga la página para reintentar."); });
        return () => { active = false; };
    }, []);

    async function submit(event: React.FormEvent) {
        event.preventDefault();
        if (busyRef.current || receipt || confirmation !== "ELIMINAR MI CUENTA" || !password || !businesses || businesses.some(business => business.soleOwner && !decisions[business.id])) return;
        busyRef.current = true; setBusy(true); setError("");
        const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2,"0")).join("");
        // The receipt survives an interrupted response without appearing in server URL logs.
        window.history.replaceState(null, "", `/delete-account#${token}`);
        try {
            const response = await fetch("/api/account/deletion", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password, confirmation, decisions, receipt: token }) });
            const result = await response.json();
            if (!response.ok) { window.history.replaceState(null,"","/delete-account"); throw new Error(result.error || "No se pudo solicitar la eliminación."); }
            setPassword(""); setReceipt(token); setStatus(result.status);
        } catch (cause) {
            if (window.location.hash === `#${token}`) { setReceipt(token); setStatus(""); setPassword(""); }
            setError(cause instanceof Error ? cause.message : "No se pudo confirmar. Consulta el estado antes de reintentar.");
        }
        finally { busyRef.current = false; setBusy(false); }
    }

    return <div className={styles.panel}>
        <p className="text-sm leading-6 text-muted-foreground">Esta opción elimina tu cuenta de SynapseLogik CRM y tus datos de perfil. Tu acceso se revoca al confirmar. Los negocios que decidas cerrar perderán sus clientes, citas, conversaciones, archivos y configuración. Esta acción es irreversible.</p>
        <details className={styles.explanation}><summary>Qué ocurre con tus datos</summary><div><p className="text-sm leading-6 text-muted-foreground">En negocios que continúen funcionando, las operaciones compartidas conservarán referencias anónimas. Las conexiones de Google hechas con el correo de tu cuenta se desconectarán. Los proveedores de pago pueden conservar comprobantes por obligaciones legales. Las copias de respaldo se retiran según la política de retención publicada; no se usan para reactivar una cuenta eliminada.</p>
        <p className="rounded-xl border bg-muted/30 p-3 text-sm leading-6 text-muted-foreground">Si utilizaste una prueba, conservaremos únicamente una huella criptográfica no legible del correo para impedir el uso repetido de la promoción. No permite recuperar el correo ni iniciar sesión, y no se utiliza para publicidad.</p></div></details>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        {receipt ? <div className={styles.result} aria-live="polite">
            <h2 className="font-semibold">{status === "COMPLETED" ? "Tu cuenta fue eliminada" : status === "NOT_FOUND" ? "No se encontró una solicitud con este comprobante" : status ? "Eliminación en proceso" : "Consulta el estado de tu solicitud"}</h2>
            <p className="text-sm">{status === "COMPLETED" ? "La limpieza de los datos activos terminó y tu cuenta ya no puede iniciar sesión." : status === "NOT_FOUND" ? "Comprueba que guardaste el enlace completo. Puedes volver a consultar tu cuenta antes de iniciar otra solicitud." : "Guarda este enlace privado para consultar el estado. No cierres el negocio nuevamente: si hay una interrupción, la limpieza se reintentará."}</p>
            <Button variant="outline" disabled={checking} onClick={() => void checkStatus(receipt)}>{checking ? "Consultando…" : "Consultar estado"}</Button>
            {status === "NOT_FOUND" && <a className="block text-sm underline" href="/delete-account">Volver a comprobar mi cuenta</a>}
        </div> : loginRequired ? <div className="space-y-3">
            <Button asChild><Link href="/login?redirectTo=%2Fdelete-account">Iniciar sesión para eliminar mi cuenta</Link></Button>
            <p className="text-sm"><Link className="underline" href="/forgot-password">Recuperar contraseña</Link></p>
        </div> : businesses ? <form onSubmit={submit} className={styles.form} aria-busy={busy}><fieldset disabled={busy} className={styles.fields}><legend className="sr-only">Confirmación de eliminación</legend>
            {businesses.length > 0 && <h2>Tus negocios</h2>}
            {businesses.map((business) => <fieldset key={business.id} className={styles.business}>
                <legend>{business.name}</legend>
                {business.soleOwner ? <>
                    <p className={styles.hint}>Eres el único propietario. Elige qué hacer con este negocio.</p>
                    {business.successors.map(member => <label key={member.id} className={styles.choice}><input type="radio" name={`decision-${business.id}`} value={member.id} required checked={decisions[business.id] === member.id} onChange={() => setDecisions(current => ({ ...current, [business.id]: member.id }))} /><span>Transferir a {member.name}</span></label>)}
                    <label className={styles.choice}><input type="radio" name={`decision-${business.id}`} value="close" required checked={decisions[business.id] === "close"} onChange={() => setDecisions(current => ({ ...current, [business.id]: "close" }))} /><span>Cerrar y eliminar todos los datos de este negocio</span></label>
                    <p className={styles.hint}>Cerrar también retira el acceso del equipo y cancela la suscripción del negocio.</p>
                </> : <p className={styles.hint}>Se retirará tu acceso. El negocio y las cuentas de sus otros integrantes continuarán funcionando.</p>}
            </fieldset>)}
            <div className="space-y-2"><Label htmlFor="deletion-password">Contraseña actual</Label><Input id="deletion-password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="deletion-confirmation">Escribe ELIMINAR MI CUENTA para confirmar</Label><Input id="deletion-confirmation" autoComplete="off" required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></div>
            </fieldset>
            <Button type="submit" variant="destructive" disabled={busy || confirmation !== "ELIMINAR MI CUENTA" || !password || businesses.some(business => business.soleOwner && !decisions[business.id])}>{busy ? "Solicitando eliminación…" : "Eliminar mi cuenta definitivamente"}</Button>
        </form> : !error && <p className="text-sm" role="status">Consultando tu cuenta…</p>}
        <p className="text-sm text-muted-foreground">Si necesitas ayuda, escribe a <a className="underline" href="mailto:contacto@synapselogik.com?subject=Eliminaci%C3%B3n%20de%20cuenta">contacto@synapselogik.com</a> desde el correo de tu cuenta.</p>
    </div>;
}
