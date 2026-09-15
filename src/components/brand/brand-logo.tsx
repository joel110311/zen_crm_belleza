import Image from "next/image";
import { ZenLogo } from "@/components/icons/zen-logo";
import { cn } from "@/lib/utils";

type BrandLogoProps = {
    brandName: string;
    logoUrl?: string | null;
    className?: string;
    imageClassName?: string;
};

export function BrandLogo({ brandName, logoUrl, className, imageClassName }: BrandLogoProps) {
    if (logoUrl) {
        return (
            <Image
                src={logoUrl}
                alt={`Logotipo de ${brandName}`}
                width={44}
                height={44}
                unoptimized
                className={cn("object-contain", className, imageClassName)}
            />
        );
    }

    return <ZenLogo className={className} />;
}
