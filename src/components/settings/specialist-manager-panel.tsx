"use client";

import type { ChangeEvent } from "react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { CalendarOff, ImageIcon, Loader2, RefreshCw, Save, Trash2, Upload, UserRound, X } from "lucide-react";
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
import { DEFAULT_OPHTHALMOLOGIST_IMAGE } from "@/lib/specialist-profile";
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

async function loadGoogleCalendarSources() {
    const statusResponse = await fetch("/api/google-calendar/status", { cache: "no-store" });
    if (!statusResponse.ok) return [] as GoogleSource[];

    let status = await statusResponse.json();
    if (status?.connected) {
        const refreshResponse = await fetch("/api/google-calendar/status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "discover" }),
        }).catch(() => null);
        if (refreshResponse?.ok) status = await refreshResponse.json();
    }

    return (status?.sources || []).filter((source: GoogleSource) => source.writable);
}

const EMPTY_FORM = {
    id: "",
    name: "",
    displayName: "",
    specialty: "Oftalmologia",
    email: "",
    phone: "",
    professionalTitle: "Medico Oftalmologo",
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
    const operationContext = useOperationContext();
    const { toast } = useToast();
    const [isPending, startTransition] = useTransition();
    const [specialists, setSpecialists] = useState<SpecialistRow[]>([]);
    const [users, setUsers] = useState<AssignableUser[]>([]);
    const [googleSources, setGoogleSources] = useState<GoogleSource[]>([]);
    const [form, setForm] = useState(EMPTY_FORM);
    const [blockForm, setBlockForm] = useState(() => getDefaultBlockForm(operationContext.timeZone));
    const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
    const [specialistToDelete, setSpecialistToDelete] = useState<SpecialistRow | null>(null);

    const activeCount = useMemo(
        () => specialists.filter((specialist) => specialist.isActive).length,
        [specialists],
    );

    const load = async () => {
        const [rows, userRows, status] = await Promise.all([
            getSpecialists(true),
            getSpecialistAssignableUsers(),
            loadGoogleCalendarSources().catch(() => []),
        ]);
        setSpecialists(rows);
        setUsers(userRows);
        setGoogleSources(status);
    };

    useEffect(() => {
        let active = true;
        const loadInitial = async () => {
            const [rows, userRows, status] = await Promise.all([
                getSpecialists(true),
                getSpecialistAssignableUsers(),
                loadGoogleCalendarSources().catch(() => []),
            ]);
            if (!active) return;
            setSpecialists(rows);
            setUsers(userRows);
            setGoogleSources(status);
        };

        void loadInitial();
        return () => {
            active = false;
        };
    }, []);

    const handleEdit = (specialist: SpecialistRow) => {
        setForm({
            id: specialist.id,
            name: specialist.name,
            displayName: specialist.displayName || "",
            specialty: specialist.specialty || "Oftalmologia",
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
        });
    };

    const handlePhotoUpload = async (event: ChangeEvent<HTMLInputElement>) => {
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
            await load();
        });
    };

    const handleSync = () => {
        startTransition(async () => {
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
            toast({ title: "Bloqueo guardado" });
            await load();
        });
    };

    const handleDeleteBlock = (id: string) => {
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
        <div className="space-y-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <h2 className="font-semibold">Especialistas</h2>
                    <p className="text-sm text-muted-foreground">
                        Administra hasta 5 agendas clinicas y sus bloqueos operativos.
                    </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                    <Button variant="outline" onClick={load} disabled={isPending}>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Refrescar
                    </Button>
                    <Button onClick={handleSync} disabled={isPending}>
                        {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                        Sync Google
                    </Button>
                </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,0.92fr)_minmax(360px,0.48fr)]">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center justify-between gap-3 text-base">
                            <span>Listado</span>
                            <Badge variant={activeCount >= 5 ? "destructive" : "secondary"}>{activeCount}/5 activos</Badge>
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {specialists.map((specialist) => (
                            <div key={specialist.id} className="rounded-2xl border p-4">
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                    <div className="flex min-w-0 gap-3">
                                        <div
                                            className="h-14 w-14 shrink-0 rounded-full border bg-muted bg-cover bg-center"
                                            style={{ backgroundImage: `url("${specialist.photoUrl || DEFAULT_OPHTHALMOLOGIST_IMAGE}")` }}
                                            role="img"
                                            aria-label={`Foto de ${specialist.displayName || specialist.name}`}
                                        />
                                        <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span
                                                className="h-3 w-3 rounded-full"
                                                style={{ backgroundColor: specialist.color || "#2563EB" }}
                                            />
                                            <h3 className="font-semibold">{specialist.displayName || specialist.name}</h3>
                                            <Badge variant={specialist.isActive ? "secondary" : "outline"}>
                                                {specialist.isActive ? "Activo" : "Inactivo"}
                                            </Badge>
                                            {specialist.googleCalendarSource ? <Badge variant="outline">Google</Badge> : null}
                                        </div>
                                        <p className="mt-1 text-sm text-muted-foreground">
                                            {specialist.specialty || "Oftalmologia"} · {specialist.defaultDurationMinutes} min · {specialist.room || "Sin consultorio"}
                                        </p>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            {specialist._count.appointments} citas · {specialist._count.availabilityBlocks} bloqueos
                                        </p>
                                    </div>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <Button size="sm" variant="outline" onClick={() => handleEdit(specialist)}>
                                            Editar
                                        </Button>
                                        {specialist.isActive ? (
                                            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => handleDeactivate(specialist.id)}>
                                                Desactivar
                                            </Button>
                                        ) : (
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                className="text-destructive hover:text-destructive"
                                                onClick={() => setSpecialistToDelete(specialist)}
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
                                                <Button size="sm" variant="ghost" className="h-7 text-destructive hover:text-destructive" onClick={() => handleDeleteBlock(block.id)}>
                                                    <X className="mr-1 h-3 w-3" />
                                                    Quitar
                                                </Button>
                                            </div>
                                        ))}
                                    </div>
                                ) : null}
                            </div>
                        ))}

                        {specialists.length === 0 ? (
                            <div className="rounded-2xl border border-dashed px-4 py-8 text-sm text-muted-foreground">
                                Todavia no hay especialistas. Puedes crearlos aqui o marcarlos desde Google Calendar.
                            </div>
                        ) : null}
                    </CardContent>
                </Card>

                <div className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-base">
                                <UserRound className="h-5 w-5 text-primary" />
                                {form.id ? "Editar especialista" : "Nuevo especialista"}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="rounded-2xl border bg-muted/15 p-4">
                                <div className="flex flex-col gap-4 sm:flex-row">
                                    <div
                                        className="h-28 w-28 shrink-0 rounded-2xl border bg-background bg-cover bg-center shadow-inner"
                                        style={{ backgroundImage: `url("${form.photoUrl || DEFAULT_OPHTHALMOLOGIST_IMAGE}")` }}
                                        role="img"
                                        aria-label="Vista previa de la foto del especialista"
                                    />
                                    <div className="min-w-0 flex-1 space-y-3">
                                        <div>
                                            <Label>Foto del especialista</Label>
                                            <p className="mt-1 text-xs text-muted-foreground">
                                                Si queda vacio, se mostrara la imagen default oftalmologica.
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
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-2">
                                    <Label>Nombre</Label>
                                    <Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
                                </div>
                                <div className="space-y-2">
                                    <Label>Nombre visible</Label>
                                    <Input value={form.displayName} onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))} />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-2">
                                    <Label>Email</Label>
                                    <Input type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
                                </div>
                                <div className="space-y-2">
                                    <Label>Telefono</Label>
                                    <PhonePrefixInput
                                        value={form.phone}
                                        onChange={(value) => setForm((current) => ({ ...current, phone: value }))}
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-2">
                                    <Label>Especialidad</Label>
                                    <Input value={form.specialty} onChange={(event) => setForm((current) => ({ ...current, specialty: event.target.value }))} />
                                </div>
                                <div className="space-y-2">
                                    <Label>Consultorio</Label>
                                    <Input value={form.room} onChange={(event) => setForm((current) => ({ ...current, room: event.target.value }))} />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-2">
                                    <Label>Titulo profesional</Label>
                                    <Input
                                        value={form.professionalTitle}
                                        onChange={(event) => setForm((current) => ({ ...current, professionalTitle: event.target.value }))}
                                        placeholder="Medico Oftalmologo"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Cedula profesional</Label>
                                    <Input
                                        value={form.professionalLicense}
                                        onChange={(event) => setForm((current) => ({ ...current, professionalLicense: event.target.value }))}
                                        placeholder="Ced. Prof. 0000000"
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-2">
                                    <Label>Duracion default</Label>
                                    <Input
                                        type="number"
                                        min={15}
                                        max={180}
                                        value={form.defaultDurationMinutes}
                                        onChange={(event) => setForm((current) => ({ ...current, defaultDurationMinutes: Number(event.target.value) }))}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Color</Label>
                                    <Input type="color" value={form.color} onChange={(event) => setForm((current) => ({ ...current, color: event.target.value }))} />
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
                                    Vincula el login con este perfil para recetas, citas atendidas y notificaciones del profesional.
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
                                <Label>Perfil profesional</Label>
                                <Textarea
                                    value={form.bio}
                                    onChange={(event) => setForm((current) => ({ ...current, bio: event.target.value }))}
                                    placeholder="Resumen breve del perfil, enfoque clínico o indicaciones visibles para clientes."
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
                            <div className="flex gap-2">
                                <Button onClick={handleSave} disabled={isPending || isUploadingPhoto || !form.name} className="flex-1">
                                    {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                    Guardar
                                </Button>
                                {form.id ? (
                                    <Button variant="outline" onClick={() => setForm(EMPTY_FORM)}>
                                        Cancelar
                                    </Button>
                                ) : null}
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-base">
                                <CalendarOff className="h-5 w-5 text-primary" />
                                Bloquear agenda
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
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
                                <Label>Titulo</Label>
                                <Input value={blockForm.title} onChange={(event) => setBlockForm((current) => ({ ...current, title: event.target.value }))} />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-2">
                                    <Label>Inicio</Label>
                                    <Input type="datetime-local" value={blockForm.startTime} onChange={(event) => setBlockForm((current) => ({ ...current, startTime: event.target.value }))} />
                                </div>
                                <div className="space-y-2">
                                    <Label>Fin</Label>
                                    <Input type="datetime-local" value={blockForm.endTime} onChange={(event) => setBlockForm((current) => ({ ...current, endTime: event.target.value }))} />
                                </div>
                            </div>
                            <Button onClick={handleSaveBlock} disabled={isPending || !blockForm.title} className="w-full">
                                Guardar bloqueo
                            </Button>
                        </CardContent>
                    </Card>
                </div>
            </div>

            <Dialog open={Boolean(specialistToDelete)} onOpenChange={(open) => !open && setSpecialistToDelete(null)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Eliminar especialista definitivamente</DialogTitle>
                        <DialogDescription>
                            Vas a eliminar a {specialistToDelete?.displayName || specialistToDelete?.name}. Esta acción no se puede deshacer. Si tiene citas, atenciones o cobros, el sistema conservará el perfil inactivo para proteger el historial.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button type="button" variant="outline" onClick={() => setSpecialistToDelete(null)} disabled={isPending}>
                            Cancelar
                        </Button>
                        <Button type="button" variant="destructive" onClick={handleDelete} disabled={isPending}>
                            {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                            Eliminar definitivamente
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
