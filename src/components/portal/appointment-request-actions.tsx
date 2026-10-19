"use client";

import { CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AppointmentRequestActions({ disabled, onDecision }: {
    disabled: boolean;
    onDecision: (status: "confirmed" | "cancelled") => void;
}) {
    return <div className="flex flex-wrap gap-2">
        <Button disabled={disabled} onClick={() => { if (!disabled) onDecision("confirmed"); }}><CheckCircle2 className="size-4" />Confirmar</Button>
        <Button variant="outline" disabled={disabled} onClick={() => { if (!disabled) onDecision("cancelled"); }}><XCircle className="size-4" />Rechazar</Button>
    </div>;
}
