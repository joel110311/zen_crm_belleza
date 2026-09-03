"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
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
    gradient: string;
}> = [
    {
        id: "clinic",
        name: "Azul clínica",
        description: "Tema principal con azul clínico y sidebar negra",
        gradient: "from-[#3A88A8] to-[#080b10]",
    },
    {
        id: "green",
        name: "Green",
        description: "Tema secundario en verdes naturales",
        gradient: "from-[#6f843d] to-[#263116]",
    },
    {
        id: "apple",
        name: "Apple",
        description: "Azul Apple, superficies luminosas y grises neutros",
        gradient: "from-[#0071e3] to-[#f5f5f7]",
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
        <div className="grid grid-cols-1 gap-3">
            {COLOR_THEME_OPTIONS.map((option) => {
                const isActive = activeColorTheme === option.id;
                return (
                    <button
                        key={option.id}
                        type="button"
                        onClick={() => handleColorThemeChange(option.id)}
                        className={cn(
                            "w-full rounded-xl border-2 p-1 text-left transition-all",
                            isActive
                                ? "border-primary"
                                : "border-border hover:border-primary/40"
                        )}
                    >
                        <div className="flex min-w-0 items-center gap-3 rounded-lg bg-secondary p-3">
                            <div className={cn("h-10 w-10 rounded-full bg-gradient-to-br shadow-md", option.gradient)} />
                            <div className="min-w-0 flex-1 space-y-0.5">
                                <p className="text-sm font-semibold text-foreground">{option.name}</p>
                                <p className="text-xs leading-relaxed text-muted-foreground">{option.description}</p>
                            </div>
                            {isActive ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
                        </div>
                    </button>
                );
            })}
        </div>
    );
}
