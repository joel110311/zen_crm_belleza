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

    return (
        <main className="mx-auto flex min-h-dvh max-w-2xl items-center px-5 py-12">
            <section className="w-full rounded-2xl border bg-card p-6 shadow-sm sm:p-9">
                <p className="text-sm font-semibold text-primary">Acceso anticipado</p>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight">Crea tu CRM en minutos</h1>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">Crearemos un espacio aislado para tu negocio y te llevaremos a su configuración inicial.</p>
                <div className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm leading-6 text-foreground">Durante el acceso anticipado, el cobro genera un comprobante digital de la plataforma; todavía no emitimos CFDI mexicano.</div>
                <div className="mt-7"><SignupForm turnstileSiteKey={turnstileSiteKey} /></div>
                <p className="mt-5 text-center text-sm text-muted-foreground">¿Ya tienes una cuenta? <Link className="font-medium text-primary hover:underline" href="/login">Inicia sesión</Link></p>
            </section>
        </main>
    );
}
