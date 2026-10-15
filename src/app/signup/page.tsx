import { AuthShell } from "@/components/public/auth-shell";
import styles from "@/components/public/auth-workspace.module.css";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignupForm } from "./signup-form";
import { getTurnstileSiteKey, isPublicTenantSignupEnabled } from "@/lib/multitenant-features";

export const dynamic = "force-dynamic";

export default function SignupPage() {
    if (!isPublicTenantSignupEnabled()) {
        redirect("/login");
    }
    const turnstileSiteKey = getTurnstileSiteKey();

    return <AuthShell title="Crea tu cuenta" description="Prepara un espacio para tu negocio. Primero confirmaremos tu correo.">
        <SignupForm turnstileSiteKey={turnstileSiteKey} />
        <div className={styles.links}><p>¿Ya tienes cuenta? <Link href="/login">Iniciar sesión</Link></p></div>
        <p className={styles.note}>Durante el acceso anticipado, el cobro genera un comprobante digital de la plataforma; todavía no emitimos CFDI mexicano.</p>
    </AuthShell>;
}
