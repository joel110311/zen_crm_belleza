"use client";

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
import { Plus } from "lucide-react";
import { createContact } from "@/app/actions/contacts";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { useToast } from "@/components/ui/use-toast";
import { PhonePrefixInput } from "@/components/shared/phone-prefix-input";

function SubmitButton({ label }: { label: string }) {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" disabled={pending}>
            {pending ? "Guardando..." : label}
        </Button>
    );
}

type NewContactDialogProps = {
    triggerLabel?: string;
    triggerClassName?: string;
    title?: string;
    description?: string;
    submitLabel?: string;
    onCreated?: (result: { contactId: string; conversationId: string }) => void | Promise<void>;
};

export function NewContactDialog({
    triggerLabel = "Nuevo cliente",
    triggerClassName,
    title = "Nuevo cliente",
    description = "Captura únicamente los datos necesarios para atenderlo.",
    submitLabel = "Guardar cliente",
    onCreated,
}: NewContactDialogProps = {}) {
    const [open, setOpen] = useState(false);
    const [phone, setPhone] = useState("");

    const { toast } = useToast();

    async function handleSubmit(formData: FormData) {
        const result = await createContact(formData);
        if (result?.success && result.contact && result.conversationId) {
            toast({
                title: title === "Nuevo chat" ? "Chat creado" : "Cliente creado",
                description: title === "Nuevo chat"
                    ? "La conversación ya está disponible en tu bandeja."
                    : "Ya puedes usarlo en chats, campañas y agenda.",
            });
            setOpen(false);
            setPhone("");
            await onCreated?.({
                contactId: result.contact.id,
                conversationId: result.conversationId,
            });
        } else {
            const message = result && "error" in result && typeof result.error === "string"
                ? result.error
                : "No se pudo crear el cliente.";
            toast({ title: "Error", description: message, variant: "destructive" });
        }
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button className={triggerClassName}>
                    <Plus className="mr-2 h-4 w-4" /> {triggerLabel}
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>
                        {description}
                    </DialogDescription>
                </DialogHeader>
                <form action={handleSubmit}>
                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="name" className="text-right">
                                Nombre
                            </Label>
                            <Input id="name" name="name" placeholder="Nombre completo" className="col-span-3" required />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="phone" className="text-right">
                                Teléfono
                            </Label>
                            <div className="col-span-3">
                                <input type="hidden" name="phone" value={phone} />
                                <PhonePrefixInput value={phone} onChange={setPhone} required />
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <SubmitButton label={submitLabel} />
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
