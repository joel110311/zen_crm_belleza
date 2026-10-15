"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import styles from "./auth-workspace.module.css";

export function PasswordField({ id, name, label, autoComplete, minLength, maxLength, hint }: {
    id: string; name: string; label: string; autoComplete: string;
    minLength?: number; maxLength?: number; hint?: string;
}) {
    const [visible, setVisible] = useState(false);
    return <div className={styles.field}>
        <label htmlFor={id}>{label}</label>
        <div className={styles.password}>
            <input id={id} name={name} type={visible ? "text" : "password"} autoComplete={autoComplete} required minLength={minLength} maxLength={maxLength} aria-describedby={hint ? `${id}-hint` : undefined} />
            <button type="button" className={styles.passwordToggle} onClick={() => setVisible(current => !current)} aria-label={`${visible ? "Ocultar" : "Mostrar"} ${label.toLocaleLowerCase("es")}`} aria-pressed={visible} aria-controls={id}>
                {visible ? <EyeOff className="size-5" aria-hidden="true" /> : <Eye className="size-5" aria-hidden="true" />}
            </button>
        </div>
        {hint && <p className={styles.hint} id={`${id}-hint`}>{hint}</p>}
    </div>;
}
