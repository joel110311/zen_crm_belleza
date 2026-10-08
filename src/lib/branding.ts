export const DEFAULT_BRAND_NAME = "Zen CRM Cuidado Personal";
export const DEFAULT_BRAND_FAVICON_URL = "/brand/lotus-favicon.svg";
export const DEFAULT_BRAND_APPLE_ICON_URL = "/brand/lotus-apple-touch-icon.png";

export type BrandingSettings = {
    brandName: string;
    brandLogoUrl: string;
    brandFaviconUrl: string;
};

type BrandingSource = {
    clinicName?: string | null;
    brandName?: string | null;
    brandLogoUrl?: string | null;
    brandFaviconUrl?: string | null;
};

/** Tenant shells use their saved business identity, not the application's seed branding. */
export function resolveTenantBranding(source: BrandingSource | null | undefined, tenantName: string): BrandingSettings {
    const businessName = cleanBrandValue(source?.clinicName);
    const seededNames = ["zen crm cuidado personal", "zen crm belleza", "zen crm oftalmo"];
    const brandName = businessName && !seededNames.includes(businessName.toLowerCase())
        ? businessName : cleanBrandValue(tenantName) || cleanBrandValue(source?.brandName) || DEFAULT_BRAND_NAME;
    return resolveBranding({ ...source, brandName });
}

function cleanBrandValue(value: string | null | undefined) {
    return value?.trim() || "";
}

export function resolveBrandFavicon(value?: string | null) {
    const url = cleanBrandValue(value);
    return !url || url === "/brand/zen-favicon.svg" ? DEFAULT_BRAND_FAVICON_URL : url;
}

/** Metadata, white-label preview and public pages share the same icon defaults. */
export function getBrandingIcons(branding: BrandingSettings) {
    return {
        icon: [{ url: branding.brandFaviconUrl, ...(branding.brandFaviconUrl === DEFAULT_BRAND_FAVICON_URL ? { type: "image/svg+xml", sizes: "any" } : {}) }],
        shortcut: branding.brandFaviconUrl,
        apple: branding.brandFaviconUrl === DEFAULT_BRAND_FAVICON_URL ? DEFAULT_BRAND_APPLE_ICON_URL : branding.brandFaviconUrl,
    };
}

/** Upgrade only the former product defaults; keep each business's custom identity. */
export function normalizeDefaultBusinessText(value: string): string {
    const defaults: Record<string, string> = {
        "Zen CRM Belleza": DEFAULT_BRAND_NAME,
        "Servicios de belleza": "Servicios de cuidado personal",
        "Profesional de belleza": "Profesional de cuidado personal",
        "Zen CRM Belleza\nServicios de belleza\nDireccion del negocio": `${DEFAULT_BRAND_NAME}\nServicios de cuidado personal\nDireccion del negocio`,
    };
    return Object.hasOwn(defaults, value) ? defaults[value] : value;
}

export function resolveBranding(source?: BrandingSource | null): BrandingSettings {
    const brandName = normalizeDefaultBusinessText(cleanBrandValue(source?.brandName)) || DEFAULT_BRAND_NAME;
    const brandLogoUrl = cleanBrandValue(source?.brandLogoUrl);
    const brandFaviconUrl = resolveBrandFavicon(source?.brandFaviconUrl);

    return {
        brandName,
        brandLogoUrl,
        brandFaviconUrl,
    };
}
