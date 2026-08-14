"use client";

import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import { deleteContactsBulk } from "@/app/actions/contacts";
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
import { useToast } from "@/components/ui/use-toast";
import { getContactFullName } from "@/lib/contact-name";

type BulkDeleteContact = {
    id: string;
    name?: string | null;
    lastName?: string | null;
    phone?: string | null;
};

type ContactsBulkDeleteDialogProps = {
    contacts: BulkDeleteContact[];
    onDeleted: () => void;
};

const DELETE_CONFIRMATION_TEXT = "ELIMINAR";

export function ContactsBulkDeleteDialog({
    contacts,
    onDeleted,
}: ContactsBulkDeleteDialogProps) {
    const { toast } = useToast();
    const [open, setOpen] = useState(false);
    const [confirmationText, setConfirmationText] = useState("");
    const [isPending, startTransition] = useTransition();

    const previewNames = useMemo(
        () => contacts.slice(0, 5).map((contact) => getContactFullName(contact, "Sin nombre")),
        [contacts],
    );

    const canDelete = contacts.length > 0 && confirmationText.trim().toUpperCase() === DELETE_CONFIRMATION_TEXT;

    const handleOpenChange = (nextOpen: boolean) => {
        setOpen(nextOpen);
        if (!nextOpen) {
            setConfirmationText("");
        }
    };

    const handleDelete = () => {
        if (!canDelete) {
            return;
        }

        startTransition(async () => {
            const result = await deleteContactsBulk(contacts.map((contact) => contact.id));

            if (!result.success) {
                toast({
                    title: "No se pudieron eliminar",
                    description: result.error || "Ocurrió un error al borrar los clientes seleccionados.",
                    variant: "destructive",
                });
                return;
            }

            toast({
                title: "Clientes eliminados",
                description: `Se eliminaron ${result.deletedCount} cliente${result.deletedCount === 1 ? "" : "s"}.`,
            });

            handleOpenChange(false);
            onDeleted();
        });
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>
                <Button
                    type="button"
                    variant="destructive"
                    className="h-10 rounded-xl px-4"
                    disabled={contacts.length === 0}
                >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Eliminar
                </Button>
            </DialogTrigger>

            <DialogContent className="max-w-xl rounded-2xl p-0">
                <div className="border-b border-border/60 px-6 py-5">
                    <DialogHeader className="text-left">
                        <div className="flex items-center gap-3">
                            <div className="rounded-2xl bg-destructive/10 p-2.5 text-destructive">
                                <AlertTriangle className="h-5 w-5" />
                            </div>
                            <div>
                                <DialogTitle>Eliminar clientes seleccionados</DialogTitle>
                                <DialogDescription className="mt-1">
                                    Esta acción eliminará clientes, conversaciones, mensajes, citas y oportunidades relacionadas.
                                </DialogDescription>
                            </div>
                        </div>
                    </DialogHeader>
                </div>

                <div className="space-y-4 px-6 py-5">
                    <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive/90">
                        Vas a eliminar <span className="font-semibold">{contacts.length}</span> cliente{contacts.length === 1 ? "" : "s"}.
                    </div>

                    <div className="rounded-2xl border bg-muted/20 p-4">
                        <p className="text-sm font-medium text-foreground">Primeros seleccionados</p>
                        <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                            {previewNames.map((name, index) => (
                                <p key={`${name}-${index}`}>{name}</p>
                            ))}
                            {contacts.length > previewNames.length ? (
                                <p>y {contacts.length - previewNames.length} mas...</p>
                            ) : null}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label htmlFor="bulk-delete-confirmation" className="text-sm font-medium text-foreground">
                            Escribe <span className="font-semibold">{DELETE_CONFIRMATION_TEXT}</span> para confirmar
                        </label>
                        <Input
                            id="bulk-delete-confirmation"
                            value={confirmationText}
                            onChange={(event) => setConfirmationText(event.target.value)}
                            placeholder={DELETE_CONFIRMATION_TEXT}
                            className="h-11 rounded-xl"
                        />
                    </div>
                </div>

                <DialogFooter className="border-t border-border/60 px-6 py-4">
                    <Button
                        type="button"
                        variant="outline"
                        className="rounded-xl"
                        onClick={() => handleOpenChange(false)}
                        disabled={isPending}
                    >
                        Cancelar
                    </Button>
                    <Button
                        type="button"
                        variant="destructive"
                        className="rounded-xl"
                        onClick={handleDelete}
                        disabled={!canDelete || isPending}
                    >
                        {isPending ? "Eliminando..." : "Eliminar definitivamente"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
