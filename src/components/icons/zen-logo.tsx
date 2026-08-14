"use client";

import { cn } from "@/lib/utils";

interface ZenLogoProps {
    className?: string;
}

export function ZenLogo({ className }: ZenLogoProps) {
    // Brand mark with transparent background so it adapts to the container theme
    return (
        <svg
            viewBox="0 0 100 100"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={cn("h-auto w-auto text-current", className)}
        >
            {/* Background Grid Hint */}
            <path
                d="M24 22 L24 78 L78 78"
                stroke="currentColor"
                strokeOpacity="0.26"
                strokeWidth="2"
                strokeLinecap="round"
            />

            {/* Candle 1 (Low) */}
            <line x1="36" y1="63" x2="36" y2="80" stroke="currentColor" strokeOpacity="0.52" strokeWidth="1.4" />
            <rect x="31" y="63" width="10" height="13" rx="2" fill="currentColor" fillOpacity="0.52" />
            <line x1="36" y1="63" x2="36" y2="57" stroke="currentColor" strokeOpacity="0.52" strokeWidth="1.4" />

            {/* Candle 2 (Mid) */}
            <line x1="54" y1="46" x2="54" y2="68" stroke="currentColor" strokeOpacity="0.72" strokeWidth="1.4" />
            <rect x="49" y="46" width="10" height="17" rx="2" fill="currentColor" fillOpacity="0.72" />
            <line x1="54" y1="46" x2="54" y2="37" stroke="currentColor" strokeOpacity="0.72" strokeWidth="1.4" />

            {/* Candle 3 (High) */}
            <line x1="71" y1="30" x2="71" y2="56" stroke="currentColor" strokeOpacity="0.98" strokeWidth="1.6" />
            <rect x="65.5" y="30" width="11" height="20" rx="2" fill="currentColor" fillOpacity="0.98" />
            <line x1="71" y1="30" x2="71" y2="22" stroke="currentColor" strokeOpacity="0.98" strokeWidth="1.6" />
        </svg>
    );
}
