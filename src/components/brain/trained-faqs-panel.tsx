"use client";

import styles from "@/components/shared/management-workspace.module.css";
import { useWorkspaceAccess } from "@/components/layout/workspace-access-context";
import { useCallback, useEffect, useState } from "react";
import { Bot, Loader2, Pencil, Search, Trash2 } from "lucide-react";
import { deleteTrainedFaqWithFeedback, getTrainedFaqs, saveTrainedFaqWithFeedback } from "@/app/actions/ai-training";
import { FAQ_MAX_COUNT, type TrainedFaq } from "@/lib/ai/trained-faq-policy";
import { AiTrainingDialog } from "@/components/brain/ai-training-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function TrainedFaqsPanel() {
    const { readOnly } = useWorkspaceAccess();
    const [faqs, setFaqs] = useState<TrainedFaq[]>([]);
    const [query, setQuery] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [editing, setEditing] = useState<TrainedFaq | null>(null);
    const [deleting, setDeleting] = useState<TrainedFaq | null>(null);
    const load = useCallback(async () => {
        try { setFaqs(await getTrainedFaqs()); setError(""); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudieron cargar las FAQs."); }
        finally { setLoading(false); }
    }, []);
    useEffect(() => { void load(); }, [load]);

    async function change(faq: TrainedFaq, remove = false) {
        if (readOnly || busy) return;
        setBusy(true);
        try {
            const result = remove ? await deleteTrainedFaqWithFeedback(faq.id, faq.revision)
                : await saveTrainedFaqWithFeedback({ faqId: faq.id, question: faq.question, answer: faq.answer, active: !faq.active, expectedRevision: faq.revision });
            if (!result.success) throw new Error(result.error);
            setDeleting(null);
            await load();
        } catch (cause) { if (remove) setDeleting(null); setError(cause instanceof Error ? cause.message : "No se pudo actualizar la FAQ."); }
        finally { setBusy(false); }
    }
    const visible = faqs.filter((faq) => `${faq.question} ${faq.answer}`.toLocaleLowerCase("es").includes(query.toLocaleLowerCase("es")));

    return <section className="space-y-5 rounded-2xl border bg-card p-4 sm:p-6" aria-label="FAQs entrenadas">
        <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
                <h2 className="flex items-center gap-2 text-lg font-semibold"><Bot className="h-5 w-5 text-primary" />FAQs entrenadas</h2>
                <p className="max-w-2xl text-sm text-muted-foreground">Tus correcciones tienen prioridad sobre las instrucciones y otras fuentes para preguntas similares. Añade respuestas desde Chats → Entrenar IA.</p>
            </div>
            <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">Experimental</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-full sm:max-w-sm"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input aria-label="Buscar FAQs" className="pl-9" placeholder="Buscar pregunta o respuesta…" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
            <p className="text-xs text-muted-foreground">{faqs.filter((faq) => faq.active).length} activas · {faqs.length}/{FAQ_MAX_COUNT} FAQs</p>
        </div>
        {error && <div role="alert" className="flex items-center justify-between gap-3 text-sm text-destructive"><p>{error}</p><Button variant="outline" onClick={() => void load()}>Reintentar</Button></div>}
        {loading ? <p role="status" className="flex gap-2 py-8 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Cargando FAQs…</p> : !visible.length ? <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{query ? "No hay FAQs que coincidan con tu búsqueda." : "Aún no hay correcciones. Entrena tu primera respuesta desde Chats."}</p> : <div className={`${styles.faqList} divide-y rounded-xl border`}>
            {visible.map((faq) => <article key={faq.id} className="space-y-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="min-w-0 w-full sm:w-auto sm:flex-1 break-words text-sm font-semibold">{faq.question}</h3>
                    <div className={styles.faqActions}>
                        <Label htmlFor={`faq-${faq.id}`} className="text-xs text-muted-foreground">{faq.active ? "Activa" : "Pausada"}</Label><Switch id={`faq-${faq.id}`} checked={faq.active} disabled={busy || readOnly} onCheckedChange={() => void change(faq)} />
                        <Button size="icon" variant="ghost" aria-label={`Editar FAQ: ${faq.question}`} disabled={busy || readOnly} onClick={() => setEditing(faq)}><Pencil className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" aria-label={`Eliminar FAQ: ${faq.question}`} disabled={busy || readOnly} onClick={() => setDeleting(faq)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                </div>
                <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{faq.answer}</p>
            </article>)}
        </div>}
        {faqs.some((faq) => faq.active) && <details className="rounded-xl border p-4 text-sm">
            <summary className="cursor-pointer font-medium text-primary">Ver hoja de FAQs aprobadas</summary>
            <pre className="mt-4 max-h-80 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-4 font-sans text-sm leading-6">{faqs.filter((faq) => faq.active).map((faq) => `Pregunta: ${faq.question}\nRespuesta: ${faq.answer}`).join("\n\n")}</pre>
        </details>}
        <p className="text-xs text-muted-foreground">Pausar una FAQ la retira de la hoja activa. Prueba preguntas con otras palabras en Probar agente para evaluar el resultado.</p>
        {editing && <AiTrainingDialog key={editing.id} faq={editing} onClose={() => { setEditing(null); setLoading(true); void load(); }} />}
        <Dialog open={Boolean(deleting)} onOpenChange={(open) => { if (!open && !busy) setDeleting(null); }}>
            <DialogContent><DialogHeader><DialogTitle>Eliminar FAQ</DialogTitle><DialogDescription>Esta corrección dejará de usarse. El mensaje original del chat se conservará.</DialogDescription></DialogHeader>
                <p className="text-sm">{deleting?.question}</p><DialogFooter><Button variant="outline" disabled={busy || readOnly} onClick={() => setDeleting(null)}>Cancelar</Button><Button variant="destructive" disabled={busy || readOnly} onClick={() => { if (deleting) void change(deleting, true); }}>Eliminar FAQ</Button></DialogFooter>
            </DialogContent>
        </Dialog>
    </section>;
}
