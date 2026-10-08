"use client";
import type { RuntimeErrorProps } from "@/components/runtime-error";

export default function GlobalError({ retry }: RuntimeErrorProps) {
    return <html lang="es"><head><title>Recuperar CRM</title></head><body style={{ fontFamily: "system-ui, sans-serif", background: "#f6f8f6", color: "#18251d", margin: 0 }}><main style={{ maxWidth: 480, margin: "15vh auto", padding: 28 }}><h1>No pudimos cargar el CRM</h1><p>Intenta nuevamente. No se ha cerrado tu sesión.</p><button type="button" onClick={retry} style={{ padding: "12px 20px", cursor: "pointer" }}>Reintentar</button><p><button type="button" onClick={() => window.location.assign("/")}>Volver al inicio</button></p></main></body></html>;
}
