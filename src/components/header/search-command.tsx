"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Briefcase, Loader2, Search, User } from "lucide-react";
import { useDebounce } from "use-debounce";
import {
    CommandDialog,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { searchGlobal, type SearchResult } from "@/app/actions/search";
import { cn } from "@/lib/utils";
import { getContactFullName } from "@/lib/contact-name";
import { useOperationContext } from "@/components/shared/use-operation-context";

export function SearchCommand() {
    const operationContext = useOperationContext();
    const router = useRouter();
    const [open, setOpen] = React.useState(false);
    const [query, setQuery] = React.useState("");
    const [debouncedQuery] = useDebounce(query, 300);
    const [data, setData] = React.useState<SearchResult | null>(null);
    const [loading, setLoading] = React.useState(false);

    React.useEffect(() => {
        const down = (event: KeyboardEvent) => {
            if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                setOpen((current) => !current);
            }
        };
        document.addEventListener("keydown", down);
        return () => document.removeEventListener("keydown", down);
    }, []);

    React.useEffect(() => {
        if (debouncedQuery.length < 2) {
            setData(null);
            return;
        }

        const fetchResults = async () => {
            setLoading(true);
            try {
                const results = await searchGlobal(debouncedQuery);
                setData(results);
            } catch (error) {
                console.error("Search failed", error);
            } finally {
                setLoading(false);
            }
        };

        void fetchResults();
    }, [debouncedQuery]);

    const handleSelect = (callback: () => void) => {
        setOpen(false);
        callback();
    };

    return (
        <>
            <Button
                variant="outline"
                className={cn(
                    "relative h-10 w-full justify-start rounded-xl border-border/70 bg-background px-3.5 text-sm text-muted-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] sm:pr-14 md:w-56 lg:w-72",
                )}
                onClick={() => setOpen(true)}
            >
                <Search className="mr-2 h-4 w-4" />
                <span>Search...</span>
                <kbd className="pointer-events-none absolute right-1.5 top-1.5 hidden h-5 select-none items-center rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 sm:flex">
                    Ctrl K
                </kbd>
            </Button>

            <CommandDialog open={open} onOpenChange={setOpen}>
                <CommandInput
                    placeholder="Type to search contacts or deals..."
                    value={query}
                    onValueChange={setQuery}
                />
                <CommandList>
                    <CommandEmpty>No results found.</CommandEmpty>

                    {loading ? (
                        <div className="flex items-center justify-center p-4 text-sm text-muted-foreground">
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Searching...
                        </div>
                    ) : null}

                    {!loading && data ? (
                        <>
                            {data.contacts.length > 0 ? (
                                <CommandGroup heading="Contacts">
                                    {data.contacts.map((contact) => (
                                        <CommandItem
                                            key={contact.id}
                                            value={`contact-${contact.id}-${contact.name}-${contact.email}`}
                                            onSelect={() => handleSelect(() => router.push(`/dashboard/contacts?id=${contact.id}`))}
                                        >
                                            <User className="mr-2 h-4 w-4" />
                                            <div className="flex flex-col">
                                                <span>{getContactFullName(contact, "Unknown")}</span>
                                                <span className="text-xs text-muted-foreground">{contact.email}</span>
                                            </div>
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                            ) : null}

                            {data.contacts.length > 0 && data.deals.length > 0 ? <CommandSeparator /> : null}

                            {data.deals.length > 0 ? (
                                <CommandGroup heading="Deals">
                                    {data.deals.map((deal) => (
                                        <CommandItem
                                            key={deal.id}
                                            value={`deal-${deal.id}-${deal.title}`}
                                            onSelect={() => handleSelect(() => router.push(`/dashboard/pipeline?deal=${deal.id}`))}
                                        >
                                            <Briefcase className="mr-2 h-4 w-4" />
                                            <div className="flex flex-col">
                                                <span>{deal.title}</span>
                                                <span className="text-xs text-muted-foreground">
                                                    {operationContext.formatMoney(deal.value, operationContext.defaultCurrency, { maximumFractionDigits: 0 })} - {deal.stageName}
                                                </span>
                                            </div>
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                            ) : null}
                        </>
                    ) : null}
                </CommandList>
            </CommandDialog>
        </>
    );
}
