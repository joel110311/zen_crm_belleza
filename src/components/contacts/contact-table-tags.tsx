"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { addContactTag, removeContactTag } from "@/app/actions/contacts";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { useToast } from "@/components/ui/use-toast";

interface ContactTableTagsProps {
    contactId: string;
    tags: string[];
}

export function ContactTableTags({ contactId, tags }: ContactTableTagsProps) {
    const [isPending, startTransition] = useTransition();
    const [newTag, setNewTag] = useState("");
    const [isOpen, setIsOpen] = useState(false);
    const { toast } = useToast();

    const handleAddTag = async () => {
        if (!newTag.trim()) return;
        startTransition(async () => {
            const result = await addContactTag(contactId, newTag.trim());
            if (result.success) {
                setNewTag("");
                setIsOpen(false);
            } else {
                toast({ title: "Error", description: "No se pudo agregar la etiqueta.", variant: "destructive" });
            }
        });
    };

    const handleRemoveTag = (tag: string) => {
        startTransition(async () => {
            const result = await removeContactTag(contactId, tag);
            if (!result.success) {
                toast({ title: "Error", description: "No se pudo eliminar la etiqueta.", variant: "destructive" });
            }
        });
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            e.preventDefault();
            handleAddTag();
        }
    };

    return (
        <div className="flex flex-wrap gap-1 items-center">
            {tags.map((tag) => (
                <Badge
                    key={tag}
                    variant="secondary"
                    className="px-2 py-0.5 bg-gray-100 text-gray-600 border border-gray-200 text-[10px] font-medium group/tag relative pr-4"
                >
                    {tag}
                    <button
                        onClick={() => handleRemoveTag(tag)}
                        disabled={isPending}
                        className="absolute right-0.5 top-0.5 opacity-0 group-hover/tag:opacity-100 hover:text-red-500 rounded-full p-0.5 transition-opacity"
                    >
                        <X className="h-2 w-2" />
                    </button>
                </Badge>
            ))}
            {tags.length === 0 && (
                <span className="text-xs text-gray-300 italic mr-1">Sin etiquetas</span>
            )}

            <Popover open={isOpen} onOpenChange={setIsOpen}>
                <PopoverTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 rounded-full hover:bg-gray-100 text-gray-400 hover:text-blue-600"
                    >
                        <Plus className="h-3 w-3" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-52 p-2" align="start">
                    <div className="flex gap-2">
                        <Input
                            placeholder="Etiqueta..."
                            value={newTag}
                            onChange={(e) => setNewTag(e.target.value)}
                            className="h-7 text-xs"
                            onKeyDown={handleKeyDown}
                        />
                        <Button size="sm" className="h-7 px-2" onClick={handleAddTag} disabled={isPending}>
                            <Plus className="h-3 w-3" />
                        </Button>
                    </div>
                </PopoverContent>
            </Popover>
        </div>
    );
}
