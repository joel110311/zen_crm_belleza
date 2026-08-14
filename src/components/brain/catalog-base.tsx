"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Download, FileSpreadsheet, Images, Loader2, RefreshCw, Trash2, Upload } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
    autofillCatalogEntryFromUrl,
    createCatalogEntry,
    deleteCatalogEntries,
    getCatalogEntries,
    uploadCatalogCsv,
} from "@/app/actions/catalog";
import { useToast } from "@/components/ui/use-toast";

type CatalogEntry = {
    id: string;
    externalId: string;
    development: string;
    location: string | null;
    question: string;
    isActive: boolean;
    assets: Array<{
        id: string;
        type: string;
        url: string;
    }>;
};

function getCatalogHost(url: string) {
    try {
        return new URL(url).hostname.trim().toLowerCase().replace(/^www\./, "");
    } catch {
        return "";
    }
}

function isProtectedPortalUrl(url: string) {
    const host = getCatalogHost(url);
    return host === "zonaprop.com.ar" || host === "argenprop.com";
}

function normalizeProtectedPortalUrl(url: string) {
    const normalized = url.trim();
    if (!normalized) return normalized;

    try {
        const parsedUrl = new URL(normalized);
        if (isProtectedPortalUrl(normalized)) {
            parsedUrl.search = "";
            parsedUrl.hash = "";
        }
        return parsedUrl.toString();
    } catch {
        return normalized;
    }
}

function extractListingId(url: string) {
    try {
        const parsedUrl = new URL(url.trim());
        const slug = parsedUrl.pathname.split("/").filter(Boolean).pop() || "";
        const match = slug.match(/-(\d+)\.html?$/i);
        return match?.[1] || "";
    } catch {
        return "";
    }
}

export function CatalogBase() {
    const [entries, setEntries] = useState<CatalogEntry[]>([]);
    const [isPending, startTransition] = useTransition();
    const [autofillUrl, setAutofillUrl] = useState("");
    const [manualEntry, setManualEntry] = useState({
        externalId: "",
        development: "",
        location: "",
        question: "",
        answer: "",
        imageUrls: "",
        pdfUrl: "",
        linkUrl: "",
        isActive: true,
    });
    const inputRef = useRef<HTMLInputElement>(null);
    const { toast } = useToast();

    const loadEntries = () => {
        startTransition(() => {
            getCatalogEntries().then((items) => setEntries(items as CatalogEntry[]));
        });
    };

    useEffect(() => {
        loadEntries();
    }, []);

    const resetManualEntry = () => {
        setManualEntry({
            externalId: "",
            development: "",
            location: "",
            question: "",
            answer: "",
            imageUrls: "",
            pdfUrl: "",
            linkUrl: "",
            isActive: true,
        });
        setAutofillUrl("");
    };

    const updateManualEntry = (
        key: keyof typeof manualEntry,
        value: string | boolean,
    ) => {
        setManualEntry((current) => ({
            ...current,
            [key]: value,
        }));
    };

    const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const formData = new FormData();
        formData.set("file", file);

        startTransition(async () => {
            const result = await uploadCatalogCsv(formData);
            if (result.success) {
                toast({
                    title: "Catalogo importado",
                    description: `Se cargaron ${result.importedCount} filas y ${result.assetCount} assets.`,
                });
                loadEntries();
            } else {
                toast({
                    title: "No se pudo importar el catalogo",
                    description: result.error,
                    variant: "destructive",
                });
            }
        });
    };

    const handleCreateManualEntry = () => {
        startTransition(async () => {
            const imageUrls = manualEntry.imageUrls
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean);

            const result = await createCatalogEntry({
                externalId: manualEntry.externalId.trim() || undefined,
                development: manualEntry.development.trim(),
                location: manualEntry.location.trim() || undefined,
                question: manualEntry.question.trim(),
                answer: manualEntry.answer.trim(),
                imageUrls,
                pdfUrl: manualEntry.pdfUrl.trim() || undefined,
                linkUrl: manualEntry.linkUrl.trim() || undefined,
                isActive: manualEntry.isActive,
            });

            if (result.success) {
                toast({
                    title: "Ficha guardada",
                    description: `Se agrego la ficha con ${result.assetCount} assets detectados.`,
                });
                resetManualEntry();
                loadEntries();
            } else {
                toast({
                    title: "No se pudo guardar la ficha",
                    description: result.error,
                    variant: "destructive",
                });
            }
        });
    };

    const handleAutofillFromUrl = () => {
        startTransition(async () => {
            const normalizedUrl = normalizeProtectedPortalUrl(autofillUrl);
            if (isProtectedPortalUrl(normalizedUrl)) {
                const listingId = extractListingId(normalizedUrl);
                setManualEntry((current) => ({
                    ...current,
                    externalId: current.externalId || listingId,
                    linkUrl: normalizedUrl,
                }));
                setAutofillUrl(normalizedUrl);
                toast({
                    title: "Completa la ficha manualmente",
                    description: "Ese portal no permite autocompletar solo con URL. Ya dejamos la liga lista para que captures la ficha o la importes por CSV.",
                });
                return;
            }

            const result = await autofillCatalogEntryFromUrl(normalizedUrl);

            if (result.success && result.preview) {
                setManualEntry((current) => ({
                    ...current,
                    externalId: result.preview.externalId || current.externalId,
                    development: result.preview.development || current.development,
                    location: result.preview.location || current.location,
                    question: result.preview.question || current.question,
                    answer: result.preview.answer || current.answer,
                    imageUrls: result.preview.imageUrls.join("\n"),
                    pdfUrl: result.preview.pdfUrl || "",
                    linkUrl: result.preview.linkUrl || current.linkUrl,
                }));
                setAutofillUrl(result.preview.linkUrl || normalizedUrl);
                toast({
                    title: "Ficha detectada",
                    description: `Se cargaron ${result.preview.imageUrls.length} imagenes detectadas desde la URL. Revisa y ajusta antes de guardar.`,
                });
            } else {
                toast({
                    title: "No se pudo detectar la ficha",
                    description: isProtectedPortalUrl(normalizedUrl)
                        ? "Ese portal bloquea la lectura automatica. Para esos casos usa la ficha manual o importa tu catalogo por CSV."
                        : result.error,
                    variant: "destructive",
                });
            }
        });
    };

    const handleClear = () => {
        startTransition(async () => {
            const result = await deleteCatalogEntries();
            if (result.success) {
                toast({
                    title: "Catalogo limpiado",
                    description: "Se eliminaron las fichas y assets del catalogo estructurado.",
                });
                loadEntries();
            } else {
                toast({
                    title: "No se pudo limpiar el catalogo",
                    description: result.error,
                    variant: "destructive",
                });
            }
        });
    };

    const totalImages = entries.reduce(
        (sum, entry) => sum + entry.assets.filter((asset) => asset.type === "image").length,
        0,
    );
    const totalPdf = entries.reduce(
        (sum, entry) => sum + entry.assets.filter((asset) => asset.type === "pdf").length,
        0,
    );

    return (
        <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
            <Card className="h-fit border-primary/20">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <FileSpreadsheet className="h-5 w-5 text-primary" />
                        Catalogo con assets
                    </CardTitle>
                    <CardDescription>
                        Importa un CSV estructurado o crea fichas individuales para que el bot responda por desarrollo, direccion o producto y ofrezca imagenes o PDF cuando existan.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div
                        className="cursor-pointer rounded-xl border-2 border-dashed border-border p-6 text-center transition-colors hover:bg-muted/40"
                        onClick={() => inputRef.current?.click()}
                    >
                        <input
                            ref={inputRef}
                            type="file"
                            accept=".csv"
                            className="hidden"
                            onChange={handleUpload}
                        />
                        <Upload className="mx-auto mb-3 h-7 w-7 text-primary" />
                        <p className="text-sm font-medium">Subir catalogo CSV</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                            Columnas sugeridas: id, desarrollo, ubicacion, pregunta, contenido, imagen_1_url... imagen_10_url, pdf_url, landing_url, activo.
                        </p>
                    </div>

                    <div className="space-y-4 rounded-xl border bg-background p-4">
                        <div>
                            <p className="text-sm font-medium text-foreground">O crear una ficha individual</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                                Ideal para propiedades o productos puntuales. Puedes intentar autocompletar desde URL y luego corregir la ficha antes de guardarla. Si el portal bloquea la lectura automatica, sigue sirviendo la carga manual.
                            </p>
                        </div>

                        <div className="space-y-3 rounded-xl border bg-muted/20 p-3">
                            <div className="space-y-2">
                                <Label>URL de origen</Label>
                                <Input
                                    value={autofillUrl}
                                    onChange={(event) => setAutofillUrl(event.target.value)}
                                    placeholder="https://dominio.com/propiedad"
                                />
                            </div>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={handleAutofillFromUrl}
                                disabled={isPending || !autofillUrl.trim()}
                            >
                                {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                Detectar desde URL
                            </Button>
                            <p className="text-xs text-muted-foreground">
                                Funciona mejor con paginas publicas. Si el portal exige login o bloquea lectura automatica, te dejaremos la liga lista para que completes la ficha manual o uses el CSV.
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label>ID externo opcional</Label>
                            <Input
                                value={manualEntry.externalId}
                                onChange={(event) => updateManualEntry("externalId", event.target.value)}
                                placeholder="deposito_monte_castro_5400"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>Desarrollo o nombre</Label>
                            <Input
                                value={manualEntry.development}
                                onChange={(event) => updateManualEntry("development", event.target.value)}
                                placeholder="Deposito Monte Castro"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>Ubicacion o direccion</Label>
                            <Input
                                value={manualEntry.location}
                                onChange={(event) => updateManualEntry("location", event.target.value)}
                                placeholder="Santo Tome al 5400, Monte Castro, Capital Federal"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>Pregunta gatillo</Label>
                            <Input
                                value={manualEntry.question}
                                onChange={(event) => updateManualEntry("question", event.target.value)}
                                placeholder="Que informacion tienes del deposito en Santo Tome al 5400?"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>Contenido de la ficha</Label>
                            <Textarea
                                value={manualEntry.answer}
                                onChange={(event) => updateManualEntry("answer", event.target.value)}
                                placeholder="Resumen comercial, precio, metros, ambientes, descripcion y lo que deba contestar el bot."
                                className="min-h-[140px]"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>Imagenes</Label>
                            <Textarea
                                value={manualEntry.imageUrls}
                                onChange={(event) => updateManualEntry("imageUrls", event.target.value)}
                                placeholder={"Una URL por linea\nhttps://...\nhttps://..."}
                                className="min-h-[110px]"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>PDF opcional</Label>
                            <Input
                                value={manualEntry.pdfUrl}
                                onChange={(event) => updateManualEntry("pdfUrl", event.target.value)}
                                placeholder="https://dominio.com/ficha.pdf"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>Liga opcional</Label>
                            <Input
                                value={manualEntry.linkUrl}
                                onChange={(event) => updateManualEntry("linkUrl", event.target.value)}
                                placeholder="https://dominio.com/propiedad"
                            />
                        </div>

                        <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2">
                            <div>
                                <p className="text-sm font-medium text-foreground">Ficha activa</p>
                                <p className="text-xs text-muted-foreground">
                                    Si esta activa, el bot la podra usar y ofrecer sus assets.
                                </p>
                            </div>
                            <Switch
                                checked={manualEntry.isActive}
                                onCheckedChange={(checked) => updateManualEntry("isActive", checked)}
                            />
                        </div>

                        <Button onClick={handleCreateManualEntry} disabled={isPending}>
                            {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Guardar ficha individual
                        </Button>
                    </div>

                    <div className="rounded-xl border bg-background p-4">
                        <p className="text-sm font-medium text-foreground">Estructura recomendada</p>
                        <div className="mt-3 grid gap-2 text-xs text-muted-foreground">
                            <p><span className="font-medium text-foreground">Obligatorias:</span> id, desarrollo, pregunta, contenido</p>
                            <p><span className="font-medium text-foreground">Opcionales:</span> ubicacion, imagen_1_url a imagen_10_url, pdf_url, landing_url, activo</p>
                            <p><span className="font-medium text-foreground">activo:</span> acepta si/no, true/false, 1/0</p>
                            <p><span className="font-medium text-foreground">ubicacion:</span> puede ser colonia, zona o direccion exacta.</p>
                        </div>

                        <Button asChild variant="outline" size="sm" className="mt-4">
                            <a href="/examples/catalogo-ejemplo.csv" download>
                                <Download className="h-4 w-4" />
                                Descargar ejemplo CSV
                            </a>
                        </Button>
                    </div>

                    <div className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground space-y-2">
                        <p className="font-medium text-foreground">Como se usara</p>
                        <p>El bot respondera primero con informacion y solo ofrecera imagenes o PDF si existen y estan activados en la configuracion.</p>
                        <p>Las imagenes se enviaran unicamente si el cliente las pide o acepta recibirlas.</p>
                        <p>Las direcciones exactas se buscan mejor aqui que en Conocimiento porque esta capa ya sabe enviar assets y mantener el contexto de la ficha.</p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                        <Badge variant="outline">{entries.length} fichas</Badge>
                        <Badge variant="outline">{totalImages} imagenes</Badge>
                        <Badge variant="outline">{totalPdf} PDF</Badge>
                    </div>

                    <div className="flex items-center gap-2">
                        <Button variant="outline" onClick={loadEntries} disabled={isPending}>
                            {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                            Actualizar
                        </Button>
                        <Button
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            onClick={handleClear}
                            disabled={isPending || entries.length === 0}
                        >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Limpiar catalogo
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Images className="h-5 w-5 text-primary" />
                        Fichas importadas
                    </CardTitle>
                    <CardDescription>
                        Vista rapida de los desarrollos y sus activos detectados.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {entries.length === 0 ? (
                        <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
                            Todavia no hay un catalogo estructurado cargado.
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {entries.map((entry) => {
                                const imageCount = entry.assets.filter((asset) => asset.type === "image").length;
                                const hasPdf = entry.assets.some((asset) => asset.type === "pdf");
                                const hasLink = entry.assets.some((asset) => asset.type === "link");

                                return (
                                    <div
                                        key={entry.id}
                                        className="rounded-2xl border border-border bg-card/60 p-4"
                                    >
                                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                            <div className="min-w-0">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <p className="truncate font-medium text-foreground">
                                                        {entry.development}
                                                    </p>
                                                    <Badge variant="outline">{entry.externalId}</Badge>
                                                </div>
                                                <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">
                                                    {entry.question}
                                                </p>
                                                {entry.location ? (
                                                    <p className="mt-1 text-xs text-muted-foreground">
                                                        {entry.location}
                                                    </p>
                                                ) : null}
                                            </div>

                                            <div className="flex flex-wrap gap-2">
                                                <Badge variant="outline">{imageCount} imagenes</Badge>
                                                <Badge variant="outline">{hasPdf ? "Con PDF" : "Sin PDF"}</Badge>
                                                <Badge variant="outline">{hasLink ? "Con liga" : "Sin liga"}</Badge>
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
