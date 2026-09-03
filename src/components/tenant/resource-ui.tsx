import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

export function ResourcePage({ title, description, action, children }: {
    title: string;
    description: string;
    action?: ReactNode;
    children: ReactNode;
}) {
    return (
        <main className="mx-auto w-full max-w-[1500px] pb-5">
            <div className="overflow-hidden rounded-[22px] border bg-card">
                <header className="flex flex-col gap-4 border-b px-5 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-6">
                    <div>
                        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
                        <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
                    </div>
                    {action}
                </header>
                <div className="bg-muted/20 px-5 py-5 sm:px-6 sm:py-6">{children}</div>
            </div>
        </main>
    );
}

export function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
    return <div className={`space-y-2 ${className}`}><Label>{label}</Label>{children}</div>;
}

export function Feedback({ error, success }: { error?: string | null; success?: string | null }) {
    if (!error && !success) return null;
    return (
        <p role={error ? "alert" : "status"} className={`rounded-xl border px-4 py-3 text-sm ${error ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"}`}>
            {error || success}
        </p>
    );
}

export function EmptyState({ children }: { children: ReactNode }) {
    return <div className="rounded-2xl border border-dashed bg-card/60 px-6 py-12 text-center text-sm text-muted-foreground">{children}</div>;
}
