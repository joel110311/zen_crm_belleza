"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, LockKeyhole } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { ExpiredWorkspaceNotice as Notice } from "@/lib/billing/workspace-access";

export function ExpiredWorkspaceNotice({ notice }: { notice: Notice }) {
    const [open, setOpen] = useState(true);
    const router = useRouter();
    useEffect(() => {
        const timer = window.setInterval(() => router.refresh(), 60_000);
        return () => window.clearInterval(timer);
    }, [router]);
    const format = (value: string) => new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeZone: notice.timeZone }).format(new Date(value));
    const warning = notice.phase !== "EXPIRED";
    const due = notice.phase === "DELETION_DUE";
    const title = due ? "El plazo de conservación terminó" : warning ? "Conserva los datos de tu negocio" : notice.source === "trial" ? "Tu periodo de prueba ha terminado" : "Tu suscripción ha terminado";
    const billingUrl = `/billing/${encodeURIComponent(notice.tenantSlug)}`;
    return <>
        <aside role="status" className="mx-3 mt-3 flex flex-wrap items-center gap-3 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm md:mx-5 lg:mx-6">
            <LockKeyhole className="size-4 shrink-0 text-primary" aria-hidden="true" />
            <p className="min-w-0 flex-1"><span className="font-semibold">{due ? "Acceso suspendido por vencimiento." : "Sin plan activo · Solo lectura."}</span>{warning ? ` Plazo de conservación: ${format(notice.deletionAt)}.` : " Reactiva un plan para volver a operar."}</p>
            <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>Ver aviso</Button>
            {notice.canManage && <Button asChild size="sm"><Link href={billingUrl}>Seleccionar un plan</Link></Button>}
        </aside>
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent className="max-h-[90dvh] gap-0 overflow-y-auto p-0 sm:max-w-2xl">
                <div className="grid sm:grid-cols-[150px_1fr]">
                    <div className="flex items-center justify-center border-b bg-primary/10 p-7 sm:border-b-0 sm:border-r" aria-hidden="true"><span className="flex size-20 items-center justify-center rounded-full bg-primary/15 text-primary"><CalendarClock className="size-10" /></span></div>
                    <div className="space-y-5 p-6 sm:p-8">
                        <DialogHeader className="text-left">
                            <DialogTitle className="pr-5 text-2xl leading-tight">{title}</DialogTitle>
                            <DialogDescription className="pt-2 text-sm leading-relaxed">
                                {due ? "El plazo de tres meses sin un plan vigente terminó. Tus datos están pendientes de eliminación." : notice.canManage ? "Puedes consultar y exportar tus datos. Selecciona un plan para seguir trabajando." : "Puedes consultar tus datos. Pide al propietario que seleccione un plan para seguir trabajando."}
                            </DialogDescription>
                        </DialogHeader>
                        {warning ? <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{due ? "Fecha límite alcanzada" : "Tus datos se eliminarán el"}</p>
                            <p className="mt-1 text-xl font-semibold text-primary">{format(notice.deletionAt)}</p>
                            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Tres meses desde el vencimiento del {format(notice.expiredAt)}. Entrar a la cuenta no reinicia este plazo.</p>
                        </div> : <p className="text-sm leading-relaxed text-muted-foreground">{notice.source === "trial" ? "La prueba terminó" : "El último periodo vigente terminó"} el {format(notice.expiredAt)}. Conservaremos tus datos durante tres meses a partir de esa fecha.</p>}
                        {notice.canManage && !due ? <a className="block text-sm font-medium text-primary underline underline-offset-4" href={`/api/t/${encodeURIComponent(notice.tenantSlug)}/export`}>Exportar datos del CRM</a> : null}
                        {!notice.canManage ? <p className="text-sm leading-relaxed">Pide al propietario del negocio que reactive el plan o exporte los datos.</p> : null}
                        <div className="flex flex-wrap gap-2">
                            {notice.canManage && <Button asChild><Link href={billingUrl}>Seleccionar un plan</Link></Button>}
                            <Button variant="outline" onClick={() => setOpen(false)}>{due ? "Cerrar aviso" : "Continuar en solo lectura"}</Button>
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    </>;
}
