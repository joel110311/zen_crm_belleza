"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus, X, Tag as TagIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { addContactTag, removeContactTag } from "@/app/actions/contacts";
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

export function ContactTags({ contactId, contactTags, dealTags }: ContactTagsProps) {
    const [isPending, startTransition] = useTransition();
    const [newTag, setNewTag] = useState("");
    const [isOpen, setIsOpen] = useState(false);

    const handleAddTag = () => {
        if (!newTag.trim()) return;
        startTransition(async () => {
            await addContactTag(contactId, newTag);
            setNewTag("");
            setIsOpen(false);
        });
    };

    const handleRemoveTag = (tag: string) => {
        startTransition(async () => {
            await removeContactTag(contactId, tag);
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
                            className="px-2.5 py-0.5 bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-200 flex items-center gap-1"
                        >
                            {tag}
                            <button
                                onClick={() => handleRemoveTag(tag)}
                                disabled={isPending}
                                className="ml-1 hover:text-red-500 rounded-full p-0.5 hover:bg-red-50 transition-colors"
                            >
                                <X className="h-3 w-3" />
                            </button>
                        </Badge>
                    ))}
                    <Popover open={isOpen} onOpenChange={setIsOpen}>
                        <PopoverTrigger asChild>
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-6 text-xs rounded-full border-dashed text-gray-500 hover:text-gray-900"
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
                                <Button size="sm" className="h-8" onClick={handleAddTag} disabled={isPending}>
                                    <Plus className="h-4 w-4" />
                                </Button>
                            </div>
                        </PopoverContent>
                    </Popover>
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
                                className="px-2.5 py-0.5 text-white flex items-center gap-1 shadow-sm"
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
