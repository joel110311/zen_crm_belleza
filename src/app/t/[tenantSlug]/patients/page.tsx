import { PatientsWorkspace } from "@/components/tenant/patients-workspace";

export default async function TenantPatientsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    return <PatientsWorkspace tenantSlug={tenantSlug} />;
}
