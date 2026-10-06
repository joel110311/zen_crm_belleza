export const DEFAULT_BRAND_NAME = "Zen CRM Belleza";
export const DEFAULT_BRAND_FAVICON_URL = "/brand/zen-favicon.svg";

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
    const seededNames = ["zen crm belleza", "zen crm oftalmo"];
    const brandName = businessName && !seededNames.includes(businessName.toLowerCase())
        ? businessName : cleanBrandValue(tenantName) || cleanBrandValue(source?.brandName) || DEFAULT_BRAND_NAME;
    return resolveBranding({ ...source, brandName });
}

function cleanBrandValue(value: string | null | undefined) {
    return value?.trim() || "";
}

export function resolveBranding(source?: BrandingSource | null): BrandingSettings {
    const brandName = cleanBrandValue(source?.brandName) || DEFAULT_BRAND_NAME;
    const brandLogoUrl = cleanBrandValue(source?.brandLogoUrl);
    const brandFaviconUrl = cleanBrandValue(source?.brandFaviconUrl) || DEFAULT_BRAND_FAVICON_URL;

    return {
        brandName,
        brandLogoUrl,
        brandFaviconUrl,
    };
}
