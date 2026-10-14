"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus, X, Tag as TagIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { addContactTag, removeContactTag } from "@/app/actions/contacts";
import { useSession } from "next-auth/react";
import { hasAnyPermission, type AccessSubject } from "@/lib/permissions";
import { useWorkspaceAccess } from "@/components/layout/workspace-access-context";
import { useToast } from "@/components/ui/use-toast";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface ContactTagsProps {
  contactId: string;
  contactTags: string[];
  dealTags: { name: string; color: string; dealTitle: string }[];
}

export function ContactTags({
  contactId,
  contactTags,
  dealTags,
}: ContactTagsProps) {
  const [isPending, startTransition] = useTransition();
  const [newTag, setNewTag] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const { readOnly } = useWorkspaceAccess();
  const { data: session } = useSession();
  const disabled =
    readOnly ||
    !hasAnyPermission(session?.user as AccessSubject | undefined, [
      "contacts.manage",
      "patients.manage",
    ]);
  const { toast } = useToast();

  const handleAddTag = () => {
    if (disabled || !newTag.trim()) return;
    startTransition(async () => {
      try {
        const result = await addContactTag(contactId, newTag);
        if (!result.success) throw new Error(result.error);
        setNewTag("");
        setIsOpen(false);
      } catch (error) {
        toast({
          title: "No se pudo guardar la etiqueta",
          description:
            error instanceof Error ? error.message : "Inténtalo de nuevo",
          variant: "destructive",
        });
      }
    });
  };

  const handleRemoveTag = (tag: string) => {
    if (disabled) return;
    startTransition(async () => {
      try {
        const result = await removeContactTag(contactId, tag);
        if (!result.success) throw new Error(result.error);
      } catch (error) {
        toast({
          title: "No se pudo quitar la etiqueta",
          description:
            error instanceof Error ? error.message : "Inténtalo de nuevo",
          variant: "destructive",
        });
      }
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Contact Tags Group */}
      <div>
        <label className="text-xs font-semibold text-muted-foreground uppercase mb-2 block">
          Etiquetas del cliente
        </label>
        <div className="flex flex-wrap gap-2">
          {contactTags.map((tag) => (
            <Badge
              key={tag}
              variant="secondary"
              className="flex max-w-full items-center gap-1 whitespace-normal break-all border border-primary/20 bg-primary/5 px-2.5 py-0.5 text-primary hover:bg-primary/10"
            >
              {tag}
              {!disabled ? (
                <button
                  aria-label={`Quitar etiqueta ${tag}`}
                  onClick={() => handleRemoveTag(tag)}
                  disabled={isPending}
                  className="ml-1 shrink-0 hover:text-red-500 rounded-full p-0.5 hover:bg-red-50 transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              ) : null}
            </Badge>
          ))}
          {!disabled ? (
            <Popover open={isOpen} onOpenChange={setIsOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 text-xs rounded-full border-dashed text-muted-foreground"
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Agregar
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-60 p-3" align="start">
                <div className="flex gap-2">
                  <Input
                    placeholder="Nueva etiqueta..."
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    className="h-8 text-sm"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddTag();
                    }}
                  />
                  <Button
                    size="sm"
                    className="h-8"
                    onClick={handleAddTag}
                    disabled={isPending}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          ) : null}
          {contactTags.length === 0 && disabled ? (
            <span className="text-sm text-muted-foreground">Sin etiquetas</span>
          ) : null}
        </div>
      </div>

      {/* Pipeline Tags Group (if any) */}
      {dealTags.length > 0 && (
        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase mb-2 block flex items-center gap-1">
            <TagIcon className="h-3 w-3" />
            Etiquetas de Negocios
          </label>
          <div className="flex flex-wrap gap-2">
            {dealTags.map((dt, i) => (
              <Badge
                key={i}
                className="max-w-full whitespace-normal break-all px-2.5 py-0.5 text-white flex items-center gap-1 shadow-sm"
                style={{ backgroundColor: dt.color }}
                title={`Negocio: ${dt.dealTitle}`}
              >
                {dt.name}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
