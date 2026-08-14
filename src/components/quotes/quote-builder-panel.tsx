"use client";

/* eslint-disable @next/next/no-img-element */

import { ChangeEvent, useCallback, useMemo, useRef, useState } from "react";
import {
    Building2,
    Check,
    Copy,
    FolderOpen,
    Palette,
    Plus,
    ReceiptText,
    Send,
    Trash2,
    Upload,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PhonePrefixInput } from "@/components/shared/phone-prefix-input";
import { useOperationContext } from "@/components/shared/use-operation-context";
import { buildOperationContext, formatPhoneForDisplay } from "@/lib/operation-context";
import { formatDateInOperationZone, formatTimeInOperationZone } from "@/lib/operation-dates";
import { cn } from "@/lib/utils";

type QuoteTemplateId = "corporate" | "executive" | "visual";
type QuoteOutputFormat = "image" | "pdf";

type QuoteItem = {
    id: string;
    concept: string;
    description: string;
    quantity: number;
    unitPrice: number;
};

type OptionalFlags = {
    companyName: boolean;
    clientCompany: boolean;
    iva: boolean;
    notes: boolean;
    contactPhone: boolean;
    website: boolean;
    social: boolean;
    address: boolean;
};

type QuoteVariableValues = {
    nombre: string;
    empresa: string;
    telefono: string;
    agente: string;
    cantidad: string;
    fecha: string;
    ciudad: string;
};

type SavedQuoteDraft = {
    selectedTemplate?: QuoteTemplateId | "minimal";
    logoUrl?: string | null;
    logoName?: string | null;
    logoScale?: number;
    companyName?: string;
    validUntil?: string;
    clientName?: string;
    clientPhone?: string;
    clientCompany?: string;
    variableValues?: QuoteVariableValues;
    optionalFlags?: OptionalFlags;
    ivaPercent?: number;
    notes?: string;
    contactPhone?: string;
    website?: string;
    social?: string;
    address?: string;
    items?: QuoteItem[];
    savedAt?: string;
};

type QuoteBuilderPanelProps = {
    initialContact?: {
        name?: string | null;
        phone?: string | null;
        company?: string | null;
    };
    agentName?: string | null;
    mode?: "full" | "compact";
    onGenerate?: (asset: GeneratedQuoteAsset) => void | Promise<void>;
};

export type GeneratedQuoteAsset = {
    blob: Blob;
    fileName: string;
    mimeType: string;
    mediaCategory: "image" | "document";
    previewUrl?: string;
    caption: string;
};

const QUOTE_DRAFT_STORAGE_KEY = "zen-crm-quote-draft";
const FALLBACK_QUOTE_OPERATION = buildOperationContext();

const QUOTE_VARIABLES: Array<{ key: keyof QuoteVariableValues | "piezas" | "total" | "subtotal" | "iva" | "vigencia"; label: string; description: string }> = [
    { key: "nombre", label: "{{nombre}}", description: "Nombre del contacto" },
    { key: "empresa", label: "{{empresa}}", description: "Empresa del contacto" },
    { key: "telefono", label: "{{telefono}}", description: "Telefono del contacto" },
    { key: "agente", label: "{{agente}}", description: "Usuario que atiende" },
    { key: "cantidad", label: "{{cantidad}}", description: "Cantidad capturada" },
    { key: "piezas", label: "{{piezas}}", description: "Alias de cantidad" },
    { key: "fecha", label: "{{fecha}}", description: "Fecha o mes del evento" },
    { key: "ciudad", label: "{{ciudad}}", description: "Ciudad del cliente" },
    { key: "subtotal", label: "{{subtotal}}", description: "Subtotal calculado" },
    { key: "iva", label: "{{iva}}", description: "IVA calculado" },
    { key: "total", label: "{{total}}", description: "Total calculado" },
    { key: "vigencia", label: "{{vigencia}}", description: "Vigencia de la cotizacion" },
];

const QUOTE_TEMPLATES: Array<{
    id: QuoteTemplateId;
    name: string;
    description: string;
    accent: string;
    dark: string;
    soft: string;
    paperClassName: string;
}> = [
    {
        id: "corporate",
        name: "Corporativa",
        description: "Limpia, formal y parecida a una factura ejecutiva.",
        accent: "#169bd5",
        dark: "#171717",
        soft: "#e0f2fe",
        paperClassName: "bg-white text-slate-950",
    },
    {
        id: "executive",
        name: "Ejecutiva roja",
        description: "Contraste fuerte, ideal para propuestas formales.",
        accent: "#ef233c",
        dark: "#1f2933",
        soft: "#fff1f2",
        paperClassName: "bg-white text-slate-950",
    },
    {
        id: "visual",
        name: "Consultoria premium",
        description: "Limpia, profesional y estilo propuesta corporativa.",
        accent: "#155f9f",
        dark: "#111827",
        soft: "#f8fafc",
        paperClassName: "bg-white text-slate-950",
    },
];

const DEFAULT_FLAGS: OptionalFlags = {
    companyName: true,
    clientCompany: false,
    iva: false,
    notes: true,
    contactPhone: true,
    website: false,
    social: false,
    address: false,
};

const DEFAULT_ITEMS: QuoteItem[] = [
    {
        id: "item-1",
        concept: "Producto o servicio",
        description: "Descripcion breve del alcance o beneficio.",
        quantity: 1,
        unitPrice: 0,
    },
];

function formatCurrency(
    value: number,
    currency = FALLBACK_QUOTE_OPERATION.defaultCurrency,
    locale = FALLBACK_QUOTE_OPERATION.locale,
) {
    return new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        maximumFractionDigits: 2,
    }).format(Number.isFinite(value) ? value : 0);
}

function createLocalImageUrl(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return null;

    return new Promise<{ url: string; name: string }>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve({ url: String(reader.result || ""), name: file.name });
        reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
        reader.readAsDataURL(file);
    });
}

function normalizeVariableKey(key: string) {
    return key
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
}

function safeNumber(value: number) {
    return Number.isFinite(value) ? value : 0;
}

function formatClientPhoneForQuote(value: string | null | undefined, defaultCountryCode?: string | null) {
    const rawValue = (value || "").trim();
    if (!rawValue) return "";

    return formatPhoneForDisplay(rawValue, defaultCountryCode) || rawValue;
}

export function QuoteBuilderPanel({ initialContact, agentName, mode = "full", onGenerate }: QuoteBuilderPanelProps) {
    const operationContext = useOperationContext();
    const isCompact = mode === "compact";
    const quotePageRef = useRef<HTMLDivElement | null>(null);
    const [selectedTemplate, setSelectedTemplate] = useState<QuoteTemplateId>("corporate");
    const [outputFormat, setOutputFormat] = useState<QuoteOutputFormat>("pdf");
    const [logoUrl, setLogoUrl] = useState<string | null>(null);
    const [logoName, setLogoName] = useState<string | null>(null);
    const [logoScale, setLogoScale] = useState(100);
    const [companyName, setCompanyName] = useState("Tu empresa");
    const [validUntil, setValidUntil] = useState("7 dias");
    const [clientName, setClientName] = useState("{{nombre}}");
    const [clientPhone, setClientPhone] = useState("{{telefono}}");
    const [clientCompany, setClientCompany] = useState("{{empresa}}");
    const [optionalFlags, setOptionalFlags] = useState<OptionalFlags>(DEFAULT_FLAGS);
    const [ivaPercent, setIvaPercent] = useState(16);
    const [notes, setNotes] = useState("Precios sujetos a disponibilidad. Esta cotizacion puede ajustarse segun alcance final.");
    const [contactPhone, setContactPhone] = useState("");
    const [website, setWebsite] = useState("");
    const [social, setSocial] = useState("");
    const [address, setAddress] = useState("");
    const [items, setItems] = useState<QuoteItem[]>(DEFAULT_ITEMS);
    const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
    const [lastGeneratedAt, setLastGeneratedAt] = useState<string | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [variableValues, setVariableValues] = useState<QuoteVariableValues>({
        nombre: initialContact?.name || "",
        empresa: initialContact?.company || "",
        telefono: initialContact?.phone || "",
        agente: agentName || "",
        cantidad: "",
        fecha: "",
        ciudad: "",
    });

    const template = QUOTE_TEMPLATES.find((entry) => entry.id === selectedTemplate) || QUOTE_TEMPLATES[0];
    const subtotal = useMemo(
        () => items.reduce((sum, item) => sum + Math.max(0, safeNumber(item.quantity)) * Math.max(0, safeNumber(item.unitPrice)), 0),
        [items],
    );
    const ivaAmount = optionalFlags.iva ? subtotal * Math.max(0, ivaPercent) / 100 : 0;
    const total = subtotal + ivaAmount;
    const quoteCurrency = operationContext.defaultCurrency;
    const quoteLocale = operationContext.locale;
    const formatQuoteCurrency = useCallback(
        (value: number) => formatCurrency(value, quoteCurrency, quoteLocale),
        [quoteCurrency, quoteLocale],
    );

    const renderedVariables = useMemo(() => {
        const quantityValue = variableValues.cantidad || String(items[0]?.quantity || "");
        return {
            nombre: variableValues.nombre || initialContact?.name || "",
            empresa: variableValues.empresa || initialContact?.company || "",
            telefono: variableValues.telefono || initialContact?.phone || "",
            agente: variableValues.agente || agentName || "",
            cantidad: quantityValue,
            piezas: quantityValue,
            fecha: variableValues.fecha,
            ciudad: variableValues.ciudad,
            subtotal: formatQuoteCurrency(subtotal),
            iva: formatQuoteCurrency(ivaAmount),
            total: formatQuoteCurrency(total),
            vigencia: validUntil,
        };
    }, [
        agentName,
        initialContact?.company,
        initialContact?.name,
        initialContact?.phone,
        items,
        ivaAmount,
        formatQuoteCurrency,
        subtotal,
        total,
        validUntil,
        variableValues,
    ]);

    const renderText = (text: string | null | undefined) =>
        (text || "").replace(/\{\{\s*([^}]+?)\s*\}\}/g, (match, key: string) => {
            const normalized = normalizeVariableKey(key);
            return renderedVariables[normalized as keyof typeof renderedVariables] || match;
        });

    const updateItem = (itemId: string, patch: Partial<QuoteItem>) => {
        setItems((current) =>
            current.map((item) => (item.id === itemId ? { ...item, ...patch } : item)),
        );
    };

    const addItem = () => {
        setItems((current) => [
            ...current,
            {
                id: `item-${Date.now()}`,
                concept: "Nuevo concepto",
                description: "Descripcion breve.",
                quantity: 1,
                unitPrice: 0,
            },
        ]);
    };

    const removeItem = (itemId: string) => {
        setItems((current) => current.length > 1 ? current.filter((item) => item.id !== itemId) : current);
    };

    const toggleOptional = (key: keyof OptionalFlags) => {
        setOptionalFlags((current) => ({ ...current, [key]: !current[key] }));
    };

    const updateVariable = (key: keyof QuoteVariableValues, value: string) => {
        setVariableValues((current) => ({ ...current, [key]: value }));
    };

    const copyVariable = async (label: string) => {
        await navigator.clipboard.writeText(label);
    };

    const buildGeneratedQuoteText = () => {
        const renderedClientPhone = formatClientPhoneForQuote(renderText(clientPhone), operationContext.phoneDefaultCountry);
        const lines = [
            "*Cotizacion*",
            optionalFlags.companyName && renderText(companyName)
                ? `Empresa emisora: ${renderText(companyName)}`
                : null,
            `Cliente: ${renderText(clientName) || "Sin nombre"}`,
            renderedClientPhone ? `Telefono: ${renderedClientPhone}` : null,
            optionalFlags.clientCompany && renderText(clientCompany)
                ? `Empresa: ${renderText(clientCompany)}`
                : null,
            "",
            ...items.map((item) => {
                const quantity = safeNumber(item.quantity);
                const unitPrice = safeNumber(item.unitPrice);
                return `- ${renderText(item.concept)}: ${quantity} x ${formatQuoteCurrency(unitPrice)} = ${formatQuoteCurrency(quantity * unitPrice)}`;
            }),
            "",
            `Subtotal: ${formatQuoteCurrency(subtotal)}`,
            optionalFlags.iva ? `IVA (${ivaPercent}%): ${formatQuoteCurrency(ivaAmount)}` : null,
            `*Total: ${formatQuoteCurrency(total)}*`,
            `Vigencia: ${renderText(validUntil)}`,
            optionalFlags.notes && renderText(notes) ? `Notas: ${renderText(notes)}` : null,
        ];

        return lines.filter(Boolean).join("\n");
    };

    const copyQuoteSummary = async () => {
        await navigator.clipboard.writeText(buildGeneratedQuoteText());
    };

    const createQuoteAsset = async (): Promise<GeneratedQuoteAsset> => {
        if (!quotePageRef.current) {
            throw new Error("No se encontro la vista previa de la cotizacion.");
        }

        const { toPng } = await import("html-to-image");
        const pngDataUrl = await toPng(quotePageRef.current, {
            cacheBust: true,
            pixelRatio: 2,
            backgroundColor: "#ffffff",
        });

        const clientLabel = (renderText(clientName) || "cliente")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]+/gi, "-")
            .replace(/^-+|-+$/g, "")
            .toLowerCase()
            .slice(0, 42) || "cliente";
        const caption = "Te comparto la cotizacion.";

        if (outputFormat === "image") {
            const blob = await (await fetch(pngDataUrl)).blob();
            return {
                blob,
                fileName: `cotizacion-${clientLabel}.png`,
                mimeType: "image/png",
                mediaCategory: "image",
                previewUrl: pngDataUrl,
                caption,
            };
        }

        const { jsPDF } = await import("jspdf");
        const pdf = new jsPDF({
            orientation: "portrait",
            unit: "pt",
            format: "letter",
            compress: true,
        });
        pdf.addImage(pngDataUrl, "PNG", 0, 0, 612, 792, undefined, "FAST");

        return {
            blob: pdf.output("blob"),
            fileName: `cotizacion-${clientLabel}.pdf`,
            mimeType: "application/pdf",
            mediaCategory: "document",
            caption,
        };
    };

    const downloadAsset = (asset: GeneratedQuoteAsset) => {
        const url = URL.createObjectURL(asset.blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = asset.fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    };

    const generateQuote = async () => {
        setIsGenerating(true);
        try {
            const asset = await createQuoteAsset();
            setLastGeneratedAt(formatTimeInOperationZone(new Date(), operationContext.locale, operationContext.timeZone));
            if (onGenerate) {
                await onGenerate(asset);
                return;
            }
            downloadAsset(asset);
        } finally {
            setIsGenerating(false);
        }
    };

    const saveDraftLocally = () => {
        const savedAt = formatTimeInOperationZone(new Date(), operationContext.locale, operationContext.timeZone);
        window.localStorage.setItem(
            QUOTE_DRAFT_STORAGE_KEY,
            JSON.stringify({
                selectedTemplate,
                logoUrl,
                logoName,
                logoScale,
                companyName,
                validUntil,
                clientName,
                clientPhone,
                clientCompany,
                variableValues,
                optionalFlags,
                ivaPercent,
                notes,
                contactPhone,
                website,
                social,
                address,
                items,
                savedAt,
            }),
        );
        setLastSavedAt(savedAt);
    };

    const loadDraftLocally = () => {
        const rawDraft = window.localStorage.getItem(QUOTE_DRAFT_STORAGE_KEY);
        if (!rawDraft) return;

        const draft = JSON.parse(rawDraft) as SavedQuoteDraft;
        if (draft.selectedTemplate) {
            setSelectedTemplate(draft.selectedTemplate === "minimal" ? "corporate" : draft.selectedTemplate);
        }
        setLogoUrl(draft.logoUrl || null);
        setLogoName(draft.logoName || null);
        setLogoScale(Math.min(125, Math.max(75, draft.logoScale || 100)));
        setCompanyName(draft.companyName || "Tu empresa");
        setValidUntil(draft.validUntil || "7 dias");
        setClientName(draft.clientName || "{{nombre}}");
        setClientPhone(draft.clientPhone || "{{telefono}}");
        setClientCompany(draft.clientCompany || "{{empresa}}");
        setVariableValues({
            nombre: draft.variableValues?.nombre || initialContact?.name || "",
            empresa: draft.variableValues?.empresa || initialContact?.company || "",
            telefono: draft.variableValues?.telefono || initialContact?.phone || "",
            agente: draft.variableValues?.agente || agentName || "",
            cantidad: draft.variableValues?.cantidad || "",
            fecha: draft.variableValues?.fecha || "",
            ciudad: draft.variableValues?.ciudad || "",
        });
        setOptionalFlags({ ...DEFAULT_FLAGS, ...(draft.optionalFlags || {}) });
        setIvaPercent(draft.ivaPercent ?? 16);
        setNotes(draft.notes || "");
        setContactPhone(draft.contactPhone || "");
        setWebsite(draft.website || "");
        setSocial(draft.social || "");
        setAddress(draft.address || "");
        setItems(draft.items?.length ? draft.items : DEFAULT_ITEMS);
        setLastSavedAt(draft.savedAt || null);
    };

    const optionalToggle = (key: keyof OptionalFlags, label: string) => (
        <button
            type="button"
            onClick={() => toggleOptional(key)}
            className={cn(
                "flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition",
                optionalFlags[key]
                    ? "border-primary/50 bg-primary/10 text-primary"
                    : "border-border bg-card text-muted-foreground hover:border-primary/35 hover:text-foreground",
            )}
        >
            <Checkbox
                checked={optionalFlags[key]}
                onClick={(event) => event.stopPropagation()}
                onCheckedChange={(checked) => setOptionalFlags((current) => ({ ...current, [key]: Boolean(checked) }))}
            />
            <span>{label}</span>
        </button>
    );

    const pageBackground = "#ffffff";

    const footerItems = [
        optionalFlags.contactPhone && contactPhone ? `Telefono: ${renderText(contactPhone)}` : null,
        optionalFlags.website && website ? `Sitio web: ${renderText(website)}` : null,
        optionalFlags.social && social ? `Redes: ${renderText(social)}` : null,
        optionalFlags.address && address ? `Direccion: ${renderText(address)}` : null,
    ].filter((item): item is string => Boolean(item));
    const displayedClientPhone = formatClientPhoneForQuote(renderText(clientPhone), operationContext.phoneDefaultCountry);
    const quoteDateLabel = renderedVariables.fecha || formatDateInOperationZone(new Date(), quoteLocale, operationContext.timeZone, {
        day: "2-digit",
        month: "long",
        year: "numeric",
    });
    const companyLabel = renderText(companyName) || "Nombre de la empresa";

    return (
        <div className={cn("space-y-4", isCompact && "max-h-[78vh] overflow-y-auto pr-1")}>
            <div className={cn(
                "overflow-hidden rounded-2xl border bg-card shadow-[0_22px_50px_-38px_rgba(15,23,42,0.45)]",
                isCompact && "rounded-xl shadow-none",
            )}>
                <div className="flex flex-col gap-4 border-b border-border/60 bg-gradient-to-r from-primary/10 via-background to-card px-5 py-5 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex items-center gap-2.5">
                        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/12 text-primary">
                            <ReceiptText className="h-5 w-5" />
                        </span>
                        <div>
                            <h2 className="text-xl font-semibold tracking-tight">Cotizador visual</h2>
                            <p className="text-sm text-muted-foreground">
                                Hoja tamaño carta con variables listas para enviar desde el chat.
                            </p>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <Button variant="outline" className="rounded-2xl" onClick={copyQuoteSummary}>
                            <Copy className="h-4 w-4" />
                            Copiar
                        </Button>
                        <Button variant="outline" className="rounded-2xl" onClick={loadDraftLocally}>
                            <FolderOpen className="h-4 w-4" />
                            Cargar
                        </Button>
                        <Button variant="outline" className="rounded-2xl" onClick={saveDraftLocally}>
                            Guardar plantilla
                        </Button>
                        <Select value={outputFormat} onValueChange={(value) => setOutputFormat(value as QuoteOutputFormat)}>
                            <SelectTrigger className="h-10 w-[8.5rem] rounded-2xl bg-background">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="pdf">PDF</SelectItem>
                                <SelectItem value="image">Imagen</SelectItem>
                            </SelectContent>
                        </Select>
                        <Button className="rounded-2xl shadow-[0_18px_34px_-22px_rgba(37,99,235,0.8)]" onClick={() => void generateQuote()} disabled={isGenerating}>
                            {onGenerate ? <Send className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                            {isGenerating ? "Generando..." : onGenerate ? "Generar para chat" : "Generar"}
                        </Button>
                    </div>
                    {lastSavedAt || lastGeneratedAt ? (
                        <p className="text-xs text-muted-foreground lg:text-right">
                            {lastGeneratedAt ? `Generada a las ${lastGeneratedAt}.` : `Plantilla guardada a las ${lastSavedAt}.`}
                        </p>
                    ) : null}
                </div>

                <div className={cn(
                    "grid gap-0",
                    isCompact ? "xl:grid-cols-[minmax(26rem,0.95fr)_minmax(30rem,1fr)]" : "xl:grid-cols-[minmax(0,1fr)_minmax(34rem,0.92fr)]",
                )}>
                    <div className="space-y-5 border-b border-border/60 p-5 xl:border-b-0 xl:border-r">
                        <section className="space-y-3">
                            <div className="flex items-center gap-2">
                                <Palette className="h-4 w-4 text-primary" />
                                <h3 className="font-semibold">Plantilla visual</h3>
                            </div>
                            <div className="grid gap-3 md:grid-cols-3">
                                {QUOTE_TEMPLATES.map((entry) => (
                                    <button
                                        key={entry.id}
                                        type="button"
                                        onClick={() => setSelectedTemplate(entry.id)}
                                        className={cn(
                                            "rounded-2xl border bg-background p-3 text-left transition hover:-translate-y-0.5 hover:shadow-[0_18px_34px_-28px_rgba(15,23,42,0.55)]",
                                            selectedTemplate === entry.id && "border-primary/70 ring-2 ring-primary/15",
                                        )}
                                    >
                                        <div
                                            className="mb-3 h-16 rounded-xl"
                                            style={{ background: `linear-gradient(135deg, ${entry.dark}, ${entry.accent})` }}
                                        />
                                        <p className="font-semibold">{entry.name}</p>
                                        <p className="mt-1 text-xs leading-5 text-muted-foreground">{entry.description}</p>
                                    </button>
                                ))}
                            </div>
                        </section>

                        <section className="grid gap-4 rounded-2xl border bg-background/70 p-4 md:grid-cols-2">
                            <div className="space-y-2">
                                <Label>Subir logo</Label>
                                <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-border bg-card p-3 transition hover:border-primary/50">
                                    <span className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl bg-primary/10 text-primary">
                                        {logoUrl ? (
                                            <img src={logoUrl} alt="Logo" className="h-full w-full object-cover" />
                                        ) : (
                                            <Upload className="h-5 w-5" />
                                        )}
                                    </span>
                                    <span className="min-w-0">
                                        <span className="block text-sm font-medium">Logo de la empresa</span>
                                        <span className="block truncate text-xs text-muted-foreground">{logoName || "PNG, JPG o WEBP"}</span>
                                    </span>
                                    <input
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={async (event) => {
                                            const input = event.currentTarget;
                                            const image = await createLocalImageUrl(event);
                                            input.value = "";
                                            if (!image) return;
                                            setLogoUrl(image.url);
                                            setLogoName(image.name);
                                        }}
                                    />
                                </label>
                                <div className="space-y-2 rounded-xl bg-muted/35 px-3 py-2">
                                    <div className="flex items-center justify-between gap-3 text-xs">
                                        <span className="font-medium text-muted-foreground">Tamaño del logo</span>
                                        <span className="rounded-full bg-background px-2 py-0.5 font-semibold text-foreground">{logoScale}%</span>
                                    </div>
                                    <input
                                        type="range"
                                        min={75}
                                        max={125}
                                        step={5}
                                        value={logoScale}
                                        onChange={(event) => setLogoScale(Number(event.target.value))}
                                        className="w-full accent-primary"
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <div className="flex items-center justify-between gap-3">
                                    <Label>Nombre de la empresa</Label>
                                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <Checkbox
                                            checked={optionalFlags.companyName}
                                            onCheckedChange={(checked) => setOptionalFlags((current) => ({ ...current, companyName: Boolean(checked) }))}
                                        />
                                        Mostrar
                                    </label>
                                </div>
                                <Input
                                    value={companyName}
                                    onChange={(event) => setCompanyName(event.target.value)}
                                    disabled={!optionalFlags.companyName}
                                    className={!optionalFlags.companyName ? "opacity-60" : undefined}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Vigencia</Label>
                                <Input value={validUntil} onChange={(event) => setValidUntil(event.target.value)} placeholder="Ej. 7 dias" />
                            </div>
                            <div className="space-y-2">
                                <Label>Cliente {"{{nombre}}"}</Label>
                                <Input value={clientName} onChange={(event) => setClientName(event.target.value)} />
                            </div>
                            <div className="space-y-2 md:col-span-2">
                                <Label>Telefono {"{{telefono}}"}</Label>
                                <Input value={clientPhone} onChange={(event) => setClientPhone(event.target.value)} />
                            </div>
                        </section>

                        <section className="space-y-3 rounded-2xl border bg-background/70 p-4">
                            <div>
                                <h3 className="font-semibold">Opcionales</h3>
                                <p className="text-sm text-muted-foreground">Activa solo los campos que quieras mostrar en la cotizacion.</p>
                            </div>
                            <div className="grid gap-2 md:grid-cols-3">
                                {optionalToggle("clientCompany", "Empresa del cliente")}
                                {optionalToggle("iva", "IVA")}
                                {optionalToggle("notes", "Notas y condiciones")}
                            </div>

                            {optionalFlags.clientCompany ? (
                                <div className="space-y-2">
                                    <Label>Empresa del cliente</Label>
                                    <Input value={clientCompany} onChange={(event) => setClientCompany(event.target.value)} />
                                </div>
                            ) : null}
                            {optionalFlags.iva ? (
                                <div className="space-y-2">
                                    <Label>IVA (%)</Label>
                                    <Input type="number" min={0} value={ivaPercent} onChange={(event) => setIvaPercent(Number(event.target.value))} />
                                </div>
                            ) : null}
                            {optionalFlags.notes ? (
                                <div className="space-y-2">
                                    <Label>Notas y condiciones</Label>
                                    <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} className="min-h-20" />
                                </div>
                            ) : null}
                        </section>

                        <section className="space-y-4 rounded-2xl border bg-background/70 p-4">
                            <div>
                                <h3 className="font-semibold">Variables disponibles</h3>
                                <p className="text-sm text-muted-foreground">
                                    Se reemplazan automaticamente. Puedes usarlas en cliente, conceptos y notas.
                                </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {QUOTE_VARIABLES.map((variable) => (
                                    <button
                                        key={variable.key}
                                        type="button"
                                        onClick={() => void copyVariable(variable.label)}
                                        className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition hover:border-primary/50 hover:text-primary"
                                        title={`Copiar ${variable.description}`}
                                    >
                                        {variable.label}
                                    </button>
                                ))}
                            </div>
                            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                                <div className="space-y-1.5">
                                    <Label>{"{{nombre}}"}</Label>
                                    <Input value={variableValues.nombre} onChange={(event) => updateVariable("nombre", event.target.value)} />
                                </div>
                                <div className="space-y-1.5">
                                    <Label>{"{{empresa}}"}</Label>
                                    <Input value={variableValues.empresa} onChange={(event) => updateVariable("empresa", event.target.value)} />
                                </div>
                                <div className="space-y-1.5">
                                    <Label>{"{{telefono}}"}</Label>
                                    <PhonePrefixInput
                                        value={variableValues.telefono}
                                        onChange={(value) => updateVariable("telefono", value)}
                                        defaultCountry={operationContext.phoneDefaultCountry}
                                        placeholder="Telefono del contacto"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label>{"{{cantidad}}"}</Label>
                                    <Input value={variableValues.cantidad} onChange={(event) => updateVariable("cantidad", event.target.value)} placeholder="Ej. 140 piezas" />
                                </div>
                                <div className="space-y-1.5">
                                    <Label>{"{{fecha}}"}</Label>
                                    <Input value={variableValues.fecha} onChange={(event) => updateVariable("fecha", event.target.value)} placeholder="Ej. 04 de Junio 2026" />
                                </div>
                                <div className="space-y-1.5">
                                    <Label>{"{{ciudad}}"}</Label>
                                    <Input value={variableValues.ciudad} onChange={(event) => updateVariable("ciudad", event.target.value)} />
                                </div>
                            </div>
                        </section>

                        <section className="space-y-3 rounded-2xl border bg-background/70 p-4">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <h3 className="font-semibold">Conceptos</h3>
                                    <p className="text-sm text-muted-foreground">Agrega productos o servicios a cotizar.</p>
                                </div>
                                <Button variant="outline" size="sm" className="rounded-xl" onClick={addItem}>
                                    <Plus className="h-4 w-4" />
                                    Concepto
                                </Button>
                            </div>
                            <div className="space-y-2">
                                {items.map((item) => (
                                    <div key={item.id} className="grid gap-2 rounded-2xl border bg-card p-3 md:grid-cols-[1fr_6rem_9rem_2.5rem]">
                                        <div className="space-y-2">
                                            <Input
                                                value={item.concept}
                                                onChange={(event) => updateItem(item.id, { concept: event.target.value })}
                                                placeholder="Concepto"
                                            />
                                            <Input
                                                value={item.description}
                                                onChange={(event) => updateItem(item.id, { description: event.target.value })}
                                                placeholder="Descripcion breve"
                                            />
                                        </div>
                                        <Input
                                            type="number"
                                            min={0}
                                            value={item.quantity}
                                            onChange={(event) => updateItem(item.id, { quantity: Number(event.target.value) })}
                                            placeholder="Cant."
                                        />
                                        <Input
                                            type="number"
                                            min={0}
                                            value={item.unitPrice}
                                            onChange={(event) => updateItem(item.id, { unitPrice: Number(event.target.value) })}
                                            placeholder="Precio"
                                        />
                                        <Button variant="ghost" size="icon" className="rounded-xl text-destructive" onClick={() => removeItem(item.id)}>
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        </section>

                        <section className="space-y-3 rounded-2xl border bg-background/70 p-4">
                            <div>
                                <h3 className="font-semibold">Datos de contacto al pie</h3>
                                <p className="text-sm text-muted-foreground">Todos son opcionales y aparecen al final de la hoja.</p>
                            </div>
                            <div className="grid gap-2 md:grid-cols-2">
                                {optionalToggle("contactPhone", "Telefono")}
                                {optionalToggle("website", "Sitio Web")}
                                {optionalToggle("social", "Redes Sociales")}
                                {optionalToggle("address", "Direccion")}
                            </div>
                            <div className="grid gap-3 md:grid-cols-2">
                                {optionalFlags.contactPhone ? (
                                    <div className="space-y-2">
                                        <Label>Telefono</Label>
                                        <PhonePrefixInput
                                            value={contactPhone}
                                            onChange={setContactPhone}
                                            defaultCountry={operationContext.phoneDefaultCountry}
                                            placeholder="Telefono de contacto"
                                        />
                                    </div>
                                ) : null}
                                {optionalFlags.website ? (
                                    <div className="space-y-2">
                                        <Label>Sitio Web</Label>
                                        <Input value={website} onChange={(event) => setWebsite(event.target.value)} />
                                    </div>
                                ) : null}
                                {optionalFlags.social ? (
                                    <div className="space-y-2">
                                        <Label>Redes Sociales</Label>
                                        <Input value={social} onChange={(event) => setSocial(event.target.value)} />
                                    </div>
                                ) : null}
                                {optionalFlags.address ? (
                                    <div className="space-y-2">
                                        <Label>Direccion</Label>
                                        <Input value={address} onChange={(event) => setAddress(event.target.value)} />
                                    </div>
                                ) : null}
                            </div>
                        </section>
                    </div>

                    <div className="bg-[radial-gradient(circle_at_top,rgba(37,99,235,0.12),transparent_34%),linear-gradient(180deg,rgba(248,250,252,0.9),rgba(241,245,249,0.55))] p-5">
                        <div className="sticky top-4 space-y-4">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <h3 className="font-semibold">Vista previa premium</h3>
                                    <p className="text-sm text-muted-foreground">Hoja fija tamaño carta. No se deforma.</p>
                                </div>
                                <Badge className="rounded-full bg-primary/10 text-primary hover:bg-primary/10">
                                    {template.name}
                                </Badge>
                            </div>

                            <div className="mx-auto w-full max-w-[38rem]">
                                <div
                                    ref={quotePageRef}
                                    className={cn(
                                        "relative overflow-hidden border bg-white shadow-[0_30px_70px_-44px_rgba(15,23,42,0.6)]",
                                        template.paperClassName,
                                    )}
                                    style={{ aspectRatio: "8.5 / 11", background: pageBackground }}
                                >
                                    <div className="absolute inset-0 pointer-events-none">
                                        {selectedTemplate === "corporate" ? (
                                            <>
                                                <div className="absolute bottom-0 left-0 h-5 w-[36%]" style={{ backgroundColor: template.accent }} />
                                                <div className="absolute bottom-0 left-[34%] h-5 w-[66%]" style={{ backgroundColor: template.dark }} />
                                                <div className="absolute bottom-0 left-[31%] h-5 w-12 skew-x-[36deg]" style={{ backgroundColor: template.accent }} />
                                            </>
                                        ) : selectedTemplate === "executive" ? (
                                            <>
                                                <div
                                                    className="absolute -right-20 top-8 h-20 w-[24rem] skew-x-[-28deg]"
                                                    style={{ backgroundColor: template.dark }}
                                                />
                                                <div
                                                    className="absolute right-16 top-6 h-24 w-32 skew-x-[-28deg]"
                                                    style={{ backgroundColor: template.accent }}
                                                />
                                                <div
                                                    className="absolute -bottom-20 -right-16 h-36 w-32 rotate-45"
                                                    style={{ backgroundColor: template.dark }}
                                                />
                                                <div
                                                    className="absolute bottom-12 right-28 h-16 w-14 rotate-45"
                                                    style={{ backgroundColor: template.accent }}
                                                />
                                            </>
                                        ) : null}
                                    </div>

                                    {selectedTemplate === "visual" ? (
                                    <div
                                        className="relative flex h-full flex-col px-[5.4%] py-[5.8%] text-slate-900"
                                        style={{ fontFamily: "Montserrat, Avenir Next, Segoe UI, Arial, sans-serif" }}
                                    >
                                        <header className="grid grid-cols-[1fr_1fr] items-start gap-8">
                                            <div>
                                                <div className="flex h-24 w-48 items-center justify-start overflow-visible bg-transparent text-slate-700">
                                                    {logoUrl ? (
                                                        <img
                                                            src={logoUrl}
                                                            alt="Logo"
                                                            className="max-h-full max-w-full object-contain"
                                                            style={{ transform: `scale(${logoScale / 100})`, transformOrigin: "left center" }}
                                                        />
                                                    ) : (
                                                        <div
                                                            className="flex items-center gap-2 text-2xl font-black tracking-[0.14em]"
                                                            style={{ transform: `scale(${logoScale / 100})`, transformOrigin: "left center" }}
                                                        >
                                                            <Building2 className="h-7 w-7" style={{ color: template.accent }} />
                                                            LOGO
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <h2 className="text-[2.35rem] font-black uppercase leading-none tracking-[0.08em]" style={{ color: template.dark }}>
                                                    Cotizacion
                                                </h2>
                                                <p className="mt-3 text-sm font-bold text-slate-500">
                                                    Fecha: <span className="text-slate-600">{quoteDateLabel}</span>
                                                </p>
                                            </div>
                                        </header>

                                        <div className="mt-7 h-px w-full bg-slate-200" />

                                        <section className="grid grid-cols-2 gap-10 py-5 text-sm">
                                            <div className="space-y-1.5">
                                                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">De:</p>
                                                {optionalFlags.companyName ? (
                                                    <p className="text-base font-black leading-tight text-slate-700">{companyLabel}</p>
                                                ) : null}
                                                {footerItems.length > 0 ? (
                                                    <div className="space-y-1 text-slate-500">
                                                        {footerItems.map((item) => <p key={item}>{item.replace(/^(Telefono|Sitio web|Redes|Direccion):\s*/i, "")}</p>)}
                                                    </div>
                                                ) : null}
                                            </div>
                                            <div className="space-y-1.5 text-right">
                                                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Cotizado para:</p>
                                                <p className="text-base font-black leading-tight text-slate-900">{renderText(clientName) || "Cliente"}</p>
                                                {optionalFlags.clientCompany && renderText(clientCompany) ? (
                                                    <p className="font-semibold text-slate-500">{renderText(clientCompany)}</p>
                                                ) : null}
                                                {displayedClientPhone ? (
                                                    <p className="text-slate-500">{displayedClientPhone}</p>
                                                ) : null}
                                                {renderedVariables.ciudad ? (
                                                    <p className="text-slate-500">{renderedVariables.ciudad}</p>
                                                ) : null}
                                            </div>
                                        </section>

                                        <section className="mt-4">
                                            <div className="grid grid-cols-[1fr_4.5rem_8rem_8rem] border-b border-slate-200 pb-2 text-[0.7rem] font-black uppercase tracking-[0.08em] text-slate-400">
                                                <div>Descripcion</div>
                                                <div className="text-right">Cant.</div>
                                                <div className="text-right">Precio unitario</div>
                                                <div className="text-right">Total</div>
                                            </div>
                                            {items.map((item) => {
                                                const quantity = safeNumber(item.quantity);
                                                const unitPrice = safeNumber(item.unitPrice);
                                                return (
                                                    <div key={item.id} className="grid grid-cols-[1fr_4.5rem_8rem_8rem] border-b border-slate-100 py-3 text-sm">
                                                        <div className="pr-4">
                                                            <p className="font-semibold leading-tight text-slate-900">{renderText(item.concept) || "Concepto"}</p>
                                                            {renderText(item.description) ? (
                                                                <p className="mt-1 text-xs leading-4 text-slate-500">{renderText(item.description)}</p>
                                                            ) : null}
                                                        </div>
                                                        <div className="text-right font-semibold">{quantity}</div>
                                                        <div className="text-right">{formatQuoteCurrency(unitPrice)}</div>
                                                        <div className="text-right font-black">{formatQuoteCurrency(quantity * unitPrice)}</div>
                                                    </div>
                                                );
                                            })}
                                        </section>

                                        <section className="ml-auto mt-5 w-[17rem] space-y-2 text-sm">
                                            <div className="flex justify-between text-slate-600">
                                                <span>Subtotal</span>
                                                <span>{formatQuoteCurrency(subtotal)}</span>
                                            </div>
                                            {optionalFlags.iva ? (
                                                <div className="flex justify-between text-slate-600">
                                                    <span>IVA {ivaPercent}%</span>
                                                    <span>{formatQuoteCurrency(ivaAmount)}</span>
                                                </div>
                                            ) : null}
                                            <div className="h-px bg-slate-900" />
                                            <div className="flex justify-between text-lg font-black uppercase text-slate-950">
                                                <span>Total</span>
                                                <span>{formatQuoteCurrency(total)}</span>
                                            </div>
                                        </section>

                                        <div className="mt-auto border-t border-slate-100 pt-5">
                                            <div className="grid grid-cols-[1.2fr_0.8fr] gap-10">
                                                <div className="space-y-3 text-xs leading-5 text-slate-600">
                                                    {optionalFlags.notes && renderText(notes) ? (
                                                        <div>
                                                            <p className="font-black uppercase tracking-[0.08em] text-slate-400">Terminos y notas</p>
                                                            <p className="mt-1 whitespace-pre-line">{renderText(notes)}</p>
                                                        </div>
                                                    ) : null}
                                                    <div>
                                                        <p className="font-black uppercase tracking-[0.08em] text-slate-400">Vigencia</p>
                                                        <p className="mt-1">{renderText(validUntil) || "Por definir"}</p>
                                                    </div>
                                                </div>
                                                <div className="self-end pb-2 text-center text-xs text-slate-500">
                                                    <div className="mx-auto mb-3 h-px w-48 bg-slate-400" />
                                                    <p className="font-black text-slate-800">{renderedVariables.agente || companyLabel}</p>
                                                    <p>Responsable de la cotizacion</p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    ) : (
                                    <div className="relative flex h-full flex-col p-[6%]">
                                        <header className={cn(
                                            "grid items-start gap-5 border-b pb-5",
                                            selectedTemplate === "corporate" ? "grid-cols-[1fr_1.45fr]" : "grid-cols-[1fr_1.3fr]",
                                        )}>
                                            <div>
                                                <div className="flex h-20 w-44 items-center justify-center overflow-visible bg-transparent text-slate-700">
                                                    {logoUrl ? (
                                                        <img
                                                            src={logoUrl}
                                                            alt="Logo"
                                                            className="max-h-full max-w-full object-contain"
                                                            style={{ transform: `scale(${logoScale / 100})` }}
                                                        />
                                                    ) : (
                                                        <div
                                                            className="flex items-center gap-2 text-2xl font-black tracking-wider"
                                                            style={{ transform: `scale(${logoScale / 100})` }}
                                                        >
                                                            <Building2 className="h-7 w-7" />
                                                            LOGO
                                                        </div>
                                                    )}
                                                </div>
                                                {optionalFlags.companyName ? (
                                                    <div className="mt-3 max-w-56">
                                                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Empresa</p>
                                                        <p className="mt-1 text-base font-black leading-tight text-slate-900">
                                                            {renderText(companyName) || "Nombre de la empresa"}
                                                        </p>
                                                    </div>
                                                ) : null}
                                            </div>
                                            <div className={cn("text-right", selectedTemplate === "corporate" ? "pt-1" : "pt-5")}>
                                                {selectedTemplate === "corporate" ? (
                                                    <>
                                                        <h2 className="text-5xl font-black uppercase leading-none tracking-tight" style={{ color: template.accent }}>
                                                            Cotizacion
                                                        </h2>
                                                        <div className="ml-auto mt-4 h-1 w-56" style={{ backgroundColor: template.accent }} />
                                                        <p className="mt-3 text-xs font-semibold text-slate-600">
                                                            Fecha: {quoteDateLabel}
                                                        </p>
                                                    </>
                                                ) : (
                                                    <div
                                                        className="ml-auto inline-flex min-w-64 items-center justify-end px-6 py-3 text-3xl font-black tracking-tight text-white"
                                                        style={{ backgroundColor: template.dark }}
                                                    >
                                                        Cotizacion
                                                    </div>
                                                )}
                                            </div>
                                        </header>

                                        <section className={cn(
                                            "py-6",
                                            selectedTemplate !== "corporate" ? "grid grid-cols-[1fr_12rem] gap-8" : null,
                                        )}>
                                            <div className="space-y-1.5 text-sm">
                                                <p className="text-xs font-black uppercase tracking-wide" style={{ color: template.accent }}>Cliente</p>
                                                <p className="text-lg font-black">{renderText(clientName) || "Cliente"}</p>
                                                {displayedClientPhone ? (
                                                    <p className="font-semibold text-slate-600">{displayedClientPhone}</p>
                                                ) : null}
                                                {optionalFlags.clientCompany && renderText(clientCompany) ? (
                                                    <p className="text-slate-500">{renderText(clientCompany)}</p>
                                                ) : null}
                                            </div>
                                            {selectedTemplate !== "corporate" ? (
                                                <div className="text-right">
                                                    <div className="px-4 py-2 text-center text-sm font-black text-white" style={{ backgroundColor: template.accent }}>
                                                        FECHA
                                                    </div>
                                                    <p className="mt-3 text-sm font-black">{quoteDateLabel}</p>
                                                </div>
                                            ) : null}
                                        </section>

                                        <section className="overflow-hidden border">
                                            <div className="grid grid-cols-[3rem_1fr_5rem_7rem_7rem] text-xs font-black uppercase text-white" style={{ backgroundColor: template.dark }}>
                                                <div className="px-4 py-3" style={{ backgroundColor: template.accent }}>No.</div>
                                                <div className="px-4 py-3" style={{ backgroundColor: template.accent }}>Descripcion</div>
                                                <div className="px-3 py-3 text-right">Unitario</div>
                                                <div className="px-3 py-3 text-right">Cant.</div>
                                                <div className="px-3 py-3 text-right">Total</div>
                                            </div>
                                            {items.map((item, index) => {
                                                const quantity = safeNumber(item.quantity);
                                                const unitPrice = safeNumber(item.unitPrice);
                                                return (
                                                    <div
                                                        key={item.id}
                                                        className="grid grid-cols-[3rem_1fr_5rem_7rem_7rem] border-b text-sm last:border-b-0"
                                                        style={{ backgroundColor: "#ffffff" }}
                                                    >
                                                        <div className="px-4 py-4 text-xs font-semibold text-slate-700">{String(index + 1).padStart(2, "0")}</div>
                                                        <div className="px-4 py-3">
                                                            <p className="font-bold">{renderText(item.concept) || "Concepto"}</p>
                                                            <p className="mt-1 text-[10px] leading-4 text-slate-500">{renderText(item.description)}</p>
                                                        </div>
                                                        <div className="px-3 py-4 text-right">{formatQuoteCurrency(unitPrice)}</div>
                                                        <div className="px-3 py-4 text-right font-semibold">{quantity}</div>
                                                        <div className="px-3 py-4 text-right font-semibold">{formatQuoteCurrency(quantity * unitPrice)}</div>
                                                    </div>
                                                );
                                            })}
                                        </section>

                                        <section className="ml-auto mt-5 w-64 space-y-1 text-sm">
                                            <div className="flex justify-between">
                                                <span>Subtotal</span>
                                                <span>{formatQuoteCurrency(subtotal)}</span>
                                            </div>
                                            {optionalFlags.iva ? (
                                                <div className="flex justify-between">
                                                    <span>IVA {ivaPercent}%</span>
                                                    <span>{formatQuoteCurrency(ivaAmount)}</span>
                                                </div>
                                            ) : null}
                                            <div className="mt-2 flex justify-between px-4 py-3 text-base font-black text-white" style={{ backgroundColor: template.accent }}>
                                                <span>Total</span>
                                                <span>{formatQuoteCurrency(total)}</span>
                                            </div>
                                        </section>

                                        <div className="mt-auto grid grid-cols-[1fr_1fr] gap-8 pt-5">
                                            <div className="space-y-3 text-xs">
                                                {optionalFlags.notes && renderText(notes) ? (
                                                    <div>
                                                        <p className="font-black uppercase tracking-wide">Terminos y condiciones</p>
                                                        <p className="mt-1 leading-5 text-slate-600">{renderText(notes)}</p>
                                                    </div>
                                                ) : null}
                                                <div>
                                                    <p className="font-black uppercase tracking-wide">Vigencia</p>
                                                    <p className="mt-1 leading-5 text-slate-600">{renderText(validUntil) || "Por definir"}</p>
                                                </div>
                                                {footerItems.length > 0 ? (
                                                    <div>
                                                        <p className="font-black uppercase tracking-wide" style={{ color: template.accent }}>Contacto</p>
                                                        <div className="mt-1 space-y-0.5 text-slate-700">
                                                            {footerItems.map((item) => <p key={item}>{item}</p>)}
                                                        </div>
                                                    </div>
                                                ) : null}
                                            </div>
                                            <div className="self-start justify-self-center pt-8 pr-10 text-center text-xs text-slate-500">
                                                <div className="mx-auto mb-2 h-px w-44 bg-slate-400" />
                                                <p className="font-bold text-slate-800">{renderedVariables.agente || companyName}</p>
                                                <p>Responsable de la cotizacion</p>
                                            </div>
                                        </div>
                                    </div>
                                    )}
                                </div>
                            </div>

                            <p className="text-center text-xs text-muted-foreground">
                                La hoja conserva proporcion carta para que la cotizacion no se estire ni se aplaste.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
