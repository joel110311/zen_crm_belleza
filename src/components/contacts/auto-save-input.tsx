"use client";

import { useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Loader2, Check } from "lucide-react";
import { useDebouncedCallback } from "use-debounce";
import { updateContact } from "@/app/actions/contacts";
import { PhonePrefixInput } from "@/components/shared/phone-prefix-input";
import { cn } from "@/lib/utils";

interface AutoSaveInputProps {
    id: string;
    field: string;
    initialValue: string | null | undefined;
    placeholder?: string;
    className?: string;
    label?: string;
}

export function AutoSaveInput({
    id,
    field,
    initialValue,
    placeholder,
    className,
    label
}: AutoSaveInputProps) {
    const [value, setValue] = useState(initialValue || "");
    const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
    const firstRender = useRef(true);

    const save = useDebouncedCallback(async (val: string) => {
        setStatus("saving");
        const res = await updateContact(id, { [field]: val });
        if (res.success) {
            setStatus("saved");
            setTimeout(() => setStatus("idle"), 2000);
        } else {
            console.error("AutoSave Error:", res.error);
            setStatus("error");
        }
    }, 1000);

    useEffect(() => {
        if (firstRender.current) {
            firstRender.current = false;
            return;
        }
        save(value);
    }, [value, save]);

    return (
        <div className={cn("relative group", className)}>
            {label && (
                <label className="text-xs font-semibold text-muted-foreground uppercase mb-1 block">
                    {label}
                </label>
            )}
            <div className="relative">
                {field === "phone" ? (
                    <PhonePrefixInput
                        value={value}
                        onChange={setValue}
                        placeholder={placeholder || "Telefono"}
                        inputClassName="pr-8 transition-colors focus:bg-background bg-transparent border-transparent hover:border-input focus:border-primary"
                    />
                ) : (
                    <Input
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        placeholder={placeholder}
                        className="pr-8 transition-colors focus:bg-background bg-transparent border-transparent hover:border-input focus:border-primary"
                    />
                )}
                <div className="absolute right-2 top-1/2 -translate-y-1/2">
                    {status === "saving" && (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    )}
                    {status === "saved" && (
                        <Check className="h-4 w-4 text-sky-400" />
                    )}
                    {status === "error" && (
                        <span className="text-red-500 text-xs">Error</span>
                    )}
                </div>
            </div>
        </div>
    );
}
