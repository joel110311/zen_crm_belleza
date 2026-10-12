"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot, Loader2, Pencil, Search, Trash2 } from "lucide-react";
import { deleteTrainedFaq, getTrainedFaqs, saveTrainedFaq } from "@/app/actions/ai-training";
import { FAQ_MAX_COUNT, type TrainedFaq } from "@/lib/ai/trained-faq-policy";
import { AiTrainingDialog } from "@/components/brain/ai-training-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function TrainedFaqsPanel() {
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
        setBusy(true);
        try {
            if (remove) await deleteTrainedFaq(faq.id);
            else await saveTrainedFaq({ faqId: faq.id, question: faq.question, answer: faq.answer, active: !faq.active });
            setDeleting(null);
            await load();
        } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo actualizar la FAQ."); }
        finally { setBusy(false); }
    }
    const visible = faqs.filter((faq) => `${faq.question} ${faq.answer}`.toLocaleLowerCase("es").includes(query.toLocaleLowerCase("es")));

    return <section className="space-y-5 rounded-2xl border bg-card p-4 sm:p-6" aria-label="FAQs entrenadas">
        <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
                <h2 className="flex items-center gap-2 text-lg font-semibold"><Bot className="h-5 w-5 text-primary" />FAQs entrenadas</h2>
                <p className="max-w-2xl text-sm text-muted-foreground">Respuestas aprobadas que la IA consulta en cada mensaje y prioriza para preguntas similares. Créala desde Chats → menú de una respuesta de IA → Entrenar IA.</p>
            </div>
            <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">Experimental</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-full sm:max-w-sm"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input aria-label="Buscar FAQs" className="pl-9" placeholder="Buscar pregunta o respuesta…" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
            <p className="text-xs text-muted-foreground">{faqs.filter((faq) => faq.active).length} activas · {faqs.length}/{FAQ_MAX_COUNT} FAQs</p>
        </div>
        {error && <div role="alert" className="flex items-center justify-between gap-3 text-sm text-destructive"><p>{error}</p><Button variant="outline" onClick={() => void load()}>Reintentar</Button></div>}
        {loading ? <p role="status" className="flex gap-2 py-8 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Cargando FAQs…</p> : !visible.length ? <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{query ? "No hay FAQs que coincidan con tu búsqueda." : "Aún no hay correcciones. Entrena tu primera respuesta desde Chats."}</p> : <div className="divide-y rounded-xl border">
            {visible.map((faq) => <article key={faq.id} className="space-y-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="min-w-0 flex-1 break-words text-sm font-semibold">{faq.question}</h3>
                    <div className="flex items-center gap-2">
                        <Label htmlFor={`faq-${faq.id}`} className="text-xs text-muted-foreground">{faq.active ? "Activa" : "Pausada"}</Label><Switch id={`faq-${faq.id}`} checked={faq.active} disabled={busy} onCheckedChange={() => void change(faq)} />
                        <Button size="icon" variant="ghost" aria-label={`Editar FAQ: ${faq.question}`} disabled={busy} onClick={() => setEditing(faq)}><Pencil className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" aria-label={`Eliminar FAQ: ${faq.question}`} disabled={busy} onClick={() => setDeleting(faq)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                </div>
                <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{faq.answer}</p>
            </article>)}
        </div>}
        <p className="text-xs text-muted-foreground">Pausar una FAQ deja de incluirla en las próximas respuestas. Prueba preguntas con otras palabras en Probar agente para evaluar el resultado.</p>
        {editing && <AiTrainingDialog key={editing.id} faq={editing} onClose={() => setEditing(null)} onSaved={() => void load()} />}
        <Dialog open={Boolean(deleting)} onOpenChange={(open) => { if (!open && !busy) setDeleting(null); }}>
            <DialogContent><DialogHeader><DialogTitle>Eliminar FAQ</DialogTitle><DialogDescription>Esta corrección dejará de usarse. El mensaje original del chat se conservará.</DialogDescription></DialogHeader>
                <p className="text-sm">{deleting?.question}</p><DialogFooter><Button variant="outline" disabled={busy} onClick={() => setDeleting(null)}>Cancelar</Button><Button variant="destructive" disabled={busy} onClick={() => { if (deleting) void change(deleting, true); }}>Eliminar FAQ</Button></DialogFooter>
            </DialogContent>
        </Dialog>
    </section>;
}
