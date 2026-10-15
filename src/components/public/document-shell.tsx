import Link from "next/link";
import type { ReactNode } from "react";
import { BrandLogo } from "@/components/brand/brand-logo";
import { resolveBranding } from "@/lib/branding";
import styles from "./document-workspace.module.css";

export function DocumentShell({ title, description, active, integration = false, children }: {
    title: string; description?: string; active?: "privacy" | "terms" | "deletion";
    integration?: boolean; children: ReactNode;
}) {
    const branding = resolveBranding(null);
    const prefix = integration ? "/legal" : "";
    return <div className={styles.workspace}>
        <a className={styles.skip} href="#document-content">Ir al contenido</a>
        <header className={styles.header}>
            <Link href={integration ? "/google-calendar" : "/"} className={styles.brand} aria-label={`${branding.brandName}, inicio`}><BrandLogo brandName={branding.brandName} logoUrl={branding.brandLogoUrl} className={styles.logo} /><span>{branding.brandName}</span></Link>
            <Link className={styles.back} href="/login">Iniciar sesión</Link>
        </header>
        <main className={styles.layout} id="document-content" tabIndex={-1}>
            <nav className={styles.nav} aria-label="Documentos legales">
                <p>{integration ? "Google Calendar" : "Información de cuenta"}</p>
                <Link href={`${prefix}/privacy`} aria-current={active === "privacy" ? "page" : undefined}>Privacidad</Link>
                <Link href={`${prefix}/terms`} aria-current={active === "terms" ? "page" : undefined}>Términos</Link>
                {active === "deletion" && <Link href="/delete-account" aria-current="page">Eliminar cuenta</Link>}
            </nav>
            <article className={styles.article} aria-labelledby="document-title">
                <header className={styles.heading}><h1 id="document-title">{title}</h1>{description && <p>{description}</p>}</header>
                <div className={styles.content}>{children}</div>
            </article>
        </main>
        <footer className={styles.footer}><span>© 2026 {branding.brandName}</span><Link href={integration ? "/google-calendar" : "/login"}>{integration ? "Volver a Google Calendar" : "Volver al acceso"}</Link></footer>
    </div>;
}
