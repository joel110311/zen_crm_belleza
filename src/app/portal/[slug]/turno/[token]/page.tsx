import { notFound } from "next/navigation";
import { TenantBookingStatus } from "@/components/portal/tenant-booking-status";
import { isMultitenantPublicPortalEnabled } from "@/lib/multitenant-features";

export const dynamic = "force-dynamic";

export default async function TenantPortalBookingPage({ params }: { params: Promise<{ slug: string; token: string }> }) {
    const { slug, token } = await params;
    if (!isMultitenantPublicPortalEnabled() || !/^[A-Fa-f0-9]{64}$/.test(token)) notFound();
    return <TenantBookingStatus tenantSlug={slug} token={token} />;
}
