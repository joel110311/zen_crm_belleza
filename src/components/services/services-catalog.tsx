"use client";

import { useMemo, useState, useTransition, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import {
    Check,
    Clock3,
    FolderPlus,
    Image as ImageIcon,
    Loader2,
    Pencil,
    Plus,
    Scissors,
    Trash2,
    Upload,
    UserRound,
} from "lucide-react";
import {
    deleteService,
    deleteServiceCategory,
    getServicesCatalog,
    saveService,
    saveServiceCategory,
    updateServiceFlags,
} from "@/app/actions/services";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import {
    EMPTY_SERVICE_PREPARATION,
    SERVICE_AFTERCARE_LABELS,
    SERVICE_AFTERCARE_OPTIONS,
    SERVICE_BOOKING_QUESTION_LABELS,
    SERVICE_BOOKING_QUESTIONS,
    SERVICE_PREPARATION_LABELS,
    SERVICE_PREPARATION_OPTIONS,
    normalizeServicePreparation,
    type ServicePreparationRequirements,
} from "@/lib/services/preparation-requirements";

type CatalogPayload = Awaited<ReturnType<typeof getServicesCatalog>>;
type Category = CatalogPayload["categories"][number];
type Service = Category["services"][number];
type Specialist = CatalogPayload["specialists"][number];

type ServiceForm = {
    id?: string;
    name: string;
    description: string;
    categoryId: string;
    price: string;
    currency: string;
    durationMinutes: string;
    preparationRequirements: ServicePreparationRequirements;
    imageUrl: string;
    showPrice: boolean;
    specialistIds: string[];
    isFeatured: boolean;
    isActive: boolean;
};

type CategoryForm = {
    id?: string;
    name: string;
    description: string;
    color: string;
    isActive: boolean;
};

const EMPTY_SERVICE_FORM: ServiceForm = {
    name: "",
    description: "",
    categoryId: "",
    price: "",
    currency: "MXN",
    durationMinutes: "30",
    preparationRequirements: EMPTY_SERVICE_PREPARATION,
    imageUrl: "",
    showPrice: true,
    specialistIds: [],
    isFeatured: false,
    isActive: true,
};

const EMPTY_CATEGORY_FORM: CategoryForm = {
    name: "",
    description: "",
    color: "#B7923A",
    isActive: true,
};

function specialistName(specialist: Specialist) {
    return specialist.displayName || specialist.name;
}

function specialistRole(specialist: Specialist) {
    const specialty = specialist.specialty?.trim();
    return specialty && !specialty.toLocaleLowerCase("es-MX").includes("oftalm")
        ? specialty
        : "Profesional de belleza";
}

function formatMoney(value: number, currency: string) {
    return new Intl.NumberFormat("es-MX", {
        style: "currency",
        currency: currency || "MXN",
        maximumFractionDigits: value % 1 === 0 ? 0 : 2,
    }).format(value);
}

function serviceToForm(service: Service): ServiceForm {
    return {
        id: service.id,
        name: service.name,
        description: service.description || "",
        categoryId: service.categoryId,
        price: String(service.price),
        currency: service.currency,
        durationMinutes: String(service.durationMinutes),
        preparationRequirements: normalizeServicePreparation(service.preparationRequirements),
        imageUrl: service.imageUrl || "",
        showPrice: service.showPrice,
        specialistIds: service.specialists.map((entry) => entry.specialistId),
        isFeatured: service.isFeatured,
        isActive: service.isActive,
    };
}

export function ServicesCatalog({ initialData }: { initialData: CatalogPayload }) {
    const router = useRouter();
    const { toast } = useToast();
    const [isPending, startTransition] = useTransition();
    const [activeTab, setActiveTab] = useState("services");
    const [serviceDialogOpen, setServiceDialogOpen] = useState(false);
    const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
    const [serviceForm, setServiceForm] = useState<ServiceForm>(EMPTY_SERVICE_FORM);
    const [categoryForm, setCategoryForm] = useState<CategoryForm>(EMPTY_CATEGORY_FORM);

    const services = useMemo(() => initialData.categories.flatMap((category) => category.services), [initialData.categories]);

    const refresh = () => startTransition(() => router.refresh());

    const openNewService = () => {
        if (initialData.categories.length === 0) {
            setActiveTab("categories");
            setCategoryForm(EMPTY_CATEGORY_FORM);
            setCategoryDialogOpen(true);
            toast({ title: "Primero crea una categoría", description: "Después podrás añadir servicios y asignar especialistas." });
            return;
        }
        setServiceForm({ ...EMPTY_SERVICE_FORM, categoryId: initialData.categories[0].id });
        setServiceDialogOpen(true);
    };

    const submitService = () => startTransition(async () => {
        const result = await saveService({
            ...serviceForm,
            price: Number(serviceForm.price || 0),
            durationMinutes: Number(serviceForm.durationMinutes || 30),
        });
        if (!result.success) {
            toast({ title: "No se pudo guardar", description: result.error, variant: "destructive" });
            return;
        }
        toast({ title: serviceForm.id ? "Servicio actualizado" : "Servicio creado" });
        setServiceDialogOpen(false);
        router.refresh();
    });

    const submitCategory = () => startTransition(async () => {
        const result = await saveServiceCategory(categoryForm);
        if (!result.success) {
            toast({ title: "No se pudo guardar", description: result.error, variant: "destructive" });
            return;
        }
        toast({ title: categoryForm.id ? "Categoría actualizada" : "Categoría creada" });
        setCategoryDialogOpen(false);
        router.refresh();
    });

    const removeService = (service: Service) => {
        if (!confirm(`¿Eliminar el servicio "${service.name}"? Las citas anteriores conservarán su descripción.`)) return;
        startTransition(async () => {
            const result = await deleteService(service.id);
            if (!result.success) {
                toast({ title: "No se pudo eliminar", description: result.error, variant: "destructive" });
                return;
            }
            toast({ title: "Servicio eliminado" });
            router.refresh();
        });
    };

    const removeCategory = (category: Category) => {
        if (!confirm(`¿Eliminar la categoría "${category.name}"?`)) return;
        startTransition(async () => {
            const result = await deleteServiceCategory(category.id);
            if (!result.success) {
                toast({ title: "No se pudo eliminar", description: result.error, variant: "destructive" });
                return;
            }
            toast({ title: "Categoría eliminada" });
            router.refresh();
        });
    };

    const updateFlags = (service: Service, flags: { isFeatured?: boolean; isActive?: boolean }) => {
        startTransition(async () => {
            const result = await updateServiceFlags(service.id, flags);
            if (!result.success) {
                toast({ title: "No se pudo actualizar", description: result.error, variant: "destructive" });
                return;
            }
            refresh();
        });
    };

    return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div className="shrink-0 border-b border-border px-5 py-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <div className="flex items-center gap-2">
                            <Scissors className="h-5 w-5 text-primary" />
                            <h1 className="text-2xl font-bold tracking-tight">Servicios</h1>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">Catálogo, precios, tiempos y profesionales que pueden realizar cada servicio.</p>
                    </div>
                    <Button className="h-10 rounded-xl" onClick={openNewService} disabled={isPending}>
                        <Plus className="mr-2 h-4 w-4" /> Añadir servicio
                    </Button>
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="min-h-0 flex-1 overflow-hidden px-5 pt-4">
                <TabsList>
                    <TabsTrigger value="services">Servicios ({services.length})</TabsTrigger>
                    <TabsTrigger value="categories">Categorías ({initialData.categories.length})</TabsTrigger>
                </TabsList>

                <TabsContent value="services" className="mt-3 h-[calc(100%-3.25rem)] overflow-y-auto pb-6">
                    {services.length === 0 ? (
                        <EmptyState title="Todavía no hay servicios" description="Crea el primero con precio, duración y profesionales asignados." actionLabel="Añadir servicio" onAction={openNewService} />
                    ) : (
                        <div className="space-y-4">
                            {initialData.categories.map((category) => category.services.length > 0 ? (
                                <section key={category.id}>
                                    <div className="mb-2 flex items-center gap-2">
                                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: category.color || "#B7923A" }} />
                                        <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">{category.name}</h2>
                                        {!category.isActive ? <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">Oculta</span> : null}
                                    </div>
                                    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                                        {category.services.map((service) => (
                                            <ServiceCard
                                                key={service.id}
                                                service={service}
                                                pending={isPending}
                                                onEdit={() => {
                                                    setServiceForm(serviceToForm(service));
                                                    setServiceDialogOpen(true);
                                                }}
                                                onDelete={() => removeService(service)}
                                                onActiveChange={(value) => updateFlags(service, { isActive: value })}
                                            />
                                        ))}
                                    </div>
                                </section>
                            ) : null)}
                        </div>
                    )}
                </TabsContent>

                <TabsContent value="categories" className="mt-3 h-[calc(100%-3.25rem)] overflow-y-auto pb-6">
                    <div className="mb-3 flex justify-end">
                        <Button variant="outline" onClick={() => { setCategoryForm(EMPTY_CATEGORY_FORM); setCategoryDialogOpen(true); }}>
                            <FolderPlus className="mr-2 h-4 w-4" /> Nueva categoría
                        </Button>
                    </div>
                    {initialData.categories.length === 0 ? (
                        <EmptyState title="Sin categorías" description="Organiza los servicios por familias como Cabello, Uñas, Facial o Paquetes." actionLabel="Crear categoría" onAction={() => setCategoryDialogOpen(true)} />
                    ) : (
                        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
                            {initialData.categories.map((category) => (
                                <div key={category.id} className="rounded-xl border border-border bg-background p-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: category.color || "#B7923A" }} />
                                                <h3 className="truncate font-semibold">{category.name}</h3>
                                            </div>
                                            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{category.description || "Sin descripción"}</p>
                                        </div>
                                        <span className={cn("rounded-full px-2 py-1 text-xs font-semibold", category.isActive ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground")}>{category.isActive ? "Activa" : "Oculta"}</span>
                                    </div>
                                    <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
                                        <span className="text-sm text-muted-foreground">{category.services.length} servicio(s)</span>
                                        <div className="flex gap-1">
                                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setCategoryForm({ id: category.id, name: category.name, description: category.description || "", color: category.color || "#B7923A", isActive: category.isActive }); setCategoryDialogOpen(true); }} aria-label={`Editar categoría ${category.name}`}><Pencil className="h-4 w-4" /></Button>
                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeCategory(category)} aria-label={`Eliminar categoría ${category.name}`}><Trash2 className="h-4 w-4" /></Button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </TabsContent>
            </Tabs>

            <ServiceDialog
                open={serviceDialogOpen}
                onOpenChange={setServiceDialogOpen}
                form={serviceForm}
                setForm={setServiceForm}
                categories={initialData.categories}
                specialists={initialData.specialists}
                pending={isPending}
                onSubmit={submitService}
            />
            <CategoryDialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen} form={categoryForm} setForm={setCategoryForm} pending={isPending} onSubmit={submitCategory} />
        </div>
    );
}

function ServiceCard({ service, pending, onEdit, onDelete, onActiveChange }: { service: Service; pending: boolean; onEdit: () => void; onDelete: () => void; onActiveChange: (value: boolean) => void }) {
    const assignedSpecialist = service.specialists[0]?.specialist;
    const remainingSpecialists = Math.max(0, service.specialists.length - 1);
    const specialistNames = service.specialists
        .map(({ specialist }) => specialist.displayName || specialist.name)
        .join(", ");

    return (
        <article className={cn("rounded-xl border bg-card p-2.5 shadow-sm transition-[border-color,box-shadow] hover:border-primary/30 hover:shadow-md", !service.isActive && "border-dashed opacity-70")}>
            <div className="flex min-w-0 items-start gap-2.5">
                {service.imageUrl ? (
                    <img src={service.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg border object-cover" />
                ) : (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/5 text-primary">
                        <ImageIcon className="h-4 w-4" />
                    </span>
                )}
                <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-semibold leading-5 text-foreground">{service.name}</h3>
                    <p className="truncate text-xs leading-4 text-muted-foreground" title={service.description || "Sin descripción"}>{service.description || "Sin descripción"}</p>
                </div>
            </div>
            <div className="mt-2 flex min-w-0 items-center gap-2 border-t border-border pt-2">
                <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground"><Clock3 className="h-3.5 w-3.5" /> {service.durationMinutes} min</span>
                {service.showPrice ? (
                    <span className="shrink-0 text-sm font-bold text-foreground">{formatMoney(service.price, service.currency)}</span>
                ) : (
                    <span className="shrink-0 rounded-full border border-primary/15 bg-primary/5 px-1.5 py-0.5 text-[10px] font-medium text-primary">Precio oculto</span>
                )}
                <span
                    className="ml-auto inline-flex min-w-0 items-center gap-1 rounded-full bg-primary/8 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                    title={specialistNames || "Cualquier profesional"}
                >
                    <UserRound className="h-3 w-3 shrink-0" />
                    <span className="max-w-28 truncate">{assignedSpecialist ? (assignedSpecialist.displayName || assignedSpecialist.name) : "Cualquier profesional"}</span>
                    {remainingSpecialists > 0 ? <span className="shrink-0">+{remainingSpecialists}</span> : null}
                </span>
                <label className="ml-0.5 flex shrink-0 items-center" title={service.isActive ? "Servicio activo" : "Servicio oculto"}><Switch size="sm" checked={service.isActive} onCheckedChange={onActiveChange} disabled={pending} /><span className="sr-only">{service.isActive ? "Activo" : "Oculto"}</span></label>
                <div className="flex shrink-0 gap-0.5"><Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit} aria-label={`Editar servicio ${service.name}`}><Pencil className="h-3.5 w-3.5" /></Button><Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={onDelete} aria-label={`Eliminar servicio ${service.name}`}><Trash2 className="h-3.5 w-3.5" /></Button></div>
            </div>
        </article>
    );
}

function ServiceDialog({ open, onOpenChange, form, setForm, categories, specialists, pending, onSubmit }: { open: boolean; onOpenChange: (open: boolean) => void; form: ServiceForm; setForm: React.Dispatch<React.SetStateAction<ServiceForm>>; categories: Category[]; specialists: Specialist[]; pending: boolean; onSubmit: () => void }) {
    const { toast } = useToast();
    const [isUploadingImage, setIsUploadingImage] = useState(false);
    const toggleSpecialist = (id: string) => setForm((current) => ({ ...current, specialistIds: current.specialistIds.includes(id) ? current.specialistIds.filter((entry) => entry !== id) : [...current.specialistIds, id] }));
    const togglePreparation = (option: ServicePreparationRequirements["options"][number]) => setForm((current) => ({
        ...current,
        preparationRequirements: {
            ...current.preparationRequirements,
            options: current.preparationRequirements.options.includes(option)
                ? current.preparationRequirements.options.filter((entry) => entry !== option)
                : [...current.preparationRequirements.options, option],
        },
    }));
    const toggleBookingQuestion = (option: ServicePreparationRequirements["bookingQuestions"][number]) => setForm((current) => ({
        ...current,
        preparationRequirements: {
            ...current.preparationRequirements,
            bookingQuestions: current.preparationRequirements.bookingQuestions.includes(option)
                ? current.preparationRequirements.bookingQuestions.filter((entry) => entry !== option)
                : [...current.preparationRequirements.bookingQuestions, option],
        },
    }));
    const toggleAftercare = (option: ServicePreparationRequirements["aftercareOptions"][number]) => setForm((current) => ({
        ...current,
        preparationRequirements: {
            ...current.preparationRequirements,
            aftercareOptions: current.preparationRequirements.aftercareOptions.includes(option)
                ? current.preparationRequirements.aftercareOptions.filter((entry) => entry !== option)
                : [...current.preparationRequirements.aftercareOptions, option],
        },
    }));
    const uploadImage = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        setIsUploadingImage(true);
        try {
            const upload = new FormData();
            upload.append("file", file);
            const response = await fetch("/api/upload", { method: "POST", body: upload });
            const result = await response.json() as { success?: boolean; url?: string; mediaCategory?: string; error?: string };
            if (!response.ok || !result.success || !result.url || result.mediaCategory !== "image") {
                throw new Error(result.error || "No se pudo subir la imagen.");
            }
            setForm((current) => ({ ...current, imageUrl: result.url || "" }));
            toast({ title: "Foto del servicio cargada" });
        } catch (error) {
            toast({ title: "No se pudo cargar la foto", description: error instanceof Error ? error.message : "Intenta nuevamente.", variant: "destructive" });
        } finally {
            setIsUploadingImage(false);
            event.target.value = "";
        }
    };
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                <DialogHeader><DialogTitle>{form.id ? "Editar servicio" : "Nuevo servicio"}</DialogTitle></DialogHeader>
                <div className="grid gap-4 py-2">
                    <div className="rounded-xl border border-border p-3">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                            <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-primary/15 bg-primary/5">
                                {form.imageUrl ? <img src={form.imageUrl} alt="Vista previa del servicio" className="h-full w-full object-cover" /> : <ImageIcon className="h-7 w-7 text-muted-foreground" />}
                            </div>
                            <div className="min-w-0 flex-1">
                                <Label>Foto del servicio (opcional)</Label>
                                <p className="mt-1 text-xs text-muted-foreground">Se muestra en el listado del portal de reservas.</p>
                                <div className="mt-3 flex flex-wrap gap-2">
                                    <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border bg-card px-3 text-sm font-medium hover:border-primary/40 hover:bg-primary/5">
                                        {isUploadingImage ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                                        {form.imageUrl ? "Cambiar foto" : "Subir foto"}
                                        <input type="file" accept="image/*" className="hidden" onChange={uploadImage} disabled={isUploadingImage} />
                                    </label>
                                    {form.imageUrl ? <Button type="button" variant="outline" size="sm" className="text-destructive" onClick={() => setForm((current) => ({ ...current, imageUrl: "" }))}><Trash2 className="mr-2 h-4 w-4" />Quitar</Button> : null}
                                </div>
                            </div>
                        </div>
                        <label className="mt-3 flex cursor-pointer items-start gap-3 border-t pt-3">
                            <Checkbox checked={form.showPrice} onCheckedChange={(checked) => setForm((current) => ({ ...current, showPrice: Boolean(checked) }))} className="mt-0.5" />
                            <span><span className="block text-sm font-medium">Mostrar precio en el portal</span><span className="text-xs text-muted-foreground">Desmárcalo para conservar el precio interno sin publicarlo.</span></span>
                        </label>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2"><Field label="Nombre *"><Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Ej. Corte y peinado" /></Field><Field label="Categoría *"><Select value={form.categoryId} onValueChange={(categoryId) => setForm((current) => ({ ...current, categoryId }))}><SelectTrigger><SelectValue placeholder="Selecciona categoría" /></SelectTrigger><SelectContent>{categories.map((category) => <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>)}</SelectContent></Select></Field></div>
                    <Field label="Descripción"><Textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="Qué incluye el servicio..." rows={3} /></Field>
                    <div className="grid gap-4 sm:grid-cols-3"><Field label="Precio"><Input type="number" min="0" step="0.01" value={form.price} onChange={(event) => setForm((current) => ({ ...current, price: event.target.value }))} /></Field><Field label="Moneda"><Select value={form.currency} onValueChange={(currency) => setForm((current) => ({ ...current, currency }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="MXN">MXN</SelectItem><SelectItem value="USD">USD</SelectItem></SelectContent></Select></Field><Field label="Duración (min)"><Input type="number" min="5" max="480" step="5" value={form.durationMinutes} onChange={(event) => setForm((current) => ({ ...current, durationMinutes: event.target.value }))} /></Field></div>
                    <div className="space-y-3 rounded-xl border border-border p-3">
                        <div><Label>Preguntas antes de reservar</Label><p className="mt-1 text-xs text-muted-foreground">El asistente preguntará sólo lo marcado y únicamente cuando falte esa información.</p></div>
                        <div className="grid gap-2 sm:grid-cols-2">{SERVICE_BOOKING_QUESTIONS.map((option) => <label key={option} className="flex cursor-pointer items-start gap-2 rounded-lg border bg-background p-2.5 text-sm"><Checkbox checked={form.preparationRequirements.bookingQuestions.includes(option)} onCheckedChange={() => toggleBookingQuestion(option)} className="mt-0.5" /><span>{SERVICE_BOOKING_QUESTION_LABELS[option]}</span></label>)}</div>
                        <Field label="Pregunta adicional (opcional)"><Input maxLength={140} value={form.preparationRequirements.customBookingQuestion} onChange={(event) => setForm((current) => ({ ...current, preparationRequirements: { ...current.preparationRequirements, customBookingQuestion: event.target.value } }))} placeholder="Ej. ¿Qué tono desea aplicar?" /></Field>
                    </div>
                    <div className="space-y-3 rounded-xl border border-border p-3">
                        <div>
                            <Label>Preparación antes del servicio</Label>
                            <p className="mt-1 text-xs text-muted-foreground">Marca sólo las indicaciones que realmente aplican a este servicio.</p>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                            {SERVICE_PREPARATION_OPTIONS.map((option) => (
                                <label key={option} className="flex cursor-pointer items-start gap-2 rounded-lg border bg-background p-2.5 text-sm">
                                    <Checkbox checked={form.preparationRequirements.options.includes(option)} onCheckedChange={() => togglePreparation(option)} className="mt-0.5" />
                                    <span>{SERVICE_PREPARATION_LABELS[option]}</span>
                                </label>
                            ))}
                        </div>
                        <Field label="Indicación adicional (opcional, máximo 160 caracteres)">
                            <Input
                                maxLength={160}
                                value={form.preparationRequirements.additionalInstruction}
                                onChange={(event) => setForm((current) => ({
                                    ...current,
                                    preparationRequirements: {
                                        ...current.preparationRequirements,
                                        additionalInstruction: event.target.value,
                                    },
                                }))}
                                placeholder="Ej. Traer una foto de referencia"
                            />
                        </Field>
                    </div>
                    <div className="space-y-3 rounded-xl border border-border p-3">
                        <div><Label>Cuidados posteriores</Label><p className="mt-1 text-xs text-muted-foreground">Recomendaciones que el asistente puede dar al finalizar o cuando el cliente pregunte.</p></div>
                        <div className="grid gap-2 sm:grid-cols-2">{SERVICE_AFTERCARE_OPTIONS.map((option) => <label key={option} className="flex cursor-pointer items-start gap-2 rounded-lg border bg-background p-2.5 text-sm"><Checkbox checked={form.preparationRequirements.aftercareOptions.includes(option)} onCheckedChange={() => toggleAftercare(option)} className="mt-0.5" /><span>{SERVICE_AFTERCARE_LABELS[option]}</span></label>)}</div>
                        <Field label="Cuidado adicional (opcional)"><Input maxLength={180} value={form.preparationRequirements.additionalAftercareInstruction} onChange={(event) => setForm((current) => ({ ...current, preparationRequirements: { ...current.preparationRequirements, additionalAftercareInstruction: event.target.value } }))} placeholder="Ej. Aplicar el producto recomendado por el especialista" /></Field>
                    </div>
                    <div className="space-y-2">
                        <div>
                            <Label>Especialistas que realizan este servicio</Label>
                            <p className="mt-1 text-xs text-muted-foreground">Si no seleccionas ninguno, estará disponible con cualquier profesional.</p>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                            {specialists.map((specialist) => {
                                const selected = form.specialistIds.includes(specialist.id);
                                return (
                                    <button type="button" key={specialist.id} onClick={() => toggleSpecialist(specialist.id)} className={cn("flex items-center gap-3 rounded-xl border bg-card p-3 text-left transition-colors", selected ? "border-primary bg-primary/10" : "border-border hover:border-primary/35 hover:bg-primary/5", !specialist.isActive && "border-dashed opacity-65")}>
                                        <span className={cn("flex h-5 w-5 items-center justify-center rounded-md border", selected ? "border-primary bg-primary text-primary-foreground" : "border-border")}>{selected ? <Check className="h-3.5 w-3.5" /> : null}</span>
                                        <span className="min-w-0">
                                            <span className="block truncate text-sm font-semibold">{specialistName(specialist)}</span>
                                            <span className="block truncate text-xs text-muted-foreground">{specialistRole(specialist)}{!specialist.isActive ? " · Inactivo" : ""}</span>
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2"><label className="flex items-center justify-between rounded-xl border border-border p-3"><span><span className="block text-sm font-medium">Servicio activo</span><span className="text-xs text-muted-foreground">Visible para nuevas citas</span></span><Switch checked={form.isActive} onCheckedChange={(isActive) => setForm((current) => ({ ...current, isActive }))} /></label><label className="flex items-center justify-between rounded-xl border border-border p-3"><span><span className="block text-sm font-medium">Destacado</span><span className="text-xs text-muted-foreground">Aparece primero en el catálogo</span></span><Switch checked={form.isFeatured} onCheckedChange={(isFeatured) => setForm((current) => ({ ...current, isFeatured }))} /></label></div>
                </div>
                <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button><Button onClick={onSubmit} disabled={pending || !form.name.trim() || !form.categoryId}>{pending ? "Guardando..." : "Guardar servicio"}</Button></DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function CategoryDialog({ open, onOpenChange, form, setForm, pending, onSubmit }: { open: boolean; onOpenChange: (open: boolean) => void; form: CategoryForm; setForm: React.Dispatch<React.SetStateAction<CategoryForm>>; pending: boolean; onSubmit: () => void }) {
    return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>{form.id ? "Editar categoría" : "Nueva categoría"}</DialogTitle></DialogHeader><div className="grid gap-4 py-2"><Field label="Nombre *"><Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Ej. Cabello" /></Field><Field label="Descripción"><Textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} rows={3} /></Field><Field label="Color"><div className="flex gap-2"><Input type="color" className="w-14 p-1" value={form.color} onChange={(event) => setForm((current) => ({ ...current, color: event.target.value }))} /><Input value={form.color} onChange={(event) => setForm((current) => ({ ...current, color: event.target.value }))} /></div></Field><label className="flex items-center justify-between rounded-xl border border-border p-3"><span><span className="block text-sm font-medium">Categoría activa</span><span className="text-xs text-muted-foreground">Sus servicios podrán mostrarse al agendar</span></span><Switch checked={form.isActive} onCheckedChange={(isActive) => setForm((current) => ({ ...current, isActive }))} /></label></div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button><Button onClick={onSubmit} disabled={pending || !form.name.trim()}>{pending ? "Guardando..." : "Guardar categoría"}</Button></DialogFooter></DialogContent></Dialog>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="space-y-2"><Label>{label}</Label>{children}</div>; }

function EmptyState({ title, description, actionLabel, onAction }: { title: string; description: string; actionLabel: string; onAction: () => void }) { return <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-primary/25 bg-card p-8 text-center"><span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Scissors className="h-6 w-6" /></span><h3 className="font-semibold">{title}</h3><p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p><Button className="mt-4" onClick={onAction}><Plus className="mr-2 h-4 w-4" />{actionLabel}</Button></div>; }
