import { ServicesWorkspace } from "@/components/tenant/services-workspace";

export default async function TenantServicesPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    return <ServicesWorkspace tenantSlug={tenantSlug} />;
}
