import { notFound, redirect } from "next/navigation";
import { getPortalData } from "@/app/actions/portal";
import { PortalBooking } from "@/components/portal/portal-booking";
import { TenantPortalBooking } from "@/components/portal/tenant-portal-booking";
import { getPublicPortalData, resolvePublicPortalContext } from "@/lib/public-tenant-portal";
import { isMultitenantPublicPortalEnabled } from "@/lib/multitenant-features";

export const dynamic = "force-dynamic";

export default async function PortalPage({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = await params;
    if (isMultitenantPublicPortalEnabled()) {
        const context = await resolvePublicPortalContext(slug);
        if (!context) notFound();
        return <TenantPortalBooking data={await getPublicPortalData(context)} />;
    }
    if (slug.trim().toLowerCase() === "oftalmo") {
        redirect("/portal/belleza");
    }
    const data = await getPortalData(slug);

    if (!data) {
        notFound();
    }

    return <PortalBooking data={data} />;
}
