"use client";

import { useState, useTransition } from "react";
import { Bot, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { updateSystemSettings } from "@/app/actions/settings";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

export function AgentAutopilotControl({ initialEnabled }: { initialEnabled: boolean }) {
    const [enabled, setEnabled] = useState(initialEnabled);
    const [isPending, startTransition] = useTransition();
    const router = useRouter();
    const { toast } = useToast();

    const handleToggle = (nextEnabled: boolean) => {
        const previousEnabled = enabled;
        setEnabled(nextEnabled);

        startTransition(async () => {
            const result = await updateSystemSettings({ isBotEnabled: nextEnabled });

            if (!result.success) {
                setEnabled(previousEnabled);
                toast({
                    title: "No se pudo cambiar el autopiloto",
                    description: "La configuración anterior continúa activa.",
                    variant: "destructive",
                });
                return;
            }

            toast({
                title: nextEnabled ? "Autopiloto activado" : "Autopiloto pausado",
                description: nextEnabled
                    ? "El agente puede responder automáticamente."
                    : "Los mensajes seguirán llegando, pero el agente no responderá solo.",
            });
            router.refresh();
        });
    };

    return (
        <div
            className={cn(
                "flex min-w-0 items-center gap-2 rounded-xl border px-2.5 py-1.5 shadow-sm transition-colors",
                enabled
                    ? "border-primary/25 bg-primary/8 text-primary"
                    : "border-border bg-muted/45 text-muted-foreground",
            )}
        >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-card/80">
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
            </span>
            <div className="hidden min-w-0 xl:block">
                <p className="truncate text-[11px] font-bold leading-tight text-foreground">Autopiloto</p>
                <p className="text-[10px] font-medium leading-tight">{enabled ? "Activo" : "Pausado"}</p>
            </div>
            <Switch
                checked={enabled}
                onCheckedChange={handleToggle}
                disabled={isPending}
                aria-label={enabled ? "Pausar autopiloto del agente" : "Activar autopiloto del agente"}
                title={enabled ? "Pausar autopiloto del agente" : "Activar autopiloto del agente"}
            />
        </div>
    );
}
