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
            <img
                src={logoUrl}
                alt={`Logotipo de ${brandName}`}
                className={cn("object-contain", className, imageClassName)}
            />
        );
    }

    return <ZenLogo className={className} />;
}
