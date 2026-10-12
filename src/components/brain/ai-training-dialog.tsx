"use client";

import { useEffect, useState } from "react";
import { Bot, Loader2 } from "lucide-react";
import { getAiTrainingDraft, saveTrainedFaq } from "@/app/actions/ai-training";
import { FAQ_ANSWER_LIMIT, FAQ_QUESTION_LIMIT, type TrainedFaq } from "@/lib/ai/trained-faq-policy";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";

export function AiTrainingDialog({ messageId, faq, onClose, onSaved }: {
    messageId?: string; faq?: TrainedFaq; onClose: () => void; onSaved?: () => void;
}) {
    const [question, setQuestion] = useState(faq?.question || "");
    const [answer, setAnswer] = useState(faq?.answer || "");
    const [original, setOriginal] = useState("");
    const [loading, setLoading] = useState(Boolean(messageId));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const { toast } = useToast();

    useEffect(() => {
        if (!messageId) return;
        let ignore = false;
        getAiTrainingDraft(messageId).then((draft) => {
            if (ignore) return;
            setQuestion(draft.question);
            setAnswer(draft.answer);
            setOriginal(draft.originalAnswer);
        }).catch((cause) => {
            if (!ignore) setError(cause instanceof Error ? cause.message : "No se pudo cargar la respuesta.");
        }).finally(() => { if (!ignore) setLoading(false); });
        return () => { ignore = true; };
    }, [messageId]);

    async function save() {
        setSaving(true);
        setError("");
        try {
            await saveTrainedFaq({ messageId, faqId: faq?.id, question, answer, active: faq?.active ?? true });
            toast({ title: "FAQ guardada", description: "La IA consultará esta corrección en sus próximas respuestas." });
            onSaved?.();
            onClose();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "No se pudo guardar la corrección.");
        } finally { setSaving(false); }
    }

    return <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
            <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><Bot className="h-5 w-5 text-primary" />Entrenar IA</DialogTitle>
                <DialogDescription>Corrige cómo debe responder a preguntas similares. Se guardará como una FAQ aprobada de tu negocio.</DialogDescription>
            </DialogHeader>
            <span className="w-fit rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">Experimental</span>
            {loading ? <div role="status" className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Cargando pregunta y respuesta…</div> : <>
                <div className="space-y-2">
                    <Label htmlFor="training-question">Pregunta del cliente</Label>
                    <Textarea id="training-question" value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={FAQ_QUESTION_LIMIT} rows={3} disabled={saving} placeholder="Escribe la pregunta que debe reconocer la IA" />
                    <p className="text-xs text-muted-foreground">Puedes reformularla para que también cubra preguntas similares.</p>
                </div>
                <div className="space-y-2">
                    <Label htmlFor="training-answer">Respuesta correcta</Label>
                    <Textarea id="training-answer" value={answer} onChange={(event) => setAnswer(event.target.value)} maxLength={FAQ_ANSWER_LIMIT} rows={7} disabled={saving} placeholder="Así debería contestar la IA" />
                    <p className="text-right text-xs text-muted-foreground">{answer.length.toLocaleString("es-MX")} / {FAQ_ANSWER_LIMIT.toLocaleString("es-MX")}</p>
                </div>
                {original && <details className="rounded-lg border p-3 text-sm">
                    <summary className="cursor-pointer text-muted-foreground">Ver respuesta original</summary>
                    <p className="mt-2 whitespace-pre-wrap">{original}</p>
                </details>}
            </>}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <p className="text-xs text-muted-foreground">Esta corrección no cambia el mensaje enviado ni envía otro al cliente. Administra tus FAQs en Asistente IA → FAQs entrenadas.</p>
            <DialogFooter>
                <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
                <Button onClick={save} disabled={loading || saving || !question.trim() || !answer.trim()}>
                    {saving && <Loader2 className="h-4 w-4 animate-spin" />}{saving ? "Guardando…" : "Guardar entrenamiento"}
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>;
}
