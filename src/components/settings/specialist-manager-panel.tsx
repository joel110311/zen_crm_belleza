"use client";

import { useWorkspaceAccess } from "@/components/layout/workspace-access-context";
import { useSession } from "next-auth/react";
import { hasPermission, type AccessSubject } from "@/lib/permissions";
import styles from "@/components/shared/business-workspace.module.css";
import layout from "@/components/shared/management-workspace.module.css";
import type { ChangeEvent } from "react";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { CalendarOff, ImageIcon, Loader2, Plus, RefreshCw, Save, Trash2, Upload, UserRound, X } from "lucide-react";
import {
    deactivateSpecialist,
    deleteSpecialist,
    deleteSpecialistAvailabilityBlock,
    getSpecialistAssignableUsers,
    getSpecialists,
    saveSpecialist,
    saveSpecialistAvailabilityBlock,
    syncSpecialistsFromGoogle,
} from "@/app/actions/specialists";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { PhonePrefixInput } from "@/components/shared/phone-prefix-input";
import { useOperationContext } from "@/components/shared/use-operation-context";
import { matchesWorkspaceSearch } from "@/lib/workspace-search";
import { DEFAULT_SPECIALIST_IMAGE } from "@/lib/specialist-profile";
import {
    dateTimeToOperationInputValue,
    operationInputValueToUtc,
} from "@/lib/operation-dates";

type SpecialistRow = Awaited<ReturnType<typeof getSpecialists>>[number];
type AssignableUser = Awaited<ReturnType<typeof getSpecialistAssignableUsers>>[number];
type GoogleSource = {
    id: string;
    calendarId: string;
    summary: string;
    backgroundColor?: string | null;
    isSelected: boolean;
    isSpecialist: boolean;
    writable: boolean;
};

async function loadGoogleCalendarSources(discover = false) {
    const statusResponse = await fetch("/api/google-calendar/status", { cache: "no-store" });
    if (!statusResponse.ok) return [] as GoogleSource[];

    let status = await statusResponse.json();
    if (discover && status?.connected) {
        const refreshResponse = await fetch("/api/google-calendar/status", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({action:"discover"}) }).catch(()=>null);
        if (refreshResponse?.ok) status = await refreshResponse.json();
    }
    return (status?.sources || []).filter((source: GoogleSource) => source.writable);
}

const EMPTY_FORM = {
    id: "",
    name: "",
    displayName: "",
    specialty: "Cuidado personal",
    email: "",
    phone: "",
    professionalTitle: "Especialista",
    professionalLicense: "",
    color: "#2563EB",
    room: "",
    bio: "",
    photoUrl: "",
    defaultDurationMinutes: 30,
    isActive: true,
    userId: "none",
    googleCalendarSourceId: "none",
};

function getDefaultBlockForm(timeZone = "America/Mexico_City") {
    const start = new Date();
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    return {
        specialistId: "global",
        title: "Bloqueo de agenda",
        startTime: dateTimeToOperationInputValue(start, timeZone),
        endTime: dateTimeToOperationInputValue(end, timeZone),
    };
}

export function SpecialistManagerPanel() {
    const { readOnly } = useWorkspaceAccess();
    const { data: session } = useSession();
    const canWrite = !readOnly && hasPermission(session?.user as AccessSubject | undefined, "specialists.manage");
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [query, setQuery] = useState("");
    const [blockOpen, setBlockOpen] = useState(false);
    const [discardOpen, setDiscardOpen] = useState(false);
    const operationContext = useOperationContext();
    const { toast } = useToast();
    const [isPending, startTransition] = useTransition();
    const [specialists, setSpecialists] = useState<SpecialistRow[]>([]);
    const [users, setUsers] = useState<AssignableUser[]>([]);
    const [googleSources, setGoogleSources] = useState<GoogleSource[]>([]);
    const [form, setForm] = useState(EMPTY_FORM);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [formBaseline, setFormBaseline] = useState(JSON.stringify(EMPTY_FORM));
    const [blockForm, setBlockForm] = useState(() => getDefaultBlockForm(operationContext.timeZone));
    const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
    const [specialistToDelete, setSpecialistToDelete] = useState<SpecialistRow | null>(null);

    const activeCount = useMemo(
        () => specialists.filter((specialist) => specialist.isActive).length,
        [specialists],
    );

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [rows, userRows, sources] = await Promise.all([getSpecialists(true), getSpecialistAssignableUsers(), loadGoogleCalendarSources().catch(() => [])]);
            setSpecialists(rows); setUsers(userRows); setGoogleSources(sources); setLoadError("");
        } catch (error) { setLoadError(error instanceof Error ? error.message : "No se pudo cargar el equipo."); }
        finally { setLoading(false); }
    }, []);
    useEffect(() => { void load(); }, [load]);
    const visibleSpecialists = specialists.filter(specialist => matchesWorkspaceSearch(query,specialist.name,specialist.displayName,specialist.specialty,specialist.room));
    const handleNew = () => {
        if (!canWrite || isPending || isUploadingPhoto) return;
        setForm(EMPTY_FORM);
        setFormBaseline(JSON.stringify(EMPTY_FORM));
        setIsFormOpen(true);
    };

    const handleFormOpenChange = (open: boolean) => {
        if (!open && (isPending || isUploadingPhoto)) return;
        if (!open && JSON.stringify(form) !== formBaseline) { setDiscardOpen(true); return; }
        setIsFormOpen(open);
    };

    const handleEdit = (specialist: SpecialistRow) => {
        if (isPending || isUploadingPhoto || loading) return;
        const nextForm = {
            id: specialist.id,
            name: specialist.name,
            displayName: specialist.displayName || "",
            specialty: specialist.specialty || "Cuidado personal",
            email: specialist.email || "",
            phone: specialist.phone || "",
            professionalTitle: specialist.professionalTitle || "",
            professionalLicense: specialist.professionalLicense || "",
            color: specialist.color || "#2563EB",
            room: specialist.room || "",
            bio: specialist.bio || "",
            photoUrl: specialist.photoUrl || "",
            defaultDurationMinutes: specialist.defaultDurationMinutes || 30,
            isActive: specialist.isActive,
            userId: specialist.userId || "none",
            googleCalendarSourceId: specialist.googleCalendarSourceId || "none",
        };
        setForm(nextForm);
        setFormBaseline(JSON.stringify(nextForm));
        setIsFormOpen(true);
    };

    const handlePhotoUpload = async (event: ChangeEvent<HTMLInputElement>) => {
        if (!canWrite || isPending || isUploadingPhoto) return;
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;

        if (!file.type.startsWith("image/")) {
            toast({ title: "Archivo no valido", description: "Selecciona una imagen para la foto del especialista.", variant: "destructive" });
            return;
        }

        setIsUploadingPhoto(true);
        try {
            const formData = new FormData();
            formData.append("file", file);
            const response = await fetch("/api/upload", { method: "POST", body: formData });
            const result = await response.json() as { success?: boolean; url?: string; mediaCategory?: string; error?: string };

            if (!response.ok || !result.success || !result.url || result.mediaCategory !== "image") {
                throw new Error(result.error || "No se pudo subir la imagen.");
            }

            setForm((current) => ({ ...current, photoUrl: result.url || "" }));
            toast({ title: "Foto cargada", description: "Guarda el especialista para aplicar el cambio." });
        } catch (error) {
            toast({
                title: "No se pudo subir la foto",
                description: error instanceof Error ? error.message : "Intenta con otra imagen.",
                variant: "destructive",
            });
        } finally {
            setIsUploadingPhoto(false);
        }
    };

    const handleSave = () => {
        if (!canWrite || isPending || isUploadingPhoto) return;
        startTransition(async () => {
            const result = await saveSpecialist({
                ...form,
                userId: form.userId === "none" ? null : form.userId,
                googleCalendarSourceId: form.googleCalendarSourceId === "none" ? null : form.googleCalendarSourceId,
            });
            if (!result.success) {
                toast({ title: "No se pudo guardar", description: result.error, variant: "destructive" });
                return;
            }
            toast({
                title: "Especialista guardado",
                description: result.warning || "El calendario y el usuario vinculados quedaron actualizados.",
                variant: result.warning ? "destructive" : "default",
            });
            setForm(EMPTY_FORM);
            setIsFormOpen(false);
            await load();
        });
    };

    const handleSync = () => {
        if (!canWrite || isPending || isUploadingPhoto) return;
        startTransition(async () => {
            await loadGoogleCalendarSources(true).catch(()=>[]);
            const result = await syncSpecialistsFromGoogle();
            if (!result.success) {
                toast({ title: "No se pudo sincronizar", description: result.error, variant: "destructive" });
                return;
            }
            toast({ title: "Especialistas sincronizados" });
            await load();
        });
    };

    const handleDeactivate = (id: string) => {
        if (!canWrite || isPending || isUploadingPhoto) return;
        startTransition(async () => {
            const result = await deactivateSpecialist(id);
            if (!result.success) {
                toast({ title: "No se pudo desactivar", description: result.error, variant: "destructive" });
                return;
            }
            toast({ title: "Especialista desactivado" });
            await load();
        });
    };

    const handleDelete = () => {
        if (!canWrite || isPending || isUploadingPhoto) return;
        if (!specialistToDelete) return;

        startTransition(async () => {
            const result = await deleteSpecialist(specialistToDelete.id);
            if (!result.success) {
                toast({ title: "No se puede eliminar", description: result.error, variant: "destructive" });
                setSpecialistToDelete(null);
                return;
            }
            toast({ title: "Especialista eliminado definitivamente" });
            if (form.id === specialistToDelete.id) setForm(EMPTY_FORM);
            setSpecialistToDelete(null);
            await load();
        });
    };

    const handleSaveBlock = () => {
        if (!canWrite || isPending || isUploadingPhoto) return;
        startTransition(async () => {
            const result = await saveSpecialistAvailabilityBlock({
                specialistId: blockForm.specialistId === "global" ? null : blockForm.specialistId,
                title: blockForm.title,
                startTime: operationInputValueToUtc(blockForm.startTime, operationContext.timeZone) || new Date(blockForm.startTime),
                endTime: operationInputValueToUtc(blockForm.endTime, operationContext.timeZone) || new Date(blockForm.endTime),
            });
            if (!result.success) {
                toast({ title: "No se pudo bloquear", description: result.error, variant: "destructive" });
                return;
            }
            setBlockOpen(false);
            toast({ title: "Bloqueo guardado" });
            await load();
        });
    };

    const handleDeleteBlock = (id: string) => {
        if (!canWrite || isPending || isUploadingPhoto) return;
        startTransition(async () => {
            const result = await deleteSpecialistAvailabilityBlock(id);
            if (!result.success) {
                toast({ title: "No se pudo eliminar", description: result.error, variant: "destructive" });
                return;
            }
            toast({ title: "Bloqueo eliminado" });
            await load();
        });
    };

    return (
        <div className={layout.workspace} data-specialists-workspace>
            <div className={styles.specialistHeader}>
                <div>
                    <Button variant="outline" onClick={() => setBlockOpen(true)} disabled={!canWrite || isPending || loading}><CalendarOff className="size-4 mr-2" />Bloquear agenda</Button>
                    <Button variant="outline" onClick={() => void load()} disabled={isPending || loading}>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Refrescar
                    </Button>
                    <Button variant="outline" onClick={handleSync} disabled={isPending || loading || !canWrite}>
                        {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                        Sincronizar Google
                    </Button>
                    <Button onClick={handleNew} disabled={!canWrite || isPending || loading || activeCount >= 5} title={activeCount >= 5 ? "Puedes tener hasta 5 especialistas activos." : "Agregar especialista sin crear un usuario"}>
                        <Plus className="mr-2 h-4 w-4" />
                        Nuevo especialista
                    </Button>
                </div>
            </div>

            {loadError && <p role="alert" className="rounded-xl border p-4 text-sm text-destructive">{loadError} <Button variant="outline" onClick={() => void load()}>Reintentar</Button></p>}
            {loading && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Cargando equipo…</p>}
            <div>
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center justify-between gap-3 text-base">
                            <span>Especialistas</span>
                            <Badge variant={activeCount >= 5 ? "destructive" : "secondary"}>{activeCount}/5 activos</Badge>
                        </CardTitle>
                    </CardHeader>
                    <div className="px-5 pb-4"><Input aria-label="Buscar especialistas" placeholder="Buscar nombre, especialidad o área…" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
                    <CardContent className={styles.grid}>
                        {visibleSpecialists.map((specialist) => (
                            <div key={specialist.id} className={styles.specialistCard}>
                                <div className="flex flex-col gap-3">
                                    <div className="flex min-w-0 gap-3">
                                        <div
                                            className="h-14 w-14 shrink-0 rounded-full border bg-muted bg-cover bg-center"
                                            style={{ backgroundImage: `url("${specialist.photoUrl || DEFAULT_SPECIALIST_IMAGE}")` }}
                                            role="img"
                                            aria-label={`Foto de ${specialist.displayName || specialist.name}`}
                                        />
                                        <div className="min-w-0">
                                        <h3 className="flex min-w-0 items-start gap-2 font-semibold"><span className="mt-1.5 size-3 shrink-0 rounded-full" style={{backgroundColor:specialist.color || "#2563EB"}} /><span className="min-w-0">{specialist.displayName || specialist.name}</span></h3>
                                        <div className="mt-2 flex flex-wrap gap-2"><Badge variant={specialist.isActive ? "secondary" : "outline"}>{specialist.isActive ? "Activo" : "Inactivo"}</Badge>{specialist.googleCalendarSource && <Badge variant="outline">Google</Badge>}</div>
                                        <p className="mt-1 text-sm text-muted-foreground">
                                            {specialist.specialty || "Cuidado personal"} · {specialist.defaultDurationMinutes} min · {specialist.room || "Sin área asignada"}
                                        </p>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            {specialist._count.appointments} {specialist._count.appointments === 1 ? "cita" : "citas"} · {specialist._count.availabilityBlocks} {specialist._count.availabilityBlocks === 1 ? "bloqueo" : "bloqueos"}
                                        </p>
                                    </div>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <Button size="sm" className="min-h-11" variant="outline" disabled={isPending || isUploadingPhoto || loading} aria-label={`Abrir especialista: ${specialist.displayName || specialist.name}`} onClick={() => handleEdit(specialist)}>
                                            Editar
                                        </Button>
                                        {specialist.isActive ? (
                                            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={!canWrite || isPending} onClick={() => handleDeactivate(specialist.id)}>
                                                Desactivar
                                            </Button>
                                        ) : (
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                className="text-destructive hover:text-destructive"
                                                disabled={!canWrite || isPending} onClick={() => setSpecialistToDelete(specialist)}
                                            >
                                                <Trash2 className="mr-1.5 h-4 w-4" />
                                                Eliminar
                                            </Button>
                                        )}
                                    </div>
                                </div>

                                {specialist.availabilityBlocks.length > 0 ? (
                                    <div className="mt-3 space-y-2">
                                        {specialist.availabilityBlocks.map((block) => (
                                            <div key={block.id} className="flex flex-col gap-2 rounded-xl border bg-muted/20 px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between">
                                                <span>
                                                    {block.title} · {new Date(block.startTime).toLocaleString(operationContext.locale, { timeZone: operationContext.timeZone })}
                                                </span>
                                                <Button size="sm" variant="ghost" className="h-7 text-destructive hover:text-destructive" disabled={!canWrite || isPending} onClick={() => handleDeleteBlock(block.id)}>
                                                    <X className="mr-1 h-3 w-3" />
                                                    Quitar
                                                </Button>
                                            </div>
                                        ))}
                                    </div>
                                ) : null}
                            </div>
                        ))}

                        {!loading && visibleSpecialists.length === 0 ? (
                            <div className="rounded-2xl border border-dashed px-4 py-8 text-sm text-muted-foreground">
                                {query ? "No hay especialistas que coincidan con tu búsqueda." : "Aún no hay especialistas. Añade a la primera persona de tu equipo."}
                            </div>
                        ) : null}
                    </CardContent>
                </Card>

            </div>
            <Dialog open={blockOpen} onOpenChange={(open) => { if (!isPending) setBlockOpen(open); }}><DialogContent className={layout.dialog}><DialogHeader className={layout.dialogHeader}><DialogTitle>Bloquear agenda</DialogTitle><DialogDescription>Reserva un periodo sin citas para un especialista o para todo el equipo.</DialogDescription></DialogHeader><div className={layout.dialogBody}><fieldset className={styles.form} disabled={!canWrite || isPending}>
                            <div className="space-y-2">
                                <Label>Especialista</Label>
                                <Select value={blockForm.specialistId} onValueChange={(value) => setBlockForm((current) => ({ ...current, specialistId: value }))}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="global">Todos</SelectItem>
                                        {specialists.filter((specialist) => specialist.isActive).map((specialist) => (
                                            <SelectItem key={specialist.id} value={specialist.id}>
                                                {specialist.displayName || specialist.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="block-title">Título</Label>
                                <Input id="block-title" value={blockForm.title} onChange={(event) => setBlockForm((current) => ({ ...current, title: event.target.value }))} />
                            </div>
                            <div className={styles.blockDates}>
                                <div className="space-y-2">
                                    <Label htmlFor="block-startTime">Inicio</Label>
                                    <Input type="datetime-local" id="block-startTime" value={blockForm.startTime} onChange={(event) => setBlockForm((current) => ({ ...current, startTime: event.target.value }))} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="block-endTime">Fin</Label>
                                    <Input type="datetime-local" id="block-endTime" value={blockForm.endTime} onChange={(event) => setBlockForm((current) => ({ ...current, endTime: event.target.value }))} />
                                </div>
                            </div>
</fieldset></div><DialogFooter className={layout.dialogFooter}><Button variant="outline" disabled={isPending} onClick={() => setBlockOpen(false)}>Cancelar</Button><Button disabled={!canWrite || isPending || !blockForm.title} onClick={handleSaveBlock}>Guardar bloqueo</Button></DialogFooter></DialogContent></Dialog>
            <Dialog open={isFormOpen} onOpenChange={handleFormOpenChange}>
                <DialogContent className={layout.dialog}>
                        <DialogHeader className={layout.dialogHeader}>
                            <DialogTitle className="flex items-center gap-2 text-base">
                                <UserRound className="h-5 w-5 text-primary" />
                                {form.id ? "Editar especialista" : "Nuevo especialista"}
                            </DialogTitle>
                            <DialogDescription>Agrega a quien realiza los servicios. Vincular una cuenta de acceso o Google Calendar es opcional.</DialogDescription>
                        </DialogHeader>
                        <div className={layout.dialogBody}><fieldset className={styles.form} disabled={!canWrite || isPending || isUploadingPhoto}>
                            <details className={styles.section}><summary>Foto del especialista</summary><div className="p-4">
                                <div className="flex flex-col gap-4 sm:flex-row">
                                    <div
                                        className="h-28 w-28 shrink-0 rounded-2xl border bg-background bg-cover bg-center shadow-inner"
                                        style={{ backgroundImage: `url("${form.photoUrl || DEFAULT_SPECIALIST_IMAGE}")` }}
                                        role="img"
                                        aria-label="Vista previa de la foto del especialista"
                                    />
                                    <div className="min-w-0 flex-1 space-y-3">
                                        <div>
                                            <Label>Foto del especialista</Label>
                                            <p className="mt-1 text-xs text-muted-foreground">
                                                Si queda vacío, se mostrará la imagen predeterminada del negocio.
                                            </p>
                                        </div>
                                        <div className="space-y-2">
                                            <Input
                                                value={form.photoUrl}
                                                onChange={(event) => setForm((current) => ({ ...current, photoUrl: event.target.value }))}
                                                placeholder="/api/media/foto.png o URL de imagen"
                                            />
                                            <div className="flex flex-wrap gap-2">
                                                <input
                                                    id="specialist-photo-upload"
                                                    type="file"
                                                    accept="image/*"
                                                    className="sr-only"
                                                    onChange={handlePhotoUpload}
                                                    disabled={isUploadingPhoto}
                                                />
                                                <label
                                                    htmlFor="specialist-photo-upload"
                                                    className={`inline-flex h-9 cursor-pointer items-center justify-center rounded-md border bg-background px-3 text-sm font-medium transition hover:bg-muted ${isUploadingPhoto ? "pointer-events-none opacity-60" : ""}`}
                                                >
                                                    {isUploadingPhoto ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                                                    Subir foto
                                                </label>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => setForm((current) => ({ ...current, photoUrl: "" }))}
                                                >
                                                    <ImageIcon className="mr-2 h-4 w-4" />
                                                    Usar default
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            </details>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <div className="space-y-2">
                                    <Label htmlFor="specialist-name">Nombre</Label>
                                    <Input id="specialist-name" autoFocus value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="specialist-displayName">Nombre visible</Label>
                                    <Input id="specialist-displayName" value={form.displayName} onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))} />
                                </div>
                            </div>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <div className="space-y-2">
                                    <Label htmlFor="specialist-email">Email</Label>
                                    <Input type="email" id="specialist-email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="specialist-phone">Teléfono</Label>
                                    <PhonePrefixInput inputId="specialist-phone"
                                        value={form.phone}
                                        onChange={(value) => setForm((current) => ({ ...current, phone: value }))}
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <div className="space-y-2">
                                    <Label htmlFor="specialist-specialty">Especialidad</Label>
                                    <Input id="specialist-specialty" value={form.specialty} onChange={(event) => setForm((current) => ({ ...current, specialty: event.target.value }))} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="specialist-room">Área o estación</Label>
                                    <Input
                                        id="specialist-room" value={form.room}
                                        onChange={(event) => setForm((current) => ({ ...current, room: event.target.value }))}
                                        placeholder="Cabina, estación o sucursal"
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <div className="space-y-2">
                                    <Label htmlFor="specialist-professionalTitle">Título profesional</Label>
                                    <Input
                                        id="specialist-professionalTitle" value={form.professionalTitle}
                                        onChange={(event) => setForm((current) => ({ ...current, professionalTitle: event.target.value }))}
                                        placeholder="Estilista, técnica, terapeuta..."
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="specialist-professionalLicense">Certificación</Label>
                                    <Input
                                        id="specialist-professionalLicense" value={form.professionalLicense}
                                        onChange={(event) => setForm((current) => ({ ...current, professionalLicense: event.target.value }))}
                                        placeholder="Certificación (opcional)"
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <div className="space-y-2">
                                    <Label htmlFor="specialist-defaultDurationMinutes">Duración predeterminada</Label>
                                    <Input
                                        type="number"
                                        min={15}
                                        max={180}
                                        id="specialist-defaultDurationMinutes" value={form.defaultDurationMinutes}
                                        onChange={(event) => setForm((current) => ({ ...current, defaultDurationMinutes: Number(event.target.value) }))}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="specialist-color">Color</Label>
                                    <Input type="color" id="specialist-color" value={form.color} onChange={(event) => setForm((current) => ({ ...current, color: event.target.value }))} />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label>Usuario vinculado</Label>
                                <Select value={form.userId} onValueChange={(value) => setForm((current) => ({ ...current, userId: value }))}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Sin usuario vinculado" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">Sin usuario vinculado</SelectItem>
                                        {users.map((user) => (
                                            <SelectItem key={user.id} value={user.id}>
                                                {user.name} ({user.email})
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-muted-foreground">
                                    Vincula el acceso de usuario con este perfil para citas atendidas y notificaciones del especialista.
                                </p>
                            </div>
                            <div className="space-y-2">
                                <Label>Calendario Google vinculado</Label>
                                <Select value={form.googleCalendarSourceId} onValueChange={(value) => setForm((current) => ({ ...current, googleCalendarSourceId: value }))}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Sin calendario vinculado" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">Sin calendario</SelectItem>
                                        {googleSources.map((source) => (
                                            <SelectItem key={source.id} value={source.id}>
                                                {source.summary}{source.isSelected ? "" : " (se activara al guardar)"}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="specialist-bio">Perfil profesional</Label>
                                <Textarea
                                    id="specialist-bio" value={form.bio}
                                    onChange={(event) => setForm((current) => ({ ...current, bio: event.target.value }))}
                                    placeholder="Resumen breve del perfil, experiencia o indicaciones visibles para clientes."
                                    className="min-h-24"
                                />
                            </div>
                            <div className="flex items-center justify-between rounded-xl border px-3 py-3">
                                <div>
                                    <p className="text-sm font-medium">Activo</p>
                                    <p className="text-xs text-muted-foreground">Disponible para agenda y portal.</p>
                                </div>
                                <Switch checked={form.isActive} onCheckedChange={(checked) => setForm((current) => ({ ...current, isActive: checked }))} />
                            </div>
                        </fieldset></div>
                            <DialogFooter className={layout.dialogFooter}>
                                <Button onClick={handleSave} disabled={!canWrite || isPending || isUploadingPhoto || !form.name.trim()} className="flex-1">
                                    {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                    Guardar
                                </Button>
                                <Button variant="outline" onClick={() => handleFormOpenChange(false)} disabled={isPending || isUploadingPhoto}>
                                    Cancelar
                                </Button>
                            </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={discardOpen} onOpenChange={setDiscardOpen}><DialogContent className={styles.confirmation}><DialogHeader><DialogTitle>¿Descartar los cambios?</DialogTitle><DialogDescription>El perfil tiene cambios sin guardar.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setDiscardOpen(false)}>Conservar</Button><Button onClick={() => { setDiscardOpen(false); setIsFormOpen(false); }}>Descartar</Button></DialogFooter></DialogContent></Dialog>
            <Dialog open={Boolean(specialistToDelete)} onOpenChange={(open) => !open && setSpecialistToDelete(null)}>
                <DialogContent className={styles.confirmation}>
                    <DialogHeader>
                        <DialogTitle>Eliminar especialista definitivamente</DialogTitle>
                        <DialogDescription>
                            Vas a eliminar a {specialistToDelete?.displayName || specialistToDelete?.name}. Esta acción no se puede deshacer. Si tiene citas asociadas, el sistema conservará el perfil inactivo para proteger el historial.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button type="button" variant="outline" onClick={() => setSpecialistToDelete(null)} disabled={isPending}>
                            Cancelar
                        </Button>
                        <Button type="button" variant="destructive" onClick={handleDelete} disabled={!canWrite || isPending}>
                            {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                            Eliminar definitivamente
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
