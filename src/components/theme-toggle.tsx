"use client";

import { useSyncExternalStore } from "react";
import { Laptop, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import styles from "@/components/shared/settings-workspace.module.css";

const MODES = [
    { id: "light", label: "Claro", icon: Sun },
    { id: "dark", label: "Oscuro", icon: Moon },
    { id: "system", label: "Sistema", icon: Laptop },
];

const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

export function ThemeToggle() {
    const { setTheme, theme } = useTheme();
    const mounted = useSyncExternalStore(subscribe, clientReady, serverReady);
    if (!mounted) return <p role="status" className="text-sm text-muted-foreground">Cargando apariencia…</p>;
    return <div className={styles.displayModes} role="group" aria-label="Modo de visualización">
        {MODES.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-pressed={theme === id} onClick={() => setTheme(id)} className={styles.displayMode}>
            <Icon className="size-5" aria-hidden="true" /><span>{label}</span>
        </button>)}
    </div>;
}
