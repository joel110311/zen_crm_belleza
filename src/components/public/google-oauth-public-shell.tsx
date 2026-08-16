import Link from "next/link";
import { CalendarCheck2, ShieldCheck } from "lucide-react";

export function GoogleOAuthPublicShell({
    title,
    description,
    children,
}: {
    title: string;
    description: string;
    children: React.ReactNode;
}) {
    return (
        <div className="min-h-dvh bg-[#f7f9fb] text-foreground">
            <header className="border-b bg-white/90 backdrop-blur">
                <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
                    <Link href="/google-calendar" className="flex items-center gap-3 font-semibold">
                        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                            <CalendarCheck2 className="h-5 w-5" />
                        </span>
                        <span>Zen CRM</span>
                    </Link>
                    <Link href="/login" className="text-sm font-medium text-primary hover:underline">
                        Iniciar sesion
                    </Link>
                </div>
            </header>

            <main className="mx-auto w-full max-w-5xl px-5 py-12 sm:px-8 sm:py-16">
                <div className="max-w-3xl">
                    <div className="mb-5 inline-flex items-center gap-2 rounded-full border bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.15em] text-primary">
                        <ShieldCheck className="h-4 w-4" />
                        Integracion segura
                    </div>
                    <h1 className="text-balance text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">{title}</h1>
                    <p className="mt-5 text-lg leading-8 text-muted-foreground">{description}</p>
                </div>

                <article className="mt-10 max-w-3xl rounded-3xl border bg-white p-6 shadow-sm sm:p-9">
                    <div className="space-y-7 leading-7 text-foreground/85">{children}</div>
                </article>
            </main>

            <footer className="border-t bg-white">
                <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-5 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-8">
                    <span>© 2026 Zen CRM</span>
                    <nav className="flex flex-wrap gap-4">
                        <Link href="/legal/privacy" className="hover:text-foreground hover:underline">Privacidad</Link>
                        <Link href="/legal/terms" className="hover:text-foreground hover:underline">Terminos</Link>
                    </nav>
                </div>
            </footer>
        </div>
    );
}
