import { notFound } from "next/navigation";
import { getPortalData } from "@/app/actions/portal";
import { PortalBooking } from "@/components/portal/portal-booking";

export const dynamic = "force-dynamic";

export default async function PortalPage({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = await params;
    const data = await getPortalData(slug);

    if (!data) {
        notFound();
    }

    return <PortalBooking data={data} />;
}
