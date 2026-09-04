import { redirect } from "next/navigation";

export default async function TenantSpecialistsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    redirect(`/t/${tenantSlug}/settings?section=specialists`);
}
