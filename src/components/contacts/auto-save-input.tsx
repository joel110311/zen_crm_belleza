"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { hasAnyPermission, type AccessSubject } from "@/lib/permissions";
import { useWorkspaceAccess } from "@/components/layout/workspace-access-context";
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
  label,
}: AutoSaveInputProps) {
  const [value, setValue] = useState(initialValue || "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const { readOnly } = useWorkspaceAccess();
  const { data: session } = useSession();
  const disabled =
    readOnly ||
    !hasAnyPermission(session?.user as AccessSubject | undefined, [
      "contacts.manage",
      "patients.manage",
    ]);
  const inputId = `contact-${id}-${field}`;

  const save = useDebouncedCallback(async (val: string) => {
    if (disabled) return;
    setStatus("saving");
    try {
      const res = await updateContact(id, { [field]: val });
      if (!res.success) throw new Error(res.error);
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  }, 1000);
  const change = (next: string) => {
    if (disabled) return;
    setValue(next);
    setStatus("idle");
    save(next);
  };

  return (
    <div
      className={cn("relative group", className)}
      onBlur={() => {
        if (!disabled) save.flush();
      }}
    >
      {label && (
        <label
          htmlFor={inputId}
          className="text-xs font-semibold text-muted-foreground uppercase mb-2 block"
        >
          {label}
        </label>
      )}
      <div className="relative">
        {field === "phone" ? (
          <PhonePrefixInput
            value={value}
            onChange={change}
            inputId={inputId}
            disabled={disabled}
            placeholder={placeholder || "Telefono"}
            inputClassName="pr-8 transition-colors focus:bg-background bg-transparent border-transparent hover:border-input focus:border-primary"
          />
        ) : (
          <Input
            id={inputId}
            value={value}
            disabled={disabled}
            onChange={(e) => change(e.target.value)}
            placeholder={placeholder}
            className="pr-8 transition-colors focus:bg-background bg-transparent border-transparent hover:border-input focus:border-primary"
          />
        )}
        <div className="absolute right-2 top-1/2 -translate-y-1/2">
          {status === "saving" && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          )}
          {status === "saved" && <Check className="h-4 w-4 text-sky-400" />}
          {status === "error" && (
            <span className="text-red-500 text-xs">Error</span>
          )}
        </div>
      </div>
      <p
        aria-live="polite"
        className="mt-1 min-h-4 text-xs text-muted-foreground"
      >
        {disabled
          ? "Solo lectura"
          : status === "saved"
            ? "Guardado"
            : status === "saving"
              ? "Guardando…"
              : status === "error"
                ? "No se guardó. Vuelve a editar para reintentar."
                : "Se guarda automáticamente"}
      </p>
    </div>
  );
}
