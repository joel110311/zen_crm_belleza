"use client";

import { useEffect, useState } from "react";
import { Bot, BrainCircuit, Loader2, Save, SearchCheck, Sparkles } from "lucide-react";
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
import { PhonePrefixInput } from "@/components/shared/phone-prefix-input";
import { getSystemSettings, updateSystemSettings } from "@/app/actions/settings";
import { useToast } from "@/components/ui/use-toast";
import { normalizeChatModelSelection, resolveChatModelSelection, SUPPORTED_CHAT_MODELS } from "@/lib/ai/models";
import {
    BUSINESS_DAY_KEYS,
    BUSINESS_DAY_LABELS,
    formatBusinessScheduleSummary,
    normalizeBusinessHours,
    type BusinessDayKey,
    type BusinessWeeklySchedule,
} from "@/lib/calendar/business-hours";

export default function BrainConfigPage() {
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isBotEnabled, setIsBotEnabled] = useState(false);
    const [botReplyDelayMaxSeconds, setBotReplyDelayMaxSeconds] = useState(8);
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
    const [appointmentDurationMinutes, setAppointmentDurationMinutes] = useState("30");
    const [leadScoringEnabled, setLeadScoringEnabled] = useState(true);
    const [captureLeadName, setCaptureLeadName] = useState(false);
    const [captureLeadEmail, setCaptureLeadEmail] = useState(false);
    const [leadInterestThreshold, setLeadInterestThreshold] = useState([45]);
    const [escalationEnabled, setEscalationEnabled] = useState(false);
    const [escalationPhone, setEscalationPhone] = useState("");
    const { toast } = useToast();

    useEffect(() => {
        const loadSettings = async () => {
            try {
                const settings = await getSystemSettings();
                if (settings) {
                    const businessHours = normalizeBusinessHours(settings);
                    setIsBotEnabled(settings.isBotEnabled);
                    setAgentName(settings.agentName || "Asistente Zen");
                    setAgentPrompt(
                        settings.agentPrompt ||
                            "Eres un asistente comercial y de soporte que responde por WhatsApp desde un CRM. Responde en español, con claridad y sin inventar informacion.",
                    );
                    setWelcomeMessage(
                        settings.welcomeMessage ||
                            "👋 ¡Hola! Gracias por contactarnos.\n\n¿En qué te podemos ayudar hoy?",
                    );
                    setWelcomeRepeatHours(String(settings.welcomeRepeatHours || 24));
                    setBotReplyDelayMaxSeconds(
                        Math.max(8, Math.min(16, Math.round((settings.botReplyDelayMaxMs || 8000) / 1000))),
                    );
                    setOpenaiModel(normalizeChatModelSelection(settings.openaiModel));
                    setKnowledgeTopK(String(settings.knowledgeTopK || 6));
                    setTemperature([settings.agentTemperature || 0.3]);
                    setBusinessTimeZone(businessHours.timeZone || "America/Mexico_City");
                    setBusinessWeeklySchedule(businessHours.weeklySchedule);
                    setAppointmentDurationMinutes(String(settings.appointmentDurationMinutes || 30));
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
    }, []);

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
        setIsSaving(true);
        try {
            const normalizedBusinessHours = normalizeBusinessHours({
                businessTimeZone,
                appointmentDurationMinutes: Number(appointmentDurationMinutes) || 30,
                businessWeeklySchedule,
            });
            const result = await updateSystemSettings({
                isBotEnabled,
                agentName,
                agentPrompt,
                welcomeMessage,
                welcomeRepeatHours: Math.max(1, Number(welcomeRepeatHours) || 24),
                openaiModel,
                knowledgeTopK: Number(knowledgeTopK) || 6,
                agentTemperature: temperature[0] || 0.3,
                autoReplyDelayMs: 4000,
                botReplyDelayMinMs: 4000,
                botReplyDelayMaxMs: botReplyDelayMaxSeconds * 1000,
                businessHoursStart: normalizedBusinessHours.start,
                businessHoursEnd: normalizedBusinessHours.end,
                businessTimeZone: normalizedBusinessHours.timeZone,
                businessWeeklySchedule: normalizedBusinessHours.weeklySchedule,
                appointmentDurationMinutes: Number(appointmentDurationMinutes) || 30,
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

            toast({
                title: "Cerebro actualizado",
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

    if (isLoading) {
        return (
            <div className="flex h-full items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    const selectedModel = resolveChatModelSelection(openaiModel);
    const currentBusinessHours = normalizeBusinessHours({
        businessTimeZone,
        appointmentDurationMinutes: Number(appointmentDurationMinutes) || 30,
        businessWeeklySchedule,
    });
    return (
        <div className="mx-auto flex h-full max-w-[1280px] flex-col gap-4">
            <div className="flex flex-col gap-4 rounded-xl border bg-card px-5 py-4 shadow-[0_12px_28px_-22px_rgba(15,23,42,0.25)] lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-3">
                    <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                        <BrainCircuit className="h-6 w-6" />
                    </div>
                    <div>
                        <h1 className="text-[1.85rem] font-semibold tracking-tight">Cerebro IA</h1>
                        <p className="mt-1 text-sm leading-6 text-muted-foreground">
                            Aqui se concentra la logica del agente, sus fuentes y el contexto que usara para contestar en WhatsApp.
                        </p>
                    </div>
                </div>

                <Button onClick={handleSave} disabled={isSaving} className="h-10 rounded-xl px-4">
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Guardar cambios
                </Button>
            </div>

            <Tabs defaultValue="config" className="flex-1">
                <TabsList className="grid h-auto w-full max-w-[380px] grid-cols-2 gap-2 rounded-xl border bg-card p-1.5 shadow-[0_12px_24px_-20px_rgba(15,23,42,0.22)]">
                    <TabsTrigger value="config" className="min-w-0 h-10 rounded-lg border border-transparent bg-background px-2 text-[13px] font-semibold leading-tight text-foreground/75 data-[state=active]:border-primary/30 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-[0_14px_28px_-18px_rgba(37,99,235,0.72)] sm:h-11 sm:px-4 sm:text-sm">Configuracion</TabsTrigger>
                    <TabsTrigger value="knowledge" className="min-w-0 h-10 rounded-lg border border-transparent bg-background px-2 text-[13px] font-semibold leading-tight text-foreground/75 data-[state=active]:border-primary/30 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-[0_14px_28px_-18px_rgba(37,99,235,0.72)] sm:h-11 sm:px-4 sm:text-sm">Conocimiento</TabsTrigger>
                </TabsList>

                <TabsContent value="config" className="mt-4 space-y-5 sm:mt-5">
                    <Card className="border-primary/20 bg-primary/5">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Bot className="h-5 w-5 text-primary" />
                                Autopiloto del agente
                            </CardTitle>
                            <CardDescription>
                                Activa o pausa las respuestas automaticas. Si esta apagado, el CRM seguira recibiendo mensajes pero no respondera solo.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-4">
                                <div className="flex flex-col gap-3 rounded-xl border bg-background px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                                    <div>
                                        <Label htmlFor="bot-enabled" className="text-base font-medium">Responder automaticamente</Label>
                                        <p className="text-sm text-muted-foreground mt-1">
                                            Usa el historial del contacto y la base de conocimiento antes de responder por WhatsApp.
                                        </p>
                                    </div>
                                    <Switch
                                        id="bot-enabled"
                                        checked={isBotEnabled}
                                        onCheckedChange={setIsBotEnabled}
                                    />
                                </div>

                                <div className="rounded-xl border bg-background px-4 py-4">
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                        <div>
                                            <Label className="text-base font-medium">
                                                Pacing humano del bot
                                            </Label>
                                            <p className="mt-1 text-sm text-muted-foreground">
                                                Despues de preparar la respuesta, el agente espera un tiempo aleatorio antes de enviarla para evitar un patron rigido.
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
                                        Recomendado: 4 a 8 segundos para respuestas normales; usa 4 a 16 segundos si quieres una cadencia mas variable.
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
                                    <Label>Nombre del agente</Label>
                                    <Input value={agentName} onChange={(event) => setAgentName(event.target.value)} />
                                </div>
                                <div className="space-y-2">
                                    <Label>Prompt principal</Label>
                                    <Textarea
                                        value={agentPrompt}
                                        onChange={(event) => setAgentPrompt(event.target.value)}
                                        className="min-h-[220px] font-mono text-sm"
                                        placeholder="Describe tono, objetivos, restricciones y la forma de responder."
                                    />
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <Sparkles className="h-5 w-5 text-primary" />
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
                        </Card>
                    </div>

                    <Card>
                        <CardHeader>
                            <CardTitle>Bienvenida automatica</CardTitle>
                            <CardDescription>
                                Este mensaje lo envia la IA automaticamente. No depende de <span className="font-medium text-foreground">Plantillas</span>, que siguen siendo respuestas rapidas manuales para el inbox.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                            <div className="space-y-2">
                                <Label>Mensaje de bienvenida</Label>
                                <Textarea
                                    value={welcomeMessage}
                                    onChange={(event) => setWelcomeMessage(event.target.value)}
                                    className="min-h-[120px]"
                                    placeholder="👋 ¡Hola! Gracias por contactarnos..."
                                />
                                <p className="text-xs text-muted-foreground">
                                    Si lo dejas vacio, la bienvenida automatica se desactiva.
                                </p>
                            </div>
                            <div className="space-y-2">
                                <Label>Volver a enviar bienvenida despues de</Label>
                                <Input
                                    value={welcomeRepeatHours}
                                    onChange={(event) => setWelcomeRepeatHours(event.target.value)}
                                    inputMode="numeric"
                                    placeholder="24"
                                />
                                <p className="text-xs text-muted-foreground">
                                    Se mide en horas. Ejemplo: 24 = si el cliente vuelve al dia siguiente, recibe bienvenida otra vez.
                                </p>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
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
                                <Switch
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
                    </Card>

                    <Card>
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
                                    <Switch
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
                                            <Checkbox
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
                                            <Checkbox
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
                    </Card>

                    <Card>
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
                                                    <Switch
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
                                    <Label>Zona horaria</Label>
                                    <Input
                                        value={businessTimeZone}
                                        onChange={(event) => setBusinessTimeZone(event.target.value)}
                                        placeholder="America/Mexico_City"
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        Se usa para interpretar frases como &quot;mañana a las 3&quot; y para confirmar la hora exacta de la cita.
                                    </p>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <Label>Duracion por defecto de la cita (minutos)</Label>
                                    <Select value={appointmentDurationMinutes} onValueChange={setAppointmentDurationMinutes}>
                                        <SelectTrigger className="w-full">
                                            <SelectValue placeholder="Selecciona una duracion" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="15">15 minutos</SelectItem>
                                            <SelectItem value="30">30 minutos</SelectItem>
                                            <SelectItem value="45">45 minutos</SelectItem>
                                            <SelectItem value="60">60 minutos</SelectItem>
                                            <SelectItem value="90">90 minutos</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

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
                    </Card>

                </TabsContent>

                <TabsContent value="knowledge" className="mt-4 sm:mt-6">
                    <KnowledgeBase />
                </TabsContent>
            </Tabs>
        </div>
    );
}
