export const COLOR_THEME_STORAGE_KEY = "zen-color-theme-v3";

export const COLOR_THEMES = ["clinic", "green", "apple", "pink", "gold"] as const;
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
    try { window.localStorage.setItem(COLOR_THEME_STORAGE_KEY, theme); } catch { /* The selected theme still works when storage is unavailable. */ }
}

export function readStoredColorTheme(): ColorTheme {
    if (typeof window === "undefined") return DEFAULT_COLOR_THEME;
    try {
        const stored = window.localStorage.getItem(COLOR_THEME_STORAGE_KEY);
        return isColorTheme(stored) ? stored : DEFAULT_COLOR_THEME;
    } catch { return DEFAULT_COLOR_THEME; }
}


/** Use the same catalog before the first paint and after React mounts. */
export function getColorThemeInitScript(): string {
    return `(() => {
        try {
            const stored = window.localStorage.getItem(${JSON.stringify(COLOR_THEME_STORAGE_KEY)});
            const nextTheme = ${JSON.stringify(COLOR_THEMES)}.includes(stored) ? stored : ${JSON.stringify(DEFAULT_COLOR_THEME)};
            document.documentElement.setAttribute("data-color-theme", nextTheme);
        } catch {
            document.documentElement.setAttribute("data-color-theme", ${JSON.stringify(DEFAULT_COLOR_THEME)});
        }
    })();`;
}
