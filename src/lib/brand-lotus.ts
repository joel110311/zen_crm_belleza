/** The Services lotus is also the default brand mark. Keep every rendering identical. */
export const BRAND_LOTUS_PATHS = [
    "M12.05 14.55C9.85 9.85 10.15 5.1 14.55 1.4c2.35 5.25 2.25 9.75-2.5 13.15Z",
    "M12.1 14.65c2.75-4.2 6.25-5.55 10.55-4.55-2.3 4.4-6.15 6-10.55 4.55Z",
    "M11.9 14.15c-3.75-.55-6.2-2.65-7.15-6.2 3.9.85 6.15 2.85 7.15 6.2Z",
    "M11.95 15.05c-3.75 2.8-7.55 2.95-10.8.4 3.5-2.25 7.3-2.4 10.8-.4Z",
    "m11.95 14.55 4.05 4.2 2.95-3.05",
] as const;
export const BRAND_LOTUS_BACKGROUND = "#4B5F25";
export const BRAND_LOTUS_INK = "#FFFFFF";

export function buildLotusFaviconSvg() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none"><rect x="2" y="2" width="60" height="60" rx="16" fill="${BRAND_LOTUS_BACKGROUND}"/><g transform="translate(8 11) scale(2)" stroke="${BRAND_LOTUS_INK}" stroke-width="1.9" stroke-linecap="square" stroke-linejoin="miter">${BRAND_LOTUS_PATHS.map((d) => `<path d="${d}"/>`).join("")}</g></svg>`;
}
