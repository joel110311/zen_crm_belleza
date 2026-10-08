"use client";

import Link from "next/link";

export type RuntimeErrorProps = {
    error: Error & { digest?: string };
    retry: () => void;
};

/** Never render raw database/provider errors or credentials into the browser. */
export function RuntimeError({ error, retry, scope = "esta página" }: RuntimeErrorProps & { scope?: string }) {
    return <main className="flex min-h-[60dvh] items-center justify-center bg-background px-5 py-12"><section role="alert" className="w-full max-w-lg rounded-2xl border bg-card p-8"><h1 className="text-2xl font-semibold">No pudimos cargar {scope}</h1><p className="mt-4 text-muted-foreground">Intenta nuevamente. No se ha cerrado tu sesión. Si estabas editando algo, verifica qué quedó guardado antes de repetir la operación.</p>{error.digest ? <p className="mt-3 text-xs text-muted-foreground">Referencia: {error.digest}</p> : null}<div className="mt-6 flex flex-wrap gap-3"><button type="button" onClick={retry} className="rounded-full bg-primary px-5 py-3 text-primary-foreground">Reintentar</button><Link href="/" className="rounded-full border px-5 py-3">Volver al inicio</Link></div></section></main>;
}
