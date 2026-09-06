import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { getPortalData } from "@/app/actions/portal";
import { PortalBooking } from "@/components/portal/portal-booking";
import { TenantPortalBooking } from "@/components/portal/tenant-portal-booking";
import { getPublicPortalData, resolvePublicPortalContext } from "@/lib/public-tenant-portal";
import { isMultitenantPublicPortalEnabled } from "@/lib/multitenant-features";
import { isLegacyApplicationRequest } from "@/lib/application-host";

export const dynamic = "force-dynamic";

export default async function PortalPage({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = await params;
    const requestHeaders = await headers();

    // The classic CRM and the multitenant app share the same deployment. Resolve
    // the host before applying feature flags so the established public portal is
    // never interpreted as a control-plane tenant.
    if (isLegacyApplicationRequest(requestHeaders)) {
        if (slug.trim().toLowerCase() === "oftalmo") {
            redirect("/portal/belleza");
        }
        const data = await getPortalData(slug);
        if (!data) notFound();
        return <PortalBooking data={data} />;
    }

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
