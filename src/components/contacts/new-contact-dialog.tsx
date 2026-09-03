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

function SubmitButton() {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" disabled={pending}>
            {pending ? "Guardando..." : "Guardar cliente"}
        </Button>
    );
}

export function NewContactDialog() {
    const [open, setOpen] = useState(false);
    const [phone, setPhone] = useState("");

    const { toast } = useToast();

    async function handleSubmit(formData: FormData) {
        const result = await createContact(formData);
        if (result && result.success) {
            toast({ title: "Cliente creado", description: "Ya puedes usarlo en chats, campañas y agenda." });
            setOpen(false);
            setPhone("");
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
                <Button>
                    <Plus className="mr-2 h-4 w-4" /> Nuevo cliente
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Nuevo cliente</DialogTitle>
                    <DialogDescription>
                        Captura únicamente los datos necesarios para atenderlo.
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
                        <SubmitButton />
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
