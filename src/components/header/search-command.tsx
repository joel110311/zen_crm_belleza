"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Loader2, Search, User } from "lucide-react";
import { useDebounce } from "use-debounce";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { searchGlobal, type SearchResult } from "@/app/actions/search";
import { getContactFullName } from "@/lib/contact-name";
import { hasAnyPermission, type AccessSubject } from "@/lib/permissions";
import { tenantDashboardPath, tenantSlugFromPath } from "@/lib/tenant-request-routing";

type SearchOutcome = { query: string; results: SearchResult | null; error: boolean };

export function SearchCommand() {
    const router = useRouter();
    const pathname = usePathname();
    const { data: session } = useSession();
    const canRead = Boolean(session?.user) && hasAnyPermission(session?.user as AccessSubject, ["contacts.manage", "patients.manage"]);
    const [open, setOpen] = React.useState(false);
    const [query, setQuery] = React.useState("");
    const normalizedQuery = query.trim().slice(0, 160);
    const [debouncedQuery] = useDebounce(normalizedQuery, 300);
    const [outcome, setOutcome] = React.useState<SearchOutcome | null>(null);
    const [retry, setRetry] = React.useState(0);
    const current = outcome?.query === normalizedQuery ? outcome : null;
    const ready = open && canRead && normalizedQuery.length >= 2;
    const waiting = ready && (normalizedQuery !== debouncedQuery || !current);

    const changeOpen = (value: boolean) => { setOpen(value); setOutcome(null); };

    React.useEffect(() => {
        if (!canRead) return;
        const down = (event: KeyboardEvent) => {
            if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                setOutcome(null);
                setOpen((value) => !value);
            }
        };
        document.addEventListener("keydown", down);
        return () => document.removeEventListener("keydown", down);
    }, [canRead]);

    React.useEffect(() => {
        if (!open || !canRead || debouncedQuery.length < 2) return;
        let active = true;
        const fetchResults = async () => {
            try {
                const results = await searchGlobal(debouncedQuery);
                if (active) setOutcome({ query: debouncedQuery, results, error: false });
            } catch {
                if (active) setOutcome({ query: debouncedQuery, results: null, error: true });
            }
        };
        void fetchResults();
        return () => { active = false; };
    }, [open, canRead, debouncedQuery, retry]);

    if (!canRead) return null;

    return <>
        <Button variant="outline" className="relative min-h-11 w-full justify-start rounded-xl border-border/70 bg-background px-3.5 text-sm text-muted-foreground sm:pr-14 md:w-56 lg:w-72" onClick={() => changeOpen(true)}>
            <Search className="mr-2 size-4" aria-hidden="true" /><span>Buscar clientes</span>
            <kbd className="pointer-events-none absolute right-2 top-3 hidden select-none rounded border bg-muted px-1.5 font-mono text-[10px] sm:block" aria-hidden="true">Ctrl K</kbd>
        </Button>
        <CommandDialog open={open} onOpenChange={changeOpen} title="Buscar clientes" description="Busca por nombre, teléfono, correo o empresa y abre la ficha del cliente." shouldFilter={false} className="max-h-[calc(100dvh-2rem)] gap-0">
            <CommandInput aria-label="Buscar clientes" placeholder="Nombre, teléfono, correo o empresa" className="pr-12 text-base" value={query} onValueChange={setQuery} maxLength={160} />
            <CommandList className="max-h-[min(300px,calc(100dvh-6rem))]">
                {!ready ? <p className="px-4 py-5 text-sm text-muted-foreground">Escribe al menos 2 caracteres.</p> : waiting ? <div role="status" className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden="true" />Buscando clientes…</div> : current?.error ? <div role="alert" className="p-4 text-sm"><p>No pudimos buscar clientes.</p><Button variant="outline" className="mt-3 min-h-11" onClick={() => { setOutcome(null); setRetry((value) => value + 1); }}>Reintentar búsqueda</Button></div> : current?.results ? <>
                    <CommandEmpty>No encontramos clientes con esos datos.</CommandEmpty>
                    <CommandGroup heading="Clientes">
                        {current.results.contacts.map((contact) => <CommandItem key={contact.id} value={contact.id} className="min-h-11" onSelect={() => {
                            const path = `/dashboard/contacts/${encodeURIComponent(contact.id)}`;
                            const slug = tenantSlugFromPath(pathname);
                            changeOpen(false);
                            router.push(slug ? tenantDashboardPath(slug, path) : path);
                        }}>
                            <User className="mr-2 size-4 shrink-0" aria-hidden="true" />
                            <div className="min-w-0"><span className="block break-words">{getContactFullName(contact, "Sin nombre")}</span>{contact.email ? <span className="block break-all text-xs text-muted-foreground">{contact.email}</span> : null}</div>
                        </CommandItem>)}
                    </CommandGroup>
                </> : null}
            </CommandList>
        </CommandDialog>
    </>;
}
