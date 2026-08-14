"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Check, Loader2, Search, Send, UserPlus, Users } from "lucide-react";
import {
    getPortalShareClients,
    sharePortalByWhatsApp,
    type PortalShareClient,
} from "@/app/actions/portal-sharing";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhonePrefixInput } from "@/components/shared/phone-prefix-input";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

type RecipientMode = "existing" | "new";

export function PortalShareDialog({ portalUrl }: { portalUrl: string }) {
    const { toast } = useToast();
    const [open, setOpen] = useState(false);
    const [mode, setMode] = useState<RecipientMode>("existing");
    const [clients, setClients] = useState<PortalShareClient[]>([]);
    const [query, setQuery] = useState("");
    const [selectedClientId, setSelectedClientId] = useState("");
    const [name, setName] = useState("");
    const [phone, setPhone] = useState("");
    const [isLoadingClients, setIsLoadingClients] = useState(false);
    const [isPending, startTransition] = useTransition();

    useEffect(() => {
        if (!open) return;
        let active = true;
        getPortalShareClients()
            .then((rows) => {
                if (active) setClients(rows);
            })
            .catch(() => {
                if (active) {
                    toast({
                        title: "No se pudieron cargar los clientes",
                        variant: "destructive",
                    });
                }
            })
            .finally(() => {
                if (active) setIsLoadingClients(false);
            });

        return () => {
            active = false;
        };
    }, [open, toast]);

    const filteredClients = useMemo(() => {
        const normalized = query.trim().toLowerCase();
        if (!normalized) return clients;
        return clients.filter((client) =>
            `${client.name} ${client.phone}`.toLowerCase().includes(normalized),
        );
    }, [clients, query]);

    const reset = () => {
        setMode("existing");
        setQuery("");
        setSelectedClientId("");
        setName("");
        setPhone("");
    };

    const sendPortal = () => {
        if (mode === "existing" && !selectedClientId) {
            toast({ title: "Selecciona un cliente", variant: "destructive" });
            return;
        }
        if (mode === "new" && (!name.trim() || !phone)) {
            toast({ title: "Captura el nombre y teléfono", variant: "destructive" });
            return;
        }

        startTransition(async () => {
            const result = await sharePortalByWhatsApp({
                portalUrl,
                contactId: mode === "existing" ? selectedClientId : undefined,
                name: mode === "new" ? name : undefined,
                phone: mode === "new" ? phone : undefined,
            });

            if (!result.success) {
                toast({
                    title: result.clientCreated ? "Cliente guardado, enlace no enviado" : "No se pudo enviar",
                    description: result.error,
                    variant: "destructive",
                });
                return;
            }

            toast({
                title: "Portal enviado por WhatsApp",
                description: `El enlace se envió a ${result.clientName}.`,
            });
            setOpen(false);
            reset();
        });
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(nextOpen) => {
                if (nextOpen) setIsLoadingClients(true);
                setOpen(nextOpen);
                if (!nextOpen) reset();
            }}
        >
            <DialogTrigger asChild>
                <Button type="button" className="w-full sm:w-auto">
                    <Send className="mr-2 h-4 w-4" />
                    Compartir por WhatsApp
                </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>Compartir portal de reservas</DialogTitle>
                    <DialogDescription>
                        Elige un cliente existente o registra uno nuevo. El enlace quedará guardado en su chat.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted/60 p-1">
                    <button
                        type="button"
                        onClick={() => setMode("existing")}
                        className={cn(
                            "flex h-10 items-center justify-center gap-2 rounded-lg text-sm font-medium transition",
                            mode === "existing" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
                        )}
                    >
                        <Users className="h-4 w-4" />
                        Cliente existente
                    </button>
                    <button
                        type="button"
                        onClick={() => setMode("new")}
                        className={cn(
                            "flex h-10 items-center justify-center gap-2 rounded-lg text-sm font-medium transition",
                            mode === "new" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
                        )}
                    >
                        <UserPlus className="h-4 w-4" />
                        Cliente nuevo
                    </button>
                </div>

                {mode === "existing" ? (
                    <div className="space-y-3">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                value={query}
                                onChange={(event) => setQuery(event.target.value)}
                                placeholder="Buscar por nombre o teléfono"
                                className="pl-9"
                            />
                        </div>
                        <div className="max-h-64 space-y-2 overflow-y-auto rounded-xl border p-2">
                            {isLoadingClients ? (
                                <div className="flex h-24 items-center justify-center text-muted-foreground">
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando clientes...
                                </div>
                            ) : filteredClients.length === 0 ? (
                                <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
                                    No se encontraron clientes.
                                </div>
                            ) : (
                                filteredClients.map((client) => {
                                    const selected = selectedClientId === client.id;
                                    return (
                                        <button
                                            type="button"
                                            key={client.id}
                                            onClick={() => setSelectedClientId(client.id)}
                                            className={cn(
                                                "flex w-full items-center justify-between rounded-xl border px-3 py-3 text-left transition",
                                                selected ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                                            )}
                                        >
                                            <span className="min-w-0">
                                                <span className="block truncate text-sm font-medium">{client.name}</span>
                                                <span className="block text-xs text-muted-foreground">+{client.phone}</span>
                                            </span>
                                            <span
                                                className={cn(
                                                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
                                                    selected && "border-primary bg-primary text-primary-foreground",
                                                )}
                                            >
                                                {selected ? <Check className="h-4 w-4" /> : null}
                                            </span>
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="space-y-4 rounded-2xl border bg-muted/15 p-4">
                        <div className="space-y-2">
                            <Label htmlFor="portal-client-name">Nombre</Label>
                            <Input
                                id="portal-client-name"
                                value={name}
                                onChange={(event) => setName(event.target.value)}
                                placeholder="Nombre completo"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Teléfono</Label>
                            <PhonePrefixInput value={phone} onChange={setPhone} required />
                            <p className="text-xs text-muted-foreground">
                                Escribe los 10 dígitos. El prefijo del país se agrega automáticamente.
                            </p>
                        </div>
                    </div>
                )}

                <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
                        Cancelar
                    </Button>
                    <Button type="button" onClick={sendPortal} disabled={isPending || !portalUrl}>
                        {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                        Enviar enlace
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
