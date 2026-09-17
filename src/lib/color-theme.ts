export const COLOR_THEME_STORAGE_KEY = "zen-color-theme-v3";

export const COLOR_THEMES = ["clinic", "green", "apple"] as const;
export type ColorTheme = (typeof COLOR_THEMES)[number];

export const DEFAULT_COLOR_THEME: ColorTheme = "clinic";

export function isColorTheme(value: unknown): value is ColorTheme {
    return typeof value === "string" && COLOR_THEMES.includes(value as ColorTheme);
}

export function applyColorTheme(theme: ColorTheme) {
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute("data-color-theme", theme);
}

export function persistColorTheme(theme: ColorTheme) {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(COLOR_THEME_STORAGE_KEY, theme);
}

export function readStoredColorTheme(): ColorTheme {
    if (typeof window === "undefined") return DEFAULT_COLOR_THEME;
    const stored = window.localStorage.getItem(COLOR_THEME_STORAGE_KEY);
    return isColorTheme(stored) ? stored : DEFAULT_COLOR_THEME;
}
