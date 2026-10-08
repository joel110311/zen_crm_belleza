import type { SVGProps } from "react";
import { BRAND_LOTUS_PATHS } from "@/lib/brand-lotus";

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
            {BRAND_LOTUS_PATHS.map((d) => <path key={d} d={d} />)}
        </svg>
    );
}
