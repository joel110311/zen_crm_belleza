import Link from "next/link";
import { redirect } from "next/navigation";
import { isPublicTenantSignupEnabled } from "@/lib/multitenant-features";

export const dynamic = "force-dynamic";

export default function Home() {
    if (!isPublicTenantSignupEnabled()) {
        redirect("/login");
    }

    return (
        <main className="mx-auto flex min-h-dvh max-w-5xl items-center px-5 py-16">
            <section className="max-w-2xl">
                <p className="text-sm font-semibold text-primary">Zen CRM Belleza · acceso anticipado</p>
                <h1 className="mt-4 text-balance text-5xl font-semibold tracking-tight sm:text-6xl">Tu agenda, clientes y conversaciones en un solo espacio.</h1>
                <p className="mt-6 max-w-xl text-lg leading-8 text-muted-foreground">Crea un entorno privado para tu negocio de belleza. Empieza a configurarlo sin esperar una instalación manual.</p>
                <div className="mt-8 flex flex-wrap gap-3">
                    <Link href="/signup" className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground">Probar ahora</Link>
                    <Link href="/login" className="inline-flex h-11 items-center justify-center rounded-md border px-5 text-sm font-semibold">Iniciar sesión</Link>
                </div>
                <p className="mt-6 text-sm text-muted-foreground">Acceso beta. El cobro futuro genera comprobante digital; la facturación CFDI aún no está disponible.</p>
            </section>
        </main>
    );
}
