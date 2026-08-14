import type { SVGProps } from "react";

export function BeautyLeafIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="square"
            strokeLinejoin="miter"
            aria-hidden="true"
            className={className}
            {...props}
        >
            <path d="M12.05 14.55C9.85 9.85 10.15 5.1 14.55 1.4c2.35 5.25 2.25 9.75-2.5 13.15Z" />
            <path d="M12.1 14.65c2.75-4.2 6.25-5.55 10.55-4.55-2.3 4.4-6.15 6-10.55 4.55Z" />
            <path d="M11.9 14.15c-3.75-.55-6.2-2.65-7.15-6.2 3.9.85 6.15 2.85 7.15 6.2Z" />
            <path d="M11.95 15.05c-3.75 2.8-7.55 2.95-10.8.4 3.5-2.25 7.3-2.4 10.8-.4Z" />
            <path d="m11.95 14.55 4.05 4.2 2.95-3.05" />
        </svg>
    );
}
