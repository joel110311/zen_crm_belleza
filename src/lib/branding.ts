export const DEFAULT_BRAND_NAME = "Zen CRM Oftalmo";
export const DEFAULT_BRAND_FAVICON_URL = "/brand/zen-favicon.svg";

export type BrandingSettings = {
    brandName: string;
    brandLogoUrl: string;
    brandFaviconUrl: string;
};

type BrandingSource = {
    brandName?: string | null;
    brandLogoUrl?: string | null;
    brandFaviconUrl?: string | null;
};

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
