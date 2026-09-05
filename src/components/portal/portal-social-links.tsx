import { ExternalLink } from "lucide-react";
import { publicPortalSocialLinks, SOCIAL_NETWORKS } from "@/lib/portal-social-links";

export function PortalSocialLinks({ links }: { links: unknown }) {
    const visible = publicPortalSocialLinks(links);
    if (!visible.length) return null;
    return <nav aria-label="Redes sociales del negocio" className="mt-4 flex min-w-0 flex-wrap gap-2">
        {visible.map((link) => <a key={link.network} href={link.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-full border bg-background px-4 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            {SOCIAL_NETWORKS.find((network) => network.id === link.network)?.label}
            <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="sr-only"> (abre en otra pestaña)</span>
        </a>)}
    </nav>;
}
