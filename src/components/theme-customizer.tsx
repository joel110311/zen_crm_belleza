"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import styles from "./theme-customizer.module.css";
import {
    applyColorTheme,
    DEFAULT_COLOR_THEME,
    persistColorTheme,
    readStoredColorTheme,
    type ColorTheme,
} from "@/lib/color-theme";

const COLOR_THEME_OPTIONS: Array<{
    id: ColorTheme;
    name: string;
    description: string;
    preview: string;
}> = [
    {
        id: "clinic",
        name: "Azul clínica",
        description: "Azul clínico sobre una base neutra",
        preview: styles.clinic,
    },
    {
        id: "green",
        name: "Olive",
        description: "Oliva cálido como acento",
        preview: styles.olive,
    },
    {
        id: "apple",
        name: "Apple",
        description: "Azul Apple sobre una base neutra",
        preview: styles.apple,
    },
    {
        id: "pink",
        name: "Pink",
        description: "Rosa frambuesa como acento",
        preview: styles.pink,
    },
    {
        id: "gold",
        name: "Gold · Oro",
        description: "Oro antiguo y champán como acentos",
        preview: styles.gold,
    },
];

export function ThemeCustomizer() {
    const [mounted, setMounted] = React.useState(false);
    const [activeColorTheme, setActiveColorTheme] = React.useState<ColorTheme>(DEFAULT_COLOR_THEME);

    React.useEffect(() => {
        setMounted(true);
        const storedTheme = readStoredColorTheme();
        setActiveColorTheme(storedTheme);
        applyColorTheme(storedTheme);
    }, []);

    const handleColorThemeChange = (nextTheme: ColorTheme) => {
        setActiveColorTheme(nextTheme);
        applyColorTheme(nextTheme);
        persistColorTheme(nextTheme);
    };

    if (!mounted) return null;

    return (
        <div className={styles.options} role="group" aria-label="Tema de colores">
            {COLOR_THEME_OPTIONS.map((option) => {
                const isActive = activeColorTheme === option.id;
                return (
                    <button
                        key={option.id}
                        type="button"
                        aria-pressed={isActive}
                        onClick={() => handleColorThemeChange(option.id)}
                        className={cn(
                            styles.option,
                            isActive
                                ? "border-primary"
                                : "border-border hover:border-primary/40"
                        )}
                    >
                        <div className={styles.optionContent}>
                            <span className={cn(styles.preview, option.preview)} aria-hidden="true"><span /><span /><span /></span>
                            <div className="min-w-0 flex-1 space-y-0.5">
                                <p className="text-sm font-semibold text-foreground">{option.name}</p>
                                <p className="text-[13px] leading-relaxed text-muted-foreground">{option.description}</p>
                            </div>
                            {isActive ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
                        </div>
                    </button>
                );
            })}
        </div>
    );
}
