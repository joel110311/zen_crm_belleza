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
    preview: {
        background: string;
        surface: string;
        sidebar: string;
        accent: string;
        line: string;
    };
}> = [
    {
        id: "clinic",
        name: "Azul clínica",
        description: "Tema principal con azul clínico y sidebar negra",
        preview: {
            background: "#f3f9fb",
            surface: "#ffffff",
            sidebar: "#11131d",
            accent: "#3a88a8",
            line: "#d7e8ef",
        },
    },
    {
        id: "green",
        name: "NAYA",
        description: "Bienestar premium con marfil, café arena y oliva",
        preview: {
            background: "#EDDFCE",
            surface: "#FBF7F1",
            sidebar: "#140E08",
            accent: "#4B5528",
            line: "#C2AD98",
        },
    },
    {
        id: "apple",
        name: "Apple",
        description: "Azul Apple, superficies luminosas y grises neutros",
        preview: {
            background: "#f5f5f7",
            surface: "#ffffff",
            sidebar: "#e8e8ed",
            accent: "#0071e3",
            line: "#d2d2d7",
        },
    },
    {
        id: "vital",
        name: "Vital",
        description: "Editorial, minimalista y con naranja de alto contraste",
        preview: {
            background: "#efeeeb",
            surface: "#faf9f6",
            sidebar: "#080606",
            accent: "#f32003",
            line: "#c9c7c4",
        },
    },
    {
        id: "barber",
        name: "Barbería",
        description: "Carbón, negro cálido y dorado para salones y barberías",
        preview: {
            background: "#0a0907",
            surface: "#171612",
            sidebar: "#050504",
            accent: "#c99a2e",
            line: "#4d4022",
        },
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
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {COLOR_THEME_OPTIONS.map((option) => {
                const isActive = activeColorTheme === option.id;
                return (
                    <button
                        key={option.id}
                        type="button"
                        onClick={() => handleColorThemeChange(option.id)}
                        className={cn(
                            "group w-full rounded-2xl border-2 p-1 text-left transition-all",
                            isActive
                                ? "border-primary"
                                : "border-border hover:border-primary/40"
                        )}
                    >
                        <div className="overflow-hidden rounded-xl bg-secondary">
                            <div
                                className="flex h-24 gap-2 p-2.5"
                                style={{ backgroundColor: option.preview.background }}
                                aria-hidden="true"
                            >
                                <div
                                    className="w-8 shrink-0 rounded-lg"
                                    style={{ backgroundColor: option.preview.sidebar }}
                                />
                                <div className="flex min-w-0 flex-1 flex-col gap-2">
                                    <div className="flex items-center justify-between gap-2">
                                        <div
                                            className="h-2 w-16 rounded-full"
                                            style={{ backgroundColor: option.preview.line }}
                                        />
                                        <div
                                            className="h-4 w-4 rounded-full"
                                            style={{ backgroundColor: option.preview.accent }}
                                        />
                                    </div>
                                    <div className="grid flex-1 grid-cols-[1.25fr_0.75fr] gap-2">
                                        <div
                                            className="rounded-lg border p-2"
                                            style={{
                                                backgroundColor: option.preview.surface,
                                                borderColor: option.preview.line,
                                            }}
                                        >
                                            <div
                                                className="h-6 w-10 rounded-md"
                                                style={{ backgroundColor: option.preview.accent }}
                                            />
                                        </div>
                                        <div
                                            className="rounded-lg border"
                                            style={{
                                                backgroundColor: option.preview.surface,
                                                borderColor: option.preview.line,
                                            }}
                                        />
                                    </div>
                                </div>
                            </div>
                            <div className="flex min-w-0 items-start gap-3 p-3">
                                <div className="min-w-0 flex-1 space-y-0.5">
                                    <p className="text-sm font-semibold text-foreground">{option.name}</p>
                                    <p className="text-xs leading-relaxed text-muted-foreground">{option.description}</p>
                                </div>
                                {isActive ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> : null}
                            </div>
                        </div>
                    </button>
                );
            })}
        </div>
    );
}
