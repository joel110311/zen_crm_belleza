"use client";

import { cn } from "@/lib/utils";

type WhatsAppIconProps = {
    className?: string;
};

export function WhatsAppIcon({ className }: WhatsAppIconProps) {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
            className={cn("h-4 w-4 text-current", className)}
        >
            <path
                d="M4.42 19.58l1.06-3.86A7.55 7.55 0 014.47 12C4.47 7.83 7.84 4.46 12 4.46S19.53 7.83 19.53 12 16.16 19.54 12 19.54a7.5 7.5 0 01-3.62-.92l-3.96.96z"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinejoin="round"
            />
            <path
                d="M9.12 8.72c.18-.4.37-.41.54-.41h.45c.14 0 .34.05.52.25.18.2.69.67.69 1.63 0 .95-.71 1.88-.8 2.01-.1.13-.14.24-.03.43.11.19.49.8 1.05 1.3.72.64 1.32.84 1.52.93.2.1.32.08.44-.05.13-.14.55-.64.69-.86.15-.21.3-.18.51-.11.2.07 1.29.61 1.51.72.22.11.37.16.43.25.06.09.06.54-.13 1.07-.19.52-1.12 1-1.55 1.03-.42.03-.83.19-2.79-.58-2.36-.93-3.84-3.32-3.96-3.48-.12-.16-.95-1.27-.95-2.42 0-1.15.6-1.72.81-1.96.22-.23.48-.29.64-.29"
                stroke="currentColor"
                strokeWidth="1.45"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}
