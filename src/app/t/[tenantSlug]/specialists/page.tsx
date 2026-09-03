import { SpecialistsWorkspace } from "@/components/tenant/specialists-workspace";

export default async function TenantSpecialistsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    return <SpecialistsWorkspace tenantSlug={tenantSlug} />;
}
