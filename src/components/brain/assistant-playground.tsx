"use client";

import { useState, type FormEvent } from "react";
import { Bot, Database, FlaskConical, Loader2, RotateCcw, Send, ShieldCheck, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";

type PlaygroundMessage = {
    role: "user" | "assistant";
    content: string;
};

type PreviewTrace = {
    model: string;
    structuredSources: string[];
    knowledgeSources: Array<{
        title: string;
        uri: string | null;
    }>;
    operationalActionsExecuted: false;
};

const SAMPLE_MESSAGES = [
    "¿Qué servicios manejan?",
    "¿Cuáles son sus políticas para cancelar una cita?",
    "Quiero agendar una cita para mañana por la tarde",
];

export function AssistantPlayground() {
    const [messages, setMessages] = useState<PlaygroundMessage[]>([]);
    const [draft, setDraft] = useState("");
    const [isSending, setIsSending] = useState(false);
    const [trace, setTrace] = useState<PreviewTrace | null>(null);
    const { toast } = useToast();

    const runPreview = async (rawMessage: string) => {
        const message = rawMessage.trim();
        if (!message || isSending) return;

        const previousMessages = messages.slice(-12);
        setMessages((current) => [...current, { role: "user", content: message }]);
        setDraft("");
        setIsSending(true);

        try {
            const response = await fetch("/api/assistant-preview", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message, history: previousMessages }),
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data?.error || "No se pudo generar la prueba.");
            }

            setMessages((current) => [...current, { role: "assistant", content: data.reply }]);
            setTrace(data.trace);
        } catch (error) {
            toast({
                title: "No se pudo probar el asistente",
                description: error instanceof Error ? error.message : "Ocurrió un error inesperado.",
                variant: "destructive",
            });
        } finally {
            setIsSending(false);
        }
    };

    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        void runPreview(draft);
    };

    const clearConversation = () => {
        setMessages([]);
        setTrace(null);
        setDraft("");
    };

    return (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            <Card className="min-w-0 overflow-hidden">
                <CardHeader className="border-b bg-primary/5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                            <CardTitle className="flex items-center gap-2">
                                <FlaskConical className="h-5 w-5 text-primary" />
                                Probar como cliente
                            </CardTitle>
                            <CardDescription className="mt-1">
                                Usa la configuración guardada y simula una conversación sin contactar a nadie.
                            </CardDescription>
                        </div>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={clearConversation}
                            disabled={messages.length === 0 || isSending}
                            className="rounded-xl"
                        >
                            <RotateCcw className="mr-2 h-4 w-4" />
                            Nueva prueba
                        </Button>
                    </div>
                </CardHeader>

                <CardContent className="p-0">
                    <div className="min-h-[360px] space-y-4 bg-muted/15 p-4 sm:p-5">
                        {messages.length === 0 ? (
                            <div className="flex min-h-[320px] flex-col items-center justify-center text-center">
                                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                                    <Bot className="h-7 w-7" />
                                </span>
                                <p className="mt-4 font-semibold">Inicia una conversación de prueba</p>
                                <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">
                                    Escribe como lo haría un cliente. Puedes continuar con varias preguntas para revisar si el agente conserva el contexto.
                                </p>
                                <div className="mt-5 flex max-w-2xl flex-wrap justify-center gap-2">
                                    {SAMPLE_MESSAGES.map((sample) => (
                                        <button
                                            key={sample}
                                            type="button"
                                            onClick={() => void runPreview(sample)}
                                            className="rounded-full border bg-background px-3 py-2 text-left text-xs font-medium transition hover:border-primary/40 hover:bg-primary/5"
                                        >
                                            {sample}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            messages.map((message, index) => (
                                <div
                                    key={`${message.role}-${index}`}
                                    className={`flex gap-2 ${message.role === "user" ? "justify-end" : "justify-start"}`}
                                >
                                    {message.role === "assistant" ? (
                                        <span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                                            <Bot className="h-4 w-4" />
                                        </span>
                                    ) : null}
                                    <div
                                        className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm ${
                                            message.role === "user"
                                                ? "rounded-br-md bg-primary text-primary-foreground"
                                                : "rounded-bl-md border bg-background text-foreground"
                                        }`}
                                    >
                                        {message.content}
                                    </div>
                                    {message.role === "user" ? (
                                        <span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-background text-muted-foreground">
                                            <UserRound className="h-4 w-4" />
                                        </span>
                                    ) : null}
                                </div>
                            ))
                        )}

                        {isSending ? (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
                                    <Bot className="h-4 w-4" />
                                </span>
                                <span className="flex items-center gap-2 rounded-2xl rounded-bl-md border bg-background px-4 py-3">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Revisando la configuración guardada...
                                </span>
                            </div>
                        ) : null}
                    </div>

                    <form onSubmit={handleSubmit} className="border-t bg-background p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                            <Textarea
                                value={draft}
                                onChange={(event) => setDraft(event.target.value.slice(0, 2000))}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter" && !event.shiftKey) {
                                        event.preventDefault();
                                        if (draft.trim() && !isSending) void runPreview(draft);
                                    }
                                }}
                                rows={2}
                                maxLength={2000}
                                placeholder="Escribe el mensaje del cliente..."
                                className="min-h-20 flex-1 resize-none"
                                disabled={isSending}
                            />
                            <Button type="submit" disabled={!draft.trim() || isSending} className="h-11 rounded-xl px-5">
                                {isSending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                                Probar respuesta
                            </Button>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">
                            Enter para enviar · Shift + Enter para agregar una línea
                        </p>
                    </form>
                </CardContent>
            </Card>

            <div className="space-y-4">
                <Card className="border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/60 dark:bg-emerald-950/20">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                            <ShieldCheck className="h-5 w-5 text-emerald-600" />
                            Prueba sin efectos
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm leading-6 text-muted-foreground">
                        <p>No envía mensajes por WhatsApp.</p>
                        <p>No crea ni modifica clientes.</p>
                        <p>No crea, mueve ni cancela citas.</p>
                        <p>No activa el bot automáticamente.</p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                            <Database className="h-5 w-5 text-primary" />
                            Fuentes disponibles
                        </CardTitle>
                        <CardDescription>
                            Muestra el contexto entregado al modelo en la respuesta más reciente; no afirma qué fragmentos decidió usar.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {trace ? (
                            <>
                                <div>
                                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Configuración estructurada</p>
                                    <div className="flex flex-wrap gap-2">
                                        {trace.structuredSources.map((source) => (
                                            <Badge key={source} variant="secondary">{source}</Badge>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Conocimiento recuperado</p>
                                    {trace.knowledgeSources.length > 0 ? (
                                        <div className="space-y-2">
                                            {trace.knowledgeSources.map((source) => (
                                                <div key={`${source.title}-${source.uri || "local"}`} className="rounded-xl border bg-muted/20 px-3 py-2">
                                                    <p className="text-sm font-medium">{source.title}</p>
                                                    {source.uri ? <p className="mt-1 break-all text-xs text-muted-foreground">{source.uri}</p> : null}
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="rounded-xl border border-dashed px-3 py-3 text-sm text-muted-foreground">No se recuperó una fuente adicional para esa pregunta.</p>
                                    )}
                                </div>
                                <div className="rounded-xl border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                                    Modelo configurado: <span className="font-medium text-foreground">{trace.model}</span>
                                </div>
                            </>
                        ) : (
                            <p className="rounded-xl border border-dashed px-3 py-4 text-sm leading-6 text-muted-foreground">
                                Las fuentes aparecerán después de generar la primera respuesta.
                            </p>
                        )}
                    </CardContent>
                </Card>

                <p className="px-1 text-xs leading-5 text-muted-foreground">
                    Guarda primero cualquier cambio pendiente en Configuración o Mi Negocio; el simulador utiliza únicamente la versión guardada.
                </p>
            </div>
        </div>
    );
}
