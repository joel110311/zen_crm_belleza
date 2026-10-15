import type { CSSProperties, ReactNode } from "react";
import { BrandLogo } from "@/components/brand/brand-logo";
import styles from "./portal-workspace.module.css";

export function portalColors(color?: string): CSSProperties | undefined {
    if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return;
    const rgb = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    const luminance = .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
    const ink = luminance > .179 ? "#000000" : "#ffffff";
    return { "--portal-accent": color, "--portal-on-accent": ink, "--primary": color, "--primary-foreground": ink, "--ring": color } as CSSProperties;
}

export function PortalFrame({ children, name, subtitle, logoUrl, logoScale = 100, primaryColor }: {
    children: ReactNode; name: string; subtitle?: string; logoUrl?: string | null; logoScale?: number; primaryColor?: string;
}) {
    return <div className={styles.workspace} style={portalColors(primaryColor)} data-portal-workspace>
        <a href="#portal-content" className={styles.skip}>Ir al contenido</a>
        <header className={styles.header}><span className={styles.logoFrame} style={{ "--portal-logo-scale": logoUrl && Number.isFinite(logoScale) ? Math.max(.6, Math.min(1.6, logoScale / 100)) : 1 } as CSSProperties}><BrandLogo brandName={name} logoUrl={logoUrl} className={styles.logo} /></span><div><p className={styles.businessName}>{name}</p>{subtitle && <p className={styles.subtitle}>{subtitle}</p>}</div></header>
        <main id="portal-content" className={styles.main} tabIndex={-1}>{children}</main>
        <footer className={styles.footer}><span>Reservas en línea</span><a href="/privacy">Privacidad</a></footer>
    </div>;
}
