import Image from "next/image";
import { BeautyLeafIcon } from "@/components/icons/beauty-leaf-icon";
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

    return <BeautyLeafIcon className={className} />;
}
