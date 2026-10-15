import Link from "next/link";
import type { ReactNode } from "react";
import { BrandLogo } from "@/components/brand/brand-logo";
import { resolveBranding, type BrandingSettings } from "@/lib/branding";
import styles from "./auth-workspace.module.css";

export function AuthShell({ children, title, description, branding = resolveBranding(null) }: {
    children: ReactNode;
    title: string;
    description?: string;
    branding?: BrandingSettings;
}) {
    return <div className={styles.workspace} data-auth-workspace>
        <a href="#auth-content" className={styles.skip}>Ir al formulario</a>
        <header className={styles.header}>
            <Link href="/" className={styles.brand} aria-label={`${branding.brandName}, inicio`}>
                <BrandLogo brandName={branding.brandName} logoUrl={branding.brandLogoUrl} className={styles.logo} />
                <span>{branding.brandName}</span>
            </Link>
            <Link href="/" className={styles.home}>Volver al inicio</Link>
        </header>
        <main className={styles.main} id="auth-content" tabIndex={-1}>
            <aside className={styles.intro} aria-label="Sobre el CRM">
                <p className={styles.statement}>Tu negocio,<br />en orden.</p>
                <p>Agenda, clientes y conversaciones en un solo lugar. Más claridad para ti y tu equipo.</p>
            </aside>
            <section className={styles.panel} aria-labelledby="auth-title">
                <div className={styles.heading}><h1 id="auth-title">{title}</h1>{description && <p>{description}</p>}</div>
                {children}
            </section>
        </main>
        <footer className={styles.footer}>
            <span>© 2026 {branding.brandName}</span>
            <nav aria-label="Información legal"><Link href="/privacy">Privacidad</Link><Link href="/terms">Términos</Link></nav>
        </footer>
    </div>;
}
