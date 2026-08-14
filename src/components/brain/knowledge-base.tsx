"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { formatDistanceToNow } from "date-fns";
import {
    Bot,
    Download,
    FileText,
    Github,
    Globe,
    Link2,
    Loader2,
    RefreshCw,
    Search,
    Trash2,
    Upload,
    Youtube,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
    createKnowledgeSource,
    downloadKnowledgeSourceText,
    deleteKnowledgeSource,
    getKnowledgeSources,
    reindexKnowledgeSource,
    uploadKnowledgeFile,
} from "@/app/actions/knowledge";
import { useToast } from "@/components/ui/use-toast";

type KnowledgeSource = {
    id: string;
    title: string;
    type: string;
    status: string;
    sourceUri: string | null;
    mimeType: string | null;
    error: string | null;
    chunkCount: number;
    syncedAt: Date | string | null;
    updatedAt: Date | string;
};

const SOURCE_OPTIONS = [
    { value: "website", label: "URL", icon: Link2, help: "Pagina individual para preguntas y respuestas." },
    { value: "crawl", label: "Crawler", icon: Search, help: "Recorre varias paginas internas del mismo sitio." },
    { value: "sitemap", label: "Sitemap", icon: Globe, help: "Importa URLs desde un sitemap XML." },
    { value: "github", label: "GitHub", icon: Github, help: "Lee codigo y docs de un repositorio publico." },
    { value: "youtube", label: "YouTube", icon: Youtube, help: "Usa la transcripcion del video como contexto." },
    { value: "text", label: "Texto", icon: Bot, help: "Notas, FAQs, prompts y fichas de producto con URL de imagen." },
    { value: "file", label: "Archivo", icon: FileText, help: "PDF, TXT, MD, CSV, JSON, DOCX, MP3, MP4 y mas." },
];

function statusBadge(status: string) {
    if (status === "ready") {
        return <Badge className="bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">Listo</Badge>;
    }
    if (status === "processing") {
        return <Badge className="bg-sky-500/10 text-sky-600 border border-sky-500/20">Procesando</Badge>;
    }
    if (status === "failed") {
        return <Badge className="bg-destructive/10 text-destructive border border-destructive/20">Error</Badge>;
    }
    return <Badge variant="outline">Pendiente</Badge>;
}

export function KnowledgeBase() {
    const [sources, setSources] = useState<KnowledgeSource[]>([]);
    const [sourceType, setSourceType] = useState("website");
    const [title, setTitle] = useState("");
    const [sourceUri, setSourceUri] = useState("");
    const [noteContent, setNoteContent] = useState("");
    const [showAdvancedFetch, setShowAdvancedFetch] = useState(false);
    const [requestMode, setRequestMode] = useState("standard");
    const [authorizationHeader, setAuthorizationHeader] = useState("");
    const [cookieHeader, setCookieHeader] = useState("");
    const [refererUrl, setRefererUrl] = useState("");
    const [crawlMaxDepth, setCrawlMaxDepth] = useState("2");
    const [crawlMaxPages, setCrawlMaxPages] = useState("24");
    const [sitemapMaxPages, setSitemapMaxPages] = useState("60");
    const [downloadingSourceId, setDownloadingSourceId] = useState<string | null>(null);
    const [isPending, startTransition] = useTransition();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { toast } = useToast();

    const loadSources = () => {
        startTransition(() => {
            getKnowledgeSources().then((items) => setSources(items as KnowledgeSource[]));
        });
    };

    useEffect(() => {
        loadSources();
    }, []);

    const selectedOption = SOURCE_OPTIONS.find((option) => option.value === sourceType) || SOURCE_OPTIONS[0];
    const SelectedIcon = selectedOption.icon;
    const supportsAdvancedFetch = sourceType === "website" || sourceType === "crawl" || sourceType === "sitemap";

    const resetForm = () => {
        setTitle("");
        setSourceUri("");
        setNoteContent("");
        setShowAdvancedFetch(false);
        setRequestMode("standard");
        setAuthorizationHeader("");
        setCookieHeader("");
        setRefererUrl("");
        setCrawlMaxDepth("2");
        setCrawlMaxPages("24");
        setSitemapMaxPages("60");
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    const parseOptionalPositiveInteger = (value: string) => {
        const parsed = Number.parseInt(value, 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
    };

    const buildSourceMetadata = () => {
        if (!supportsAdvancedFetch || !showAdvancedFetch) {
            return undefined;
        }

        const metadata: Record<string, unknown> = {
            requestMode,
            authorizationHeader: authorizationHeader.trim() || undefined,
            cookieHeader: cookieHeader.trim() || undefined,
            refererUrl: refererUrl.trim() || undefined,
        };

        if (sourceType === "crawl") {
            metadata.crawlMaxDepth = parseOptionalPositiveInteger(crawlMaxDepth);
            metadata.crawlMaxPages = parseOptionalPositiveInteger(crawlMaxPages);
        }

        if (sourceType === "sitemap") {
            metadata.sitemapMaxPages = parseOptionalPositiveInteger(sitemapMaxPages);
        }

        return metadata;
    };

    const handleCreate = () => {
        startTransition(async () => {
            const result = await createKnowledgeSource({
                title: title.trim() || undefined,
                type: sourceType as "text" | "website" | "crawl" | "sitemap" | "github" | "youtube",
                sourceUri: sourceUri.trim() || undefined,
                rawContent: noteContent.trim() || undefined,
                metadata: buildSourceMetadata(),
            });

            if (result.success) {
                toast({
                    title: "Fuente agregada",
                    description: "La indexacion ya comenzo en segundo plano.",
                });
                resetForm();
                loadSources();
            } else {
                toast({
                    title: "No se pudo crear la fuente",
                    description: result.error,
                    variant: "destructive",
                });
            }
        });
    };

    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const formData = new FormData();
        formData.set("file", file);

        startTransition(async () => {
            const result = await uploadKnowledgeFile(formData);
            if (result.success) {
                toast({
                    title: "Archivo agregado",
                    description: "El archivo ya se esta convirtiendo en conocimiento util.",
                });
                resetForm();
                loadSources();
            } else {
                toast({
                    title: "No se pudo procesar el archivo",
                    description: result.error,
                    variant: "destructive",
                });
            }
        });
    };

    const handleReindex = (sourceId: string) => {
        startTransition(async () => {
            const result = await reindexKnowledgeSource(sourceId);
            if (!result.success) {
                toast({
                    title: "No se pudo reindexar",
                    description: result.error,
                    variant: "destructive",
                });
            }
            loadSources();
        });
    };

    const handleDelete = (sourceId: string) => {
        startTransition(async () => {
            const result = await deleteKnowledgeSource(sourceId);
            if (!result.success) {
                toast({
                    title: "No se pudo eliminar",
                    description: result.error,
                    variant: "destructive",
                });
            }
            loadSources();
        });
    };

    const buildDownloadFileName = (sourceTitle: string) => {
        const sanitized = sourceTitle
            .normalize("NFKD")
            .replace(/[^\w\s-]/g, "")
            .trim()
            .replace(/\s+/g, "-")
            .toLowerCase();

        return `${sanitized || "fuente-conocimiento"}.txt`;
    };

    const handleDownloadTextBackup = async (sourceId: string) => {
        setDownloadingSourceId(sourceId);
        try {
            const result = await downloadKnowledgeSourceText(sourceId);
            if (!result.success) {
                toast({
                    title: "No se pudo descargar el texto",
                    description: result.error,
                    variant: "destructive",
                });
                return;
            }

            const rawContent = typeof result.rawContent === "string" ? result.rawContent : "";
            const sourceTitle = typeof result.title === "string" ? result.title : "fuente-conocimiento";
            const blob = new Blob([rawContent], { type: "text/plain;charset=utf-8" });
            const objectUrl = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = objectUrl;
            anchor.download = buildDownloadFileName(sourceTitle);
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            URL.revokeObjectURL(objectUrl);
        } finally {
            setDownloadingSourceId(null);
        }
    };

    return (
        <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
            <Card className="h-fit border-primary/20">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <SelectedIcon className="h-5 w-5 text-primary" />
                        Nueva fuente
                    </CardTitle>
                    <CardDescription>
                        Inspirado en Dialoqbase, pero enfocado al cerebro del CRM y las respuestas de WhatsApp.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label>Tipo de fuente</Label>
                        <Select value={sourceType} onValueChange={setSourceType}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {SOURCE_OPTIONS.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>
                                        {option.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">{selectedOption.help}</p>
                    </div>

                    <div className="space-y-2">
                        <Label>Titulo</Label>
                        <Input
                            value={title}
                            onChange={(event) => setTitle(event.target.value)}
                            placeholder="Nombre corto para ubicar esta fuente"
                        />
                    </div>

                    {sourceType === "text" ? (
                        <div className="space-y-2">
                            <Label>Contenido</Label>
                            <Textarea
                                value={noteContent}
                                onChange={(event) => setNoteContent(event.target.value)}
                                placeholder={"Ejemplo:\nPulseras Glow Sync | Pulseras LED personalizadas | https://tu-cdn.com/pulsera-glow-sync.jpg"}
                                className="min-h-[180px]"
                            />
                            <p className="text-xs text-muted-foreground">
                                Puedes cargar lineas con formato <span className="font-medium">descripcion | URL</span> para que el agente tenga la imagen a mano.
                            </p>
                        </div>
                    ) : sourceType === "file" ? (
                        <div className="space-y-2">
                            <Label>Archivo</Label>
                            <div
                                className="rounded-xl border-2 border-dashed border-border p-6 text-center hover:bg-muted/40 transition-colors cursor-pointer"
                                onClick={() => fileInputRef.current?.click()}
                            >
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    className="hidden"
                                    accept=".pdf,.txt,.md,.csv,.json,.docx,.mp3,.mp4,.wav,.ogg,.m4a"
                                    onChange={handleFileUpload}
                                />
                                <Upload className="h-7 w-7 mx-auto mb-3 text-primary" />
                                <p className="text-sm font-medium">Haz clic para subir un archivo</p>
                                <p className="text-xs text-muted-foreground mt-1">
                                    PDF, TXT, MD, CSV, JSON, DOCX, MP3, MP4, WAV y OGG
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            <Label>URL o recurso</Label>
                            <Input
                                value={sourceUri}
                                onChange={(event) => setSourceUri(event.target.value)}
                                placeholder={
                                    sourceType === "github"
                                        ? "https://github.com/owner/repo"
                                        : sourceType === "sitemap"
                                            ? "https://dominio.com/sitemap.xml"
                                            : sourceType === "youtube"
                                                ? "https://www.youtube.com/watch?v=..."
                                                : "https://dominio.com"
                                }
                            />
                        </div>
                    )}

                    {supportsAdvancedFetch ? (
                        <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
                            <div className="flex items-center justify-between gap-3">
                                <div className="space-y-1">
                                    <Label className="text-sm">Opciones avanzadas web</Label>
                                    <p className="text-xs text-muted-foreground">
                                        Para sitios protegidos puedes usar modo navegador, cookies o un header de autorizacion.
                                    </p>
                                </div>
                                <Switch
                                    checked={showAdvancedFetch}
                                    onCheckedChange={setShowAdvancedFetch}
                                />
                            </div>

                            {showAdvancedFetch ? (
                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <Label>Modo de lectura</Label>
                                        <Select value={requestMode} onValueChange={setRequestMode}>
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="standard">Estandar</SelectItem>
                                                <SelectItem value="browser">Navegador</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <p className="text-xs text-muted-foreground">
                                            `Navegador` usa headers similares a Chrome. Ayuda en varios sitios, aunque un muro fuerte como Cloudflare aun puede requerir cookies activas.
                                        </p>
                                    </div>

                                    <div className="space-y-2">
                                        <Label>Header Authorization</Label>
                                        <Input
                                            value={authorizationHeader}
                                            onChange={(event) => setAuthorizationHeader(event.target.value)}
                                            placeholder="Bearer xxxx o Basic xxxxx"
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <Label>Cookies</Label>
                                        <Textarea
                                            value={cookieHeader}
                                            onChange={(event) => setCookieHeader(event.target.value)}
                                            placeholder="cookie_a=valor; cookie_b=valor"
                                            className="min-h-[88px]"
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <Label>Referer</Label>
                                        <Input
                                            value={refererUrl}
                                            onChange={(event) => setRefererUrl(event.target.value)}
                                            placeholder="https://dominio.com/login"
                                        />
                                    </div>

                                    {sourceType === "crawl" ? (
                                        <div className="grid gap-3 sm:grid-cols-2">
                                            <div className="space-y-2">
                                                <Label>Profundidad maxima</Label>
                                                <Input
                                                    value={crawlMaxDepth}
                                                    onChange={(event) => setCrawlMaxDepth(event.target.value)}
                                                    inputMode="numeric"
                                                    placeholder="2"
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label>Paginas maximas</Label>
                                                <Input
                                                    value={crawlMaxPages}
                                                    onChange={(event) => setCrawlMaxPages(event.target.value)}
                                                    inputMode="numeric"
                                                    placeholder="24"
                                                />
                                            </div>
                                        </div>
                                    ) : null}

                                    {sourceType === "sitemap" ? (
                                        <div className="space-y-2">
                                            <Label>URLs maximas del sitemap</Label>
                                            <Input
                                                value={sitemapMaxPages}
                                                onChange={(event) => setSitemapMaxPages(event.target.value)}
                                                inputMode="numeric"
                                                placeholder="60"
                                            />
                                        </div>
                                    ) : null}
                                </div>
                            ) : null}
                        </div>
                    ) : null}

                    {sourceType !== "file" && (
                        <Button onClick={handleCreate} className="w-full" disabled={isPending}>
                            {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Agregar al cerebro
                        </Button>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="flex flex-row items-start justify-between gap-4">
                    <div>
                        <CardTitle>Fuentes indexadas</CardTitle>
                        <CardDescription>
                            Todo lo que el bot puede consultar antes de responder en WhatsApp.
                        </CardDescription>
                    </div>
                    <Button variant="outline" size="sm" onClick={loadSources} disabled={isPending}>
                        <RefreshCw className={`mr-2 h-4 w-4 ${isPending ? "animate-spin" : ""}`} />
                        Actualizar
                    </Button>
                </CardHeader>
                <CardContent>
                    {sources.length === 0 ? (
                        <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
                            Todavia no hay fuentes. Agrega una URL, archivo o nota para alimentar el cerebro.
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {sources.map((source) => {
                                const option = SOURCE_OPTIONS.find((item) => item.value === source.type);
                                const Icon = option?.icon || FileText;
                                return (
                                    <div
                                        key={source.id}
                                        className="rounded-2xl border border-border p-4 bg-card/60"
                                    >
                                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                            <div className="flex items-start gap-3 min-w-0">
                                                <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                                                    <Icon className="h-5 w-5" />
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <p className="font-medium text-foreground truncate">
                                                            {source.title}
                                                        </p>
                                                        {statusBadge(source.status)}
                                                    </div>
                                                    <p className="text-xs text-muted-foreground uppercase tracking-wide mt-1">
                                                        {option?.label || source.type} · {source.chunkCount} chunks
                                                    </p>
                                                    {source.sourceUri ? (
                                                        <p className="text-xs text-muted-foreground mt-2 break-all">
                                                            {source.sourceUri}
                                                        </p>
                                                    ) : null}
                                                    {source.error ? (
                                                        <p className="text-xs text-destructive mt-2">{source.error}</p>
                                                    ) : null}
                                                    <p className="text-xs text-muted-foreground mt-2">
                                                        {source.syncedAt
                                                            ? `Ultima indexacion ${formatDistanceToNow(new Date(source.syncedAt), { addSuffix: true })}`
                                                            : `Actualizado ${formatDistanceToNow(new Date(source.updatedAt), { addSuffix: true })}`}
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-2 shrink-0">
                                                {source.type === "text" ? (
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => void handleDownloadTextBackup(source.id)}
                                                        disabled={isPending || downloadingSourceId === source.id}
                                                    >
                                                        {downloadingSourceId === source.id ? (
                                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                        ) : (
                                                            <Download className="mr-2 h-4 w-4" />
                                                        )}
                                                        Descargar TXT
                                                    </Button>
                                                ) : null}
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => handleReindex(source.id)}
                                                    disabled={isPending}
                                                >
                                                    <RefreshCw className="mr-2 h-4 w-4" />
                                                    Reindexar
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="text-destructive hover:text-destructive"
                                                    onClick={() => handleDelete(source.id)}
                                                    disabled={isPending}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
