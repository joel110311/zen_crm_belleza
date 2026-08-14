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
import { Plus, Loader2 } from "lucide-react";
import { createDeal } from "@/app/actions/pipeline";
import { useState, useTransition } from "react";
import { useToast } from "@/components/ui/use-toast";
import type { PipelineStageData } from "./pipeline-board";

interface NewLeadDialogProps {
    stages: PipelineStageData[];
}

export function NewLeadDialog({ stages }: NewLeadDialogProps) {
    const [open, setOpen] = useState(false);
    const [isPending, startTransition] = useTransition();
    const { toast } = useToast();

    // Filter out closed stages for manual creation (include all active stages)
    const availableStages = stages.filter(
        (s) => !s.isClosedLost
    );

    // Default to first available stage
    const defaultStageId = availableStages[0]?.id || "";

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        const title = formData.get("title") as string;
        const value = parseFloat(formData.get("value") as string) || 0;
        const stageId = formData.get("stageId") as string || defaultStageId;
        const priority = formData.get("priority") as string || "medium";

        startTransition(async () => {
            const result = await createDeal({
                title,
                value,
                stageId,
                source: "manual",
                priority,
            });
            if (result && result.success) {
                toast({ title: "Éxito", description: "Lead creado correctamente." });
                setOpen(false);
            } else {
                toast({
                    title: "Error",
                    description: result?.error || "No se pudo crear el lead.",
                    variant: "destructive",
                });
            }
        });
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg">
                    <Plus className="mr-2 h-4 w-4" /> Nuevo Lead
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Agregar Nuevo Lead</DialogTitle>
                    <DialogDescription>
                        Crea una nueva oportunidad en el pipeline.
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit}>
                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="title" className="text-right">
                                Título
                            </Label>
                            <Input id="title" name="title" placeholder="Nombre del lead" className="col-span-3" required />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="value" className="text-right">
                                Valor ($)
                            </Label>
                            <Input id="value" name="value" type="number" placeholder="0" className="col-span-3" />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="stageId" className="text-right">
                                Etapa
                            </Label>
                            <select
                                id="stageId"
                                name="stageId"
                                defaultValue={defaultStageId}
                                className="col-span-3 h-9 px-3 text-sm rounded-md border border-border bg-background text-foreground"
                            >
                                {availableStages.map((s) => (
                                    <option key={s.id} value={s.id}>
                                        {s.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="priority" className="text-right">
                                Prioridad
                            </Label>
                            <select
                                id="priority"
                                name="priority"
                                defaultValue="medium"
                                className="col-span-3 h-9 px-3 text-sm rounded-md border border-border bg-background text-foreground"
                            >
                                <option value="low">Baja</option>
                                <option value="medium">Media</option>
                                <option value="high">Alta</option>
                            </select>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                            type="submit"
                            disabled={isPending}
                            className="bg-primary text-primary-foreground hover:bg-primary/90"
                        >
                            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {isPending ? "Guardando..." : "Crear Lead"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
