"use client";

import Link from "next/link";
import { Clock3, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export type TrialNotice = {
    id: string;
    tenantSlug: string;
    endsAt: string;
    warningHours: number;
    selectedPlanName?: string | null;
    selectedPlanAmountCents?: number | null;
    currency?: string | null;
    canManage: boolean;
};

function remainingCopy(endsAt: Date, now: number) {
    const hours = Math.max(1, Math.ceil((endsAt.getTime() - now) / 3_600_000));
    if (hours <= 24) return "Te queda menos de un día de prueba.";
    return `Te quedan ${Math.ceil(hours / 24)} días de prueba.`;
}

export function TrialExpiryBanner({ notice }: { notice: TrialNotice }) {
    const [now, setNow] = useState(() => Date.now());
    const [dismissed, setDismissed] = useState(false);
    const endsAt = useMemo(() => new Date(notice.endsAt), [notice.endsAt]);
    const storageKey = `trial-banner:${notice.id}:${endsAt.toISOString().slice(0, 10)}`;

    useEffect(() => {
        const interval = window.setInterval(() => setNow(Date.now()), 60_000);
        return () => window.clearInterval(interval);
    }, []);

    const remainingMs = endsAt.getTime() - now;
    if (dismissed || remainingMs <= 0 || remainingMs > notice.warningHours * 60 * 60 * 1_000) return null;

    const formattedDate = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(endsAt);
    const selectedPrice = notice.selectedPlanName && notice.selectedPlanAmountCents != null
        ? new Intl.NumberFormat("es-MX", { style: "currency", currency: notice.currency || "MXN", maximumFractionDigits: 0 }).format(notice.selectedPlanAmountCents / 100)
        : null;
    const copy = notice.selectedPlanName
        ? `Tu plan ${notice.selectedPlanName} comenzará el ${formattedDate}${selectedPrice ? ` por ${selectedPrice} al mes` : ""}.`
        : `Elige un plan para conservar el acceso después del ${formattedDate}.`;

    return (
        <aside className="mx-3 mt-3 flex items-start gap-3 rounded-2xl border border-amber-400/45 bg-amber-50 px-3.5 py-3 text-amber-950 shadow-sm dark:bg-amber-950/30 dark:text-amber-100 md:mx-5 lg:mx-6" role="status">
            <Clock3 className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-300" aria-hidden="true" />
            <div className="min-w-0 flex-1 text-sm leading-5">
                <span className="font-semibold">{remainingCopy(endsAt, now)}</span>{" "}
                <span>{copy}</span>
            </div>
            {notice.canManage ? <Link href={`/billing/${encodeURIComponent(notice.tenantSlug)}`} className="shrink-0 rounded-full bg-amber-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-800 dark:bg-amber-200 dark:text-amber-950">{notice.selectedPlanName ? "Administrar" : "Ver planes"}</Link> : null}
            <button type="button" aria-label="Ocultar aviso por esta sesión" className="shrink-0 rounded-full p-1 text-amber-800/70 hover:bg-amber-200/60 dark:text-amber-100/70 dark:hover:bg-amber-900/50" onClick={() => { window.sessionStorage.setItem(storageKey, "dismissed"); setDismissed(true); }}><X className="size-4" /></button>
        </aside>
    );
}
