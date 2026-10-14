"use client";

import styles from "@/components/shared/management-workspace.module.css";
import { useWorkspaceAccess } from "@/components/layout/workspace-access-context";
import { useSession } from "next-auth/react";
import { hasPermission, type AccessSubject } from "@/lib/permissions";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { Bot, Loader2, MessagesSquare, RotateCcw, Save, SearchCheck, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KnowledgeBase } from "@/components/brain/knowledge-base";
import { AssistantPlayground } from "@/components/brain/assistant-playground";
import { ChatbotUsageCounter } from "@/components/brain/chatbot-usage-counter";
import { TrainedFaqsPanel } from "@/components/brain/trained-faqs-panel";
import { PhonePrefixInput } from "@/components/shared/phone-prefix-input";
import { getSystemSettings, updateSystemSettings } from "@/app/actions/settings";
import { useToast } from "@/components/ui/use-toast";
import { normalizeChatModelSelection, resolveChatModelSelection, SUPPORTED_CHAT_MODELS } from "@/lib/ai/models";
import { DEFAULT_BEAUTY_AGENT_PROMPT } from "@/lib/ai/default-agent-prompt";
import {
    BUSINESS_DAY_KEYS,
    BUSINESS_DAY_LABELS,
    formatBusinessScheduleSummary,
    normalizeBusinessHours,
    type BusinessDayKey,
    type BusinessWeeklySchedule,
} from "@/lib/calendar/business-hours";

type BrainFormState = {
    isBotEnabled: boolean;
    botReplyDelayMaxSeconds: number;
    messageBatchingEnabled: boolean;
    messageBatchWindowMs: string;
    messageBatchMaxWaitMs: string;
    agentName: string;
    agentPrompt: string;
    welcomeMessage: string;
    welcomeRepeatHours: string;
    openaiModel: string;
    knowledgeTopK: string;
    temperature: number;
    businessTimeZone: string;
    businessWeeklySchedule: BusinessWeeklySchedule;
    leadScoringEnabled: boolean;
    captureLeadName: boolean;
    captureLeadEmail: boolean;
    leadInterestThreshold: number;
    escalationEnabled: boolean;
    escalationPhone: string;
};

export default function BrainConfigPage() {
    const { readOnly } = useWorkspaceAccess();
    const { data: session, status } = useSession();
    const hasAccess = hasPermission(session?.user as AccessSubject | undefined, "ai.manage");
    const canWrite = hasAccess && !readOnly;
    const pathname = usePathname();
    const isTenantWorkspace = /^\/t\/[^/]+(?:\/|$)/.test(pathname);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isBotEnabled, setIsBotEnabled] = useState(false);
    const [botReplyDelayMaxSeconds, setBotReplyDelayMaxSeconds] = useState(8);
    const [messageBatchingEnabled, setMessageBatchingEnabled] = useState(true);
    const [messageBatchWindowMs, setMessageBatchWindowMs] = useState("8000");
    const [messageBatchMaxWaitMs, setMessageBatchMaxWaitMs] = useState("30000");
    const [agentName, setAgentName] = useState("Asistente Zen");
    const [agentPrompt, setAgentPrompt] = useState("");
    const [welcomeMessage, setWelcomeMessage] = useState("");
    const [welcomeRepeatHours, setWelcomeRepeatHours] = useState("24");
    const [openaiModel, setOpenaiModel] = useState(normalizeChatModelSelection());
    const [knowledgeTopK, setKnowledgeTopK] = useState("6");
    const [temperature, setTemperature] = useState([0.3]);
    const [businessTimeZone, setBusinessTimeZone] = useState("America/Mexico_City");
    const [businessWeeklySchedule, setBusinessWeeklySchedule] = useState<BusinessWeeklySchedule>(
        () => normalizeBusinessHours().weeklySchedule,
    );
    const [leadScoringEnabled, setLeadScoringEnabled] = useState(true);
    const [captureLeadName, setCaptureLeadName] = useState(false);
    const [captureLeadEmail, setCaptureLeadEmail] = useState(false);
    const [leadInterestThreshold, setLeadInterestThreshold] = useState([45]);
    const [escalationEnabled, setEscalationEnabled] = useState(false);
    const [escalationPhone, setEscalationPhone] = useState("");
    const [savedFormState, setSavedFormState] = useState<BrainFormState | null>(null);
    const { toast } = useToast();

    const currentFormState = useMemo<BrainFormState>(() => ({
        isBotEnabled,
        botReplyDelayMaxSeconds,
        messageBatchingEnabled,
        messageBatchWindowMs,
        messageBatchMaxWaitMs,
        agentName,
        agentPrompt,
        welcomeMessage,
        welcomeRepeatHours,
        openaiModel,
        knowledgeTopK,
        temperature: temperature[0] ?? 0.3,
        businessTimeZone,
        businessWeeklySchedule,
        leadScoringEnabled,
        captureLeadName,
        captureLeadEmail,
        leadInterestThreshold: leadInterestThreshold[0] ?? 45,
        escalationEnabled,
        escalationPhone,
    }), [
        agentName,
        agentPrompt,
        botReplyDelayMaxSeconds,
        businessTimeZone,
        businessWeeklySchedule,
        captureLeadEmail,
        captureLeadName,
        escalationEnabled,
        escalationPhone,
        isBotEnabled,
        knowledgeTopK,
        leadInterestThreshold,
        leadScoringEnabled,
        messageBatchMaxWaitMs,
        messageBatchWindowMs,
        messageBatchingEnabled,
        openaiModel,
        temperature,
        welcomeMessage,
        welcomeRepeatHours,
    ]);

    const isDirty = savedFormState !== null
        && JSON.stringify(currentFormState) !== JSON.stringify(savedFormState);

    useEffect(() => {
        if (status === "loading" || !hasAccess) return;
        const loadSettings = async () => {
            try {
                const settings = await getSystemSettings();
                if (settings) {
                    const businessHours = normalizeBusinessHours(settings);
                    setIsBotEnabled(settings.isBotEnabled);
                    setAgentName(settings.agentName || "Asistente Zen");
                    setAgentPrompt(
                        settings.agentPrompt || DEFAULT_BEAUTY_AGENT_PROMPT,
                    );
                    setWelcomeMessage(
                        settings.welcomeMessage ||
                            "👋 ¡Hola! Gracias por contactarnos.\n\n¿En qué te podemos ayudar hoy?",
                    );
                    setWelcomeRepeatHours(String(settings.welcomeRepeatHours || 24));
                    setBotReplyDelayMaxSeconds(
                        Math.max(8, Math.min(16, Math.round((settings.botReplyDelayMaxMs || 8000) / 1000))),
                    );
                    setMessageBatchingEnabled(settings.messageBatchingEnabled ?? true);
                    setMessageBatchWindowMs(String(settings.messageBatchWindowMs || 8000));
                    setMessageBatchMaxWaitMs(String(settings.messageBatchMaxWaitMs || 30000));
                    setOpenaiModel(normalizeChatModelSelection(settings.openaiModel));
                    setKnowledgeTopK(String(settings.knowledgeTopK || 6));
                    setTemperature([settings.agentTemperature || 0.3]);
                    setBusinessTimeZone(businessHours.timeZone || "America/Mexico_City");
                    setBusinessWeeklySchedule(businessHours.weeklySchedule);
                    setLeadScoringEnabled(settings.leadScoringEnabled ?? true);
                    setCaptureLeadName(settings.captureLeadName ?? false);
                    setCaptureLeadEmail(settings.captureLeadEmail ?? false);
                    setLeadInterestThreshold([settings.leadInterestThreshold || 45]);
                    setEscalationEnabled(settings.escalationEnabled ?? false);
                    setEscalationPhone(settings.escalationPhone || "");
                }
            } catch (error) {
                console.error("Failed to load brain settings:", error);
            } finally {
                setIsLoading(false);
            }
        };

        loadSettings();
    }, [status, hasAccess]);

    useEffect(() => {
        if (!isLoading && savedFormState === null) {
            setSavedFormState(currentFormState);
        }
    }, [currentFormState, isLoading, savedFormState]);

    useEffect(() => {
        if (!isDirty) return;

        const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            event.returnValue = "";
        };

        window.addEventListener("beforeunload", warnBeforeLeaving);
        return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
    }, [isDirty]);

    const updateBusinessDay = (
        dayKey: BusinessDayKey,
        patch: Partial<BusinessWeeklySchedule[BusinessDayKey]>,
    ) => {
        setBusinessWeeklySchedule((current) => ({
            ...current,
            [dayKey]: {
                ...current[dayKey],
                ...patch,
            },
        }));
    };

    const handleSave = async () => {
        if (!canWrite || isSaving) return;
        const formStateBeingSaved = currentFormState;
        setIsSaving(true);
        try {
            const normalizedBusinessHours = normalizeBusinessHours({
                businessTimeZone,
                businessWeeklySchedule,
            });
            const result = await updateSystemSettings({
                isBotEnabled,
                agentName,
                agentPrompt,
                welcomeMessage,
                welcomeRepeatHours: Math.max(1, Number(welcomeRepeatHours) || 24),
                ...(!isTenantWorkspace ? { openaiModel } : {}),
                knowledgeTopK: Number(knowledgeTopK) || 6,
                agentTemperature: temperature[0] || 0.3,
                autoReplyDelayMs: 4000,
                botReplyDelayMinMs: 4000,
                botReplyDelayMaxMs: botReplyDelayMaxSeconds * 1000,
                messageBatchingEnabled,
                messageBatchWindowMs: Math.max(1000, Math.min(30000, Number(messageBatchWindowMs) || 8000)),
                messageBatchMaxWaitMs: Math.max(
                    Number(messageBatchWindowMs) || 8000,
                    Math.min(120000, Number(messageBatchMaxWaitMs) || 30000),
                ),
                businessHoursStart: normalizedBusinessHours.start,
                businessHoursEnd: normalizedBusinessHours.end,
                businessTimeZone: normalizedBusinessHours.timeZone,
                businessWeeklySchedule: normalizedBusinessHours.weeklySchedule,
                leadScoringEnabled,
                captureLeadName,
                captureLeadEmail,
                leadInterestThreshold: leadInterestThreshold[0] || 45,
                escalationEnabled,
                escalationPhone,
                catalogOfferImages: false,
                catalogOfferPdf: false,
                catalogAskBeforeSending: false,
                catalogMaxImagesToSend: 1,
                catalogIncludeLink: false,
            });

            if (!result.success) {
                throw new Error(result.error);
            }

            setSavedFormState(formStateBeingSaved);

            toast({
                title: "Asistente IA actualizado",
                description: "El agente ya usara esta configuracion en WhatsApp.",
            });
        } catch (error) {
            toast({
                title: "No se pudo guardar",
                description: error instanceof Error ? error.message : "Fallo al guardar la configuracion",
                variant: "destructive",
            });
        } finally {
            setIsSaving(false);
        }
    };

    const handleCancelChanges = () => {
        if (!savedFormState || isSaving) return;

        setIsBotEnabled(savedFormState.isBotEnabled);
        setBotReplyDelayMaxSeconds(savedFormState.botReplyDelayMaxSeconds);
        setMessageBatchingEnabled(savedFormState.messageBatchingEnabled);
        setMessageBatchWindowMs(savedFormState.messageBatchWindowMs);
        setMessageBatchMaxWaitMs(savedFormState.messageBatchMaxWaitMs);
        setAgentName(savedFormState.agentName);
        setAgentPrompt(savedFormState.agentPrompt);
        setWelcomeMessage(savedFormState.welcomeMessage);
        setWelcomeRepeatHours(savedFormState.welcomeRepeatHours);
        setOpenaiModel(savedFormState.openaiModel);
        setKnowledgeTopK(savedFormState.knowledgeTopK);
        setTemperature([savedFormState.temperature]);
        setBusinessTimeZone(savedFormState.businessTimeZone);
        setBusinessWeeklySchedule(normalizeBusinessHours({
            businessTimeZone: savedFormState.businessTimeZone,
            businessWeeklySchedule: savedFormState.businessWeeklySchedule,
        }).weeklySchedule);
        setLeadScoringEnabled(savedFormState.leadScoringEnabled);
        setCaptureLeadName(savedFormState.captureLeadName);
        setCaptureLeadEmail(savedFormState.captureLeadEmail);
        setLeadInterestThreshold([savedFormState.leadInterestThreshold]);
        setEscalationEnabled(savedFormState.escalationEnabled);
        setEscalationPhone(savedFormState.escalationPhone);
    };

    if (status !== "loading" && !hasAccess) return <div className={styles.workspace}><div className={styles.heading}><h1>Asistente IA</h1></div><p className={styles.readonly}>Tu rol no tiene permiso para gestionar el asistente.</p></div>;

    if (isLoading || status === "loading") {
        return (
            <div className="flex h-full items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    const selectedModel = resolveChatModelSelection(openaiModel);
    const currentBusinessHours = normalizeBusinessHours({
        businessTimeZone,
        businessWeeklySchedule,
    });
    return (
        <div className={`${styles.workspace} ${isDirty ? "pb-40" : ""}`} data-management-workspace="brain">
            <div className={styles.heading}>
                <div><h1><Bot className="size-6 text-primary" aria-hidden="true" />Asistente IA</h1>
                <p>Define cómo responde, corrige sus respuestas y prueba antes de activar.</p></div>
                <div className="rounded-lg border bg-card px-3 py-2"><ChatbotUsageCounter /></div>
            </div>
            {readOnly && <p className={styles.readonly}>Solo lectura: puedes consultar tu configuración, FAQs y fuentes. Reactiva tu plan para modificar el asistente.</p>}
            <Tabs defaultValue="config" className="flex-1">
                <TabsList className={styles.tabs}>
                    <TabsTrigger value="config" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Ajustes</TabsTrigger>
                    <TabsTrigger value="knowledge" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Fuentes</TabsTrigger>
                    <TabsTrigger value="test" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Probar</TabsTrigger>
                    <TabsTrigger value="trained-faqs" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">FAQs</TabsTrigger>
                </TabsList>

                <TabsContent value="config" className="mt-0"><fieldset disabled={!canWrite || isSaving} className={styles.config} aria-label="Configuración del asistente">
                    <Card className="border-primary/20 bg-primary/5">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Bot className="h-5 w-5 text-primary" />
                                Autopiloto del agente
                            </CardTitle>
                            <CardDescription>
                                Activa las respuestas automáticas o deja la atención a tu equipo.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-4">
                                <div className="flex flex-col gap-3 rounded-xl border bg-background px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                                    <div>
                                        <Label htmlFor="bot-enabled" className="text-base font-medium">Responder automaticamente</Label>
                                        <p className="text-sm text-muted-foreground mt-1">
                                            Consulta las FAQs, el historial y tus fuentes antes de responder.
                                        </p>

                                    </div>
                                    <Switch disabled={!canWrite || isSaving}
                                        id="bot-enabled"
                                        checked={isBotEnabled}
                                        onCheckedChange={setIsBotEnabled}
                                    />
                                </div>

                                <div className="rounded-xl border bg-background px-4 py-4">
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                        <div>
                                            <Label className="text-base font-medium">
                                                Tiempo de respuesta
                                            </Label>
                                            <p className="mt-1 text-sm text-muted-foreground">
                                                Pausa entre 4 segundos y el máximo elegido antes de enviar.
                                            </p>
                                        </div>
                                        <span className="rounded-full border px-3 py-1 text-sm font-semibold text-foreground">
                                            4 a {botReplyDelayMaxSeconds} s
                                        </span>
                                    </div>

                                    <div className="mt-5 flex flex-wrap gap-2">
                                        {[8, 12, 16].map((maxSeconds) => (
                                            <Button
                                                key={maxSeconds}
                                                type="button"
                                                variant={
                                                    botReplyDelayMaxSeconds === maxSeconds
                                                        ? "default"
                                                        : "outline"
                                                }
                                                size="sm"
                                                onClick={() => setBotReplyDelayMaxSeconds(maxSeconds)}
                                            >
                                                4 a {maxSeconds}s
                                            </Button>
                                        ))}
                                    </div>

                                    <p className="mt-4 text-xs text-muted-foreground">
                                        Recomendado: de 4 a 8 segundos.
                                    </p>
                                </div>

                                <div className="rounded-xl border bg-background px-4 py-4">
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                        <div>
                                            <Label htmlFor="message-batching-enabled" className="flex items-center gap-2 text-base font-medium">
                                                <MessagesSquare className="h-4 w-4 text-primary" />
                                                Agrupar mensajes consecutivos
                                            </Label>
                                            <p className="mt-1 text-sm text-muted-foreground">
                                                Espera a que el cliente termine de escribir y contesta en una sola respuesta.
                                            </p>
                                        </div>
                                        <Switch disabled={!canWrite || isSaving}
                                            id="message-batching-enabled"
                                            checked={messageBatchingEnabled}
                                            onCheckedChange={setMessageBatchingEnabled}
                                        />
                                    </div>

                                    <div className="mt-5 grid gap-4 sm:grid-cols-2">
                                        <div className="space-y-2">
                                            <Label>Espera desde el ultimo mensaje</Label>
                                            <Select value={messageBatchWindowMs} onValueChange={setMessageBatchWindowMs}>
                                                <SelectTrigger><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="5000">5 segundos</SelectItem>
                                                    <SelectItem value="8000">8 segundos</SelectItem>
                                                    <SelectItem value="12000">12 segundos</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Espera maxima del bloque</Label>
                                            <Select value={messageBatchMaxWaitMs} onValueChange={setMessageBatchMaxWaitMs}>
                                                <SelectTrigger><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="20000">20 segundos</SelectItem>
                                                    <SelectItem value="30000">30 segundos</SelectItem>
                                                    <SelectItem value="60000">60 segundos</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>
                                    <p className="mt-4 text-xs text-muted-foreground">
                                        Configuracion recomendada: 8 segundos entre mensajes y un maximo de 30 segundos desde el primero.
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <div className="grid gap-5 lg:grid-cols-2">
                        <Card>
                            <CardHeader>
                                <CardTitle>Identidad del agente</CardTitle>
                                <CardDescription>Define como se presenta y como debe razonar antes de contestar.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="agent-name">Nombre del agente</Label>
                                    <Input id="agent-name" value={agentName} onChange={(event) => setAgentName(event.target.value)} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="agent-prompt">Personalidad e instrucciones adicionales</Label>
                                    <Textarea
                                        id="agent-prompt" value={agentPrompt}
                                        onChange={(event) => setAgentPrompt(event.target.value)}
                                        className="min-h-[180px] text-sm"
                                        placeholder="Opcional: indica el tono, forma de hablar o reglas especiales de atención."
                                    />
                                    <p className="text-xs leading-5 text-muted-foreground">
                                        No necesitas pegar aquí el catálogo, precios, duración, horarios ni profesionales. El asistente los obtiene automáticamente de Mi Negocio y Servicios.
                                    </p>
                                </div>
                            </CardContent>
                        </Card>

                        {!isTenantWorkspace ? <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <SlidersHorizontal className="h-5 w-5 text-primary" />
                                    Parametros del modelo
                                </CardTitle>
                                <CardDescription>Ajusta cuanto contexto recuperar y que tan creativo sera el agente.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                <div className="space-y-2">
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                        <Label>LLM principal</Label>
                                        <span className="rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                                            {selectedModel.provider}
                                        </span>
                                    </div>
                                    <Select value={openaiModel} onValueChange={setOpenaiModel}>
                                        <SelectTrigger className="w-full">
                                            <SelectValue placeholder="Selecciona un modelo" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {SUPPORTED_CHAT_MODELS.map((option) => (
                                                <SelectItem key={option.id} value={option.id}>
                                                    {option.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <p className="text-xs text-muted-foreground">
                                        {selectedModel.description || "Modelo recomendado para las respuestas del agente."}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        OpenAI y Gemini ya pueden usarse para las respuestas del bot. La base de conocimiento y la transcripcion siguen aprovechando OpenAI cuando hace falta.
                                    </p>
                                </div>

                                <div className="space-y-2">
                                    <Label className="flex items-center gap-2">
                                        <SearchCheck className="h-4 w-4 text-primary" />
                                        Documentos a recuperar por consulta
                                    </Label>
                                    <Input
                                        value={knowledgeTopK}
                                        onChange={(event) => setKnowledgeTopK(event.target.value)}
                                        inputMode="numeric"
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        Cuantos chunks relevantes consultara antes de generar la respuesta.
                                    </p>
                                </div>

                                <div className="space-y-4">
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                        <Label>Temperatura</Label>
                                        <span className="text-sm text-muted-foreground">{temperature[0].toFixed(1)}</span>
                                    </div>
                                    <Slider
                                        value={temperature}
                                        onValueChange={setTemperature}
                                        min={0}
                                        max={1}
                                        step={0.1}
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        Baja para respuestas mas sobrias y repetibles. Sube si quieres un estilo mas flexible.
                                    </p>
                                </div>
                            </CardContent>
                        </Card> : null}
                    </div>

                    <details className={styles.section}><summary>Bienvenida automática</summary><Card className="border-0">
                        <CardHeader>
                            <CardTitle>Bienvenida automatica</CardTitle>
                            <CardDescription>
                                Saludo automático al iniciar una conversación. Las respuestas guardadas de Plantillas se envían manualmente desde Chats.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                            <div className="space-y-2">
                                <Label htmlFor="welcome-message">Mensaje de bienvenida</Label>
                                <Textarea
                                    id="welcome-message" value={welcomeMessage}
                                    onChange={(event) => setWelcomeMessage(event.target.value)}
                                    className="min-h-[120px]"
                                    placeholder="👋 ¡Hola! Gracias por contactarnos..."
                                />
                                <p className="text-xs text-muted-foreground">
                                    Si lo dejas vacio, la bienvenida automatica se desactiva.
                                </p>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="welcome-repeat">Volver a enviar bienvenida despues de</Label>
                                <Input
                                    id="welcome-repeat" value={welcomeRepeatHours}
                                    onChange={(event) => setWelcomeRepeatHours(event.target.value)}
                                    inputMode="numeric"
                                    placeholder="24"
                                />
                                <p className="text-xs text-muted-foreground">
                                    Se mide en horas. Ejemplo: 24 = si el cliente vuelve al dia siguiente, recibe bienvenida otra vez.
                                </p>
                            </div>
                        </CardContent>
                    </Card></details>

                    <details className={styles.section}><summary>Atención humana</summary><Card className="border-0">
                        <CardHeader>
                            <CardTitle>Escalacion humana</CardTitle>
                            <CardDescription>
                                Si la IA no encuentra una respuesta confiable, pausara el bot en esa conversacion y notificara por WhatsApp al numero configurado para que una persona continue la atencion.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex flex-col gap-3 rounded-xl border bg-background px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                                <div className="pr-4">
                                    <Label htmlFor="escalation-enabled" className="text-base font-medium">
                                        Activar escalacion automatica
                                    </Label>
                                    <p className="mt-1 text-sm text-muted-foreground">
                                        Se activa cuando el bot responde que no tiene informacion fiable o suficiente para contestar con seguridad.
                                    </p>
                                </div>
                                <Switch disabled={!canWrite || isSaving}
                                    id="escalation-enabled"
                                    checked={escalationEnabled}
                                    onCheckedChange={setEscalationEnabled}
                                />
                            </div>

                            <div className="space-y-2">
                                <Label>Numero de WhatsApp para escalar</Label>
                                <PhonePrefixInput
                                    value={escalationPhone}
                                    onChange={setEscalationPhone}
                                    placeholder="Numero local"
                                />
                                <p className="text-xs text-muted-foreground">
                                    Usa el numero que recibira la alerta interna. El prefijo se toma del pais de operacion por defecto.
                                </p>
                            </div>
                        </CardContent>
                    </Card></details>

                    <details className={styles.section}><summary>Seguimiento de clientes</summary><Card className="border-0">
                        <CardHeader>
                            <CardTitle>Scoring y captura del lead</CardTitle>
                            <CardDescription>
                                Detecta interés real durante la conversación, mueve el lead a <span className="font-medium text-foreground">Calificado</span> y pide los datos uno por uno cuando haga sentido.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
                            <div className="space-y-4">
                                <div className="flex flex-col gap-3 rounded-xl border bg-background px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="pr-4">
                                        <Label htmlFor="lead-scoring-enabled" className="text-base font-medium">
                                            Activar scoring automático
                                        </Label>
                                        <p className="mt-1 text-sm text-muted-foreground">
                                            El bot calcula interés con los mensajes del mismo día. Al cruzar el umbral mueve el lead a <span className="font-medium text-foreground">Calificado</span>.
                                        </p>
                                    </div>
                                    <Switch disabled={!canWrite || isSaving}
                                        id="lead-scoring-enabled"
                                        checked={leadScoringEnabled}
                                        onCheckedChange={setLeadScoringEnabled}
                                    />
                                </div>

                                <div className="rounded-xl border bg-background px-4 py-4">
                                    <div className="space-y-1">
                                        <Label className="text-base font-medium">Datos opcionales a solicitar</Label>
                                        <p className="text-sm text-muted-foreground">
                                            Si activas ambos, el agente los pedirá de forma orgánica uno por uno: primero el nombre y después el correo.
                                        </p>
                                    </div>

                                    <div className="mt-4 space-y-3">
                                        <label className="flex items-start gap-3 rounded-xl border border-border/60 bg-muted/20 px-3 py-3 transition-colors hover:bg-muted/35">
                                            <Checkbox disabled={!canWrite || isSaving}
                                                checked={captureLeadName}
                                                onCheckedChange={(checked) => setCaptureLeadName(Boolean(checked))}
                                                className="mt-0.5"
                                            />
                                            <div className="space-y-1">
                                                <span className="text-sm font-medium leading-none">Pedir nombre del cliente</span>
                                                <p className="text-xs text-muted-foreground">
                                                    Aunque WhatsApp traiga un nombre de perfil, el bot lo tratará como provisional y pedirá el nombre real.
                                                </p>
                                            </div>
                                        </label>

                                        <label className="flex items-start gap-3 rounded-xl border border-border/60 bg-muted/20 px-3 py-3 transition-colors hover:bg-muted/35">
                                            <Checkbox disabled={!canWrite || isSaving}
                                                checked={captureLeadEmail}
                                                onCheckedChange={(checked) => setCaptureLeadEmail(Boolean(checked))}
                                                className="mt-0.5"
                                            />
                                            <div className="space-y-1">
                                                <span className="text-sm font-medium leading-none">Pedir correo electrónico</span>
                                                <p className="text-xs text-muted-foreground">
                                                    Sirve para dar seguimiento comercial, compartir propuestas o agendar con mejor contexto.
                                                </p>
                                            </div>
                                        </label>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="rounded-xl border bg-background px-4 py-4">
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                        <Label>Umbral de interés</Label>
                                        <span className="text-sm font-semibold text-foreground">{leadInterestThreshold[0]}%</span>
                                    </div>
                                    <div className="mt-4">
                                        <Slider
                                            value={leadInterestThreshold}
                                            onValueChange={setLeadInterestThreshold}
                                            min={30}
                                            max={80}
                                            step={5}
                                            disabled={!leadScoringEnabled}
                                        />
                                    </div>
                                    <p className="mt-3 text-xs text-muted-foreground">
                                        Con el valor actual, normalmente se activa después de <span className="font-medium text-foreground">3 mensajes del cliente en el mismo día</span>, o antes si detecta señales fuertes como precio, cita, demo o intención de compra.
                                    </p>
                                </div>

                                <div className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground space-y-2">
                                    <p className="font-medium text-foreground">Qué hará automáticamente el CRM</p>
                                    <p>Actualizará la puntuación y el paso comercial del lead.</p>
                                    <p>Cuando detecte interés real, moverá el lead a la etapa <span className="font-medium text-foreground">Calificado</span>.</p>
                                    <p>Si el cliente comparte nombre o correo, los guardará en silencio y lo verás reflejado en inbox y pipeline.</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card></details>

                    <details className={styles.section}><summary>Horarios y agenda</summary><Card className="border-0">
                        <CardHeader>
                            <CardTitle>Agenda y horario comercial</CardTitle>
                            <CardDescription>
                                Este horario lo usa el bot para agendar citas y tambien define el rango visible en el calendario semanal y diario.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
                            <div className="space-y-4">
                                <div className="space-y-3">
                                    {BUSINESS_DAY_KEYS.map((dayKey) => {
                                        const daySchedule = businessWeeklySchedule[dayKey];

                                        return (
                                            <div
                                                data-business-day
                                                key={dayKey}
                                                className="grid gap-3 rounded-xl border bg-background px-4 py-4 sm:grid-cols-[170px_1fr_1fr] sm:items-center"
                                            >
                                                <div className="flex items-center justify-between gap-3 sm:justify-start">
                                                    <div>
                                                        <p className="text-sm font-medium text-foreground">{BUSINESS_DAY_LABELS[dayKey]}</p>
                                                        <p className="text-xs text-muted-foreground">
                                                            {daySchedule.enabled ? "Abierto" : "Cerrado"}
                                                        </p>
                                                    </div>
                                                    <Switch disabled={!canWrite || isSaving}
                                                        checked={daySchedule.enabled}
                                                        onCheckedChange={(checked) =>
                                                            updateBusinessDay(dayKey, { enabled: checked })
                                                        }
                                                    />
                                                </div>

                                                <div className="space-y-2">
                                                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                                                        Abre
                                                    </Label>
                                                    <Input
                                                        type="time"
                                                        value={daySchedule.start}
                                                        disabled={!daySchedule.enabled}
                                                        onChange={(event) =>
                                                            updateBusinessDay(dayKey, { start: event.target.value })
                                                        }
                                                    />
                                                </div>

                                                <div className="space-y-2">
                                                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                                                        Cierra
                                                    </Label>
                                                    <Input
                                                        type="time"
                                                        value={daySchedule.end}
                                                        disabled={!daySchedule.enabled}
                                                        onChange={(event) =>
                                                            updateBusinessDay(dayKey, { end: event.target.value })
                                                        }
                                                    />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="business-time-zone">Zona horaria</Label>
                                    <Input
                                        id="business-time-zone" value={businessTimeZone}
                                        onChange={(event) => setBusinessTimeZone(event.target.value)}
                                        placeholder="America/Mexico_City"
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        Se usa para interpretar frases como &quot;mañana a las 3&quot; y para confirmar la hora exacta de la cita.
                                    </p>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="rounded-xl border bg-background px-4 py-4 text-sm text-muted-foreground space-y-2">
                                    <p className="font-medium text-foreground">Resumen actual</p>
                                    <p>{formatBusinessScheduleSummary(currentBusinessHours)}</p>
                                </div>

                                <div className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground space-y-2">
                                    <p className="font-medium text-foreground">Como impacta esta configuracion</p>
                                    <p>El bot solo propondra citas dentro del horario del dia correspondiente.</p>
                                    <p>Si el sabado cierra antes o el domingo esta cerrado, la agenda lo respetara automaticamente.</p>
                                    <p>Las vistas semanal y diaria del calendario se ajustaran usando estos horarios.</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card></details>

                    </fieldset>
                </TabsContent>

                <TabsContent value="knowledge" className="mt-4 sm:mt-6">
                    <KnowledgeBase />
                </TabsContent>

                <TabsContent value="test" className="mt-4 sm:mt-6">
                    <AssistantPlayground />
                </TabsContent>
                <TabsContent value="trained-faqs" className="mt-4 sm:mt-6"><TrainedFaqsPanel /></TabsContent>
            </Tabs>

            {isDirty && canWrite && (
                <div
                    role="region"
                    aria-label="Cambios pendientes"
                    className={styles.saveBar}
                >
                    <div className="hidden min-w-0 sm:block">
                        <p className="font-semibold text-foreground">Tienes cambios sin guardar</p>
                        <p className="text-xs text-muted-foreground">Guárdalos o vuelve a la última configuración.</p>
                    </div>
                    <div className="flex w-full items-center gap-2 sm:w-auto">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={handleCancelChanges}
                            disabled={isSaving || !canWrite}
                            className="flex-1 sm:flex-none"
                        >
                            <RotateCcw className="h-4 w-4" />
                            Cancelar
                        </Button>
                        <Button
                            type="button"
                            onClick={handleSave}
                            disabled={isSaving || !canWrite}
                            className="flex-1 sm:flex-none"
                        >
                            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                            Guardar cambios
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
