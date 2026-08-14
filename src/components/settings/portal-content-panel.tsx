"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Image from "next/image";
import QRCode from "qrcode";
import { Copy, ExternalLink, Link2, Loader2, Power, Save } from "lucide-react";
import { BrandLogo } from "@/components/brand/brand-logo";
import { PortalShareDialog } from "@/components/settings/portal-share-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { DEFAULT_BRAND_NAME } from "@/lib/branding";

type PortalSettings = {
    portalEnabled: boolean;
    portalSlug: string;
    portalClinicName: string;
    portalIntro: string;
    portalPrimaryColor: string;
    portalPaymentInstructions: string;
};

const DEFAULT_PORTAL_SETTINGS: PortalSettings = {
    portalEnabled: true,
    portalSlug: "belleza",
    portalClinicName: "Zen CRM Belleza",
    portalIntro: "Aparta el horario para tu próximo servicio.",
    portalPrimaryColor: "#4B5F25",
    portalPaymentInstructions: "",
};

export function PortalContentPanel() {
    const { toast } = useToast();
    const [isPending, startTransition] = useTransition();
    const [origin, setOrigin] = useState("");
    const [qrDataUrl, setQrDataUrl] = useState("");
    const [brandName, setBrandName] = useState(DEFAULT_BRAND_NAME);
    const [brandLogoUrl, setBrandLogoUrl] = useState("");
    const [portalSettings, setPortalSettings] = useState<PortalSettings>(DEFAULT_PORTAL_SETTINGS);

    const portalUrl = useMemo(
        () => origin && portalSettings.portalSlug
            ? `${origin}/portal/${encodeURIComponent(portalSettings.portalSlug)}`
            : "",
        [origin, portalSettings.portalSlug],
    );

    useEffect(() => {
        queueMicrotask(() => setOrigin(window.location.origin));
        let active = true;
        fetch("/api/settings", { cache: "no-store" })
            .then(async (response) => (response.ok ? response.json() : null))
            .then((settings) => {
                if (!active || !settings) return;
                const storedPortalName = settings.portalClinicName || settings.clinicName || "";
                const storedPortalIntro = settings.portalIntro || "";
                const storedPaymentInstructions = settings.portalPaymentInstructions || "";
                setBrandName(settings.brandName || DEFAULT_BRAND_NAME);
                setBrandLogoUrl(settings.brandLogoUrl || "");
                setPortalSettings({
                    portalEnabled: settings.portalEnabled !== false,
                    portalSlug: settings.portalSlug || "belleza",
                    portalClinicName: /oftalm/i.test(storedPortalName) ? "Zen CRM Belleza" : storedPortalName || "Zen CRM Belleza",
                    portalIntro: /oftalm/i.test(storedPortalIntro) ? DEFAULT_PORTAL_SETTINGS.portalIntro : storedPortalIntro || DEFAULT_PORTAL_SETTINGS.portalIntro,
                    portalPrimaryColor: !settings.portalPrimaryColor || settings.portalPrimaryColor.toUpperCase() === "#2563EB"
                        ? "#4B5F25"
                        : settings.portalPrimaryColor,
                    portalPaymentInstructions: /recepcion|consulta oftalm|antes de tu cita/i.test(storedPaymentInstructions)
                        ? "El método de pago o apartado se confirmará al reservar."
                        : storedPaymentInstructions,
                });
            })
            .catch(() => {
                toast({ title: "No se pudo cargar el portal", variant: "destructive" });
            });

        return () => {
            active = false;
        };
    }, [toast]);

    useEffect(() => {
        let active = true;
        if (!portalUrl) {
            return;
        }

        QRCode.toDataURL(portalUrl, {
            width: 220,
            margin: 1,
            errorCorrectionLevel: "M",
            color: { dark: "#182014", light: "#FFFFFF" },
        }).then((dataUrl) => {
            if (active) setQrDataUrl(dataUrl);
        }).catch(() => {
            if (active) setQrDataUrl("");
        });

        return () => {
            active = false;
        };
    }, [portalUrl]);

    const savePortalSettings = () => {
        startTransition(async () => {
            const response = await fetch("/api/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(portalSettings),
            });
            if (!response.ok) {
                const result = await response.json().catch(() => null);
                toast({
                    title: "No se pudo guardar",
                    description: result?.error || "Revisa la configuración del portal.",
                    variant: "destructive",
                });
                return;
            }
            toast({ title: "Portal guardado" });
        });
    };

    const togglePortalAvailability = () => {
        const nextEnabled = !portalSettings.portalEnabled;
        if (!nextEnabled && !window.confirm("¿Desactivar el portal público? Nadie podrá apartar horarios hasta que vuelvas a activarlo.")) {
            return;
        }

        startTransition(async () => {
            const response = await fetch("/api/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ portalEnabled: nextEnabled }),
            });
            if (!response.ok) {
                const result = await response.json().catch(() => null);
                toast({
                    title: nextEnabled ? "No se pudo activar el portal" : "No se pudo desactivar el portal",
                    description: result?.error || "Inténtalo nuevamente.",
                    variant: "destructive",
                });
                return;
            }

            setPortalSettings((current) => ({ ...current, portalEnabled: nextEnabled }));
            toast({ title: nextEnabled ? "Portal activado" : "Portal desactivado" });
        });
    };

    const copyPortalUrl = async () => {
        if (!portalUrl) return;
        await navigator.clipboard.writeText(portalUrl);
        toast({ title: "Enlace copiado" });
    };

    return (
        <div className="space-y-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <h2 className="font-semibold">Portal de reservas</h2>
                    <p className="text-sm text-muted-foreground">
                        Personaliza y comparte el enlace para que tus clientes aparten un servicio.
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button
                        type="button"
                        variant={portalSettings.portalEnabled ? "outline" : "default"}
                        className={portalSettings.portalEnabled ? "border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive" : ""}
                        onClick={togglePortalAvailability}
                        disabled={isPending}
                    >
                        <Power className="mr-2 h-4 w-4" />
                        {portalSettings.portalEnabled ? "Desactivar portal" : "Activar portal"}
                    </Button>
                    <Button type="button" onClick={savePortalSettings} disabled={isPending}>
                        {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                        Guardar portal
                    </Button>
                </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
                <Card className="overflow-hidden">
                    <CardHeader>
                        <CardTitle className="text-base">Identidad visual</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-5">
                        <div className="flex items-center gap-4">
                            <div
                                className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl text-white shadow-sm"
                                style={{ backgroundColor: portalSettings.portalPrimaryColor }}
                            >
                                <BrandLogo
                                    brandName={portalSettings.portalClinicName || brandName}
                                    logoUrl={brandLogoUrl}
                                    className="h-16 w-16 text-white"
                                />
                            </div>
                            <div className="min-w-0">
                                <p className="truncate text-lg font-semibold">
                                    {portalSettings.portalClinicName || brandName}
                                </p>
                                <p className="mt-1 text-sm text-muted-foreground">Portal público de reservas</p>
                                <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                                    <span
                                        className="h-5 w-10 rounded border"
                                        style={{ backgroundColor: portalSettings.portalPrimaryColor }}
                                    />
                                    {portalSettings.portalPrimaryColor.toUpperCase()}
                                </div>
                            </div>
                        </div>
                        <p className="rounded-xl border bg-muted/20 p-3 text-sm text-muted-foreground">
                            El logo se toma de Marca blanca. El nombre y color del portal pueden ajustarse abajo.
                        </p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                            <Link2 className="h-4 w-4 text-primary" />
                            Tu enlace de reserva en línea
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <Input value={portalUrl} readOnly className="font-mono text-xs" />
                        <div className="grid gap-2 sm:grid-cols-2">
                            <Button type="button" variant="secondary" onClick={copyPortalUrl} disabled={!portalUrl}>
                                <Copy className="mr-2 h-4 w-4" />
                                Copiar enlace
                            </Button>
                            <Button type="button" variant="outline" onClick={() => window.open(portalUrl, "_blank", "noopener,noreferrer")} disabled={!portalUrl}>
                                <ExternalLink className="mr-2 h-4 w-4" />
                                Abrir portal
                            </Button>
                        </div>
                        <PortalShareDialog portalUrl={portalUrl} />
                        <div className="flex flex-col items-center gap-3 border-t pt-4">
                            {qrDataUrl ? (
                                <Image
                                    src={qrDataUrl}
                                    alt="Código QR del portal de reservas"
                                    width={192}
                                    height={192}
                                    unoptimized
                                    className="h-48 w-48 rounded-2xl border bg-white p-2"
                                />
                            ) : (
                                <div className="flex h-48 w-48 items-center justify-center rounded-2xl border bg-muted/20 text-xs text-muted-foreground">
                                    Generando QR...
                                </div>
                            )}
                            <p className="max-w-sm text-center text-xs text-muted-foreground">
                                También puedes imprimir este código para recibir reservas desde tu local o redes sociales.
                            </p>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Configuración del portal</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                            <Label>Nombre del negocio</Label>
                            <Input
                                value={portalSettings.portalClinicName}
                                onChange={(event) => setPortalSettings((current) => ({ ...current, portalClinicName: event.target.value }))}
                                placeholder="Nombre del salón o negocio"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Dirección del enlace</Label>
                            <div className="flex h-11 overflow-hidden rounded-xl border bg-background focus-within:ring-2 focus-within:ring-ring">
                                <span className="flex items-center border-r bg-muted/40 px-3 text-sm text-muted-foreground">/portal/</span>
                                <Input
                                    value={portalSettings.portalSlug}
                                    onChange={(event) => setPortalSettings((current) => ({
                                        ...current,
                                        portalSlug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
                                    }))}
                                    className="h-full rounded-none border-0 shadow-none focus-visible:ring-0"
                                    placeholder="mi-negocio"
                                />
                            </div>
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label>Mensaje de bienvenida</Label>
                        <Textarea
                            value={portalSettings.portalIntro}
                            onChange={(event) => setPortalSettings((current) => ({ ...current, portalIntro: event.target.value }))}
                            rows={3}
                            placeholder="Invita a tus clientes a reservar su próximo servicio."
                        />
                    </div>
                    <div className="grid gap-4 md:grid-cols-[180px_minmax(0,1fr)]">
                        <div className="space-y-2">
                            <Label>Color principal</Label>
                            <div className="flex items-center gap-2">
                                <Input
                                    type="color"
                                    value={portalSettings.portalPrimaryColor}
                                    onChange={(event) => setPortalSettings((current) => ({ ...current, portalPrimaryColor: event.target.value }))}
                                    className="w-16 p-1"
                                />
                                <span className="text-sm text-muted-foreground">{portalSettings.portalPrimaryColor}</span>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>Indicaciones para el pago o apartado</Label>
                            <Input
                                value={portalSettings.portalPaymentInstructions}
                                onChange={(event) => setPortalSettings((current) => ({ ...current, portalPaymentInstructions: event.target.value }))}
                                placeholder="Opcional: anticipo, transferencia o pago en el local"
                            />
                        </div>
                    </div>
                    <div className="flex items-center justify-between rounded-xl border px-4 py-3">
                        <div>
                            <p className="text-sm font-medium">Portal {portalSettings.portalEnabled ? "activo" : "desactivado"}</p>
                            <p className="text-xs text-muted-foreground">Permite apartar horarios desde el enlace público.</p>
                        </div>
                        <span
                            className={`h-3 w-3 shrink-0 rounded-full ${portalSettings.portalEnabled ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
                            aria-hidden="true"
                        />
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
