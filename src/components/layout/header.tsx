"use client";

import { SearchCommand } from "@/components/header/search-command";
import { ShieldCheck } from "lucide-react";

export function Header() {
    return (
        <header className="sticky top-0 z-10 hidden px-4 pt-3 md:block lg:px-5 xl:px-6">
            <div className="apple-frosted-bar flex min-h-[52px] items-center gap-3 rounded-[18px] border px-3.5 md:px-4">
                <div className="flex flex-1 items-center gap-3 md:gap-4">
                    <div className="w-full max-w-[440px]">
                        <SearchCommand />
                    </div>
                    <div className="hidden h-5 w-px bg-border/80 lg:block" />
                    <div className="hidden items-center gap-1.5 rounded-full border border-border/80 bg-secondary/65 px-3 py-1.5 text-xs font-medium text-muted-foreground lg:inline-flex">
                        <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                        Espacio protegido
                    </div>
                </div>
            </div>
        </header>
    );
}
