import { SettingsWorkspace } from "@/components/tenant/settings-workspace";

export default async function TenantSettingsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    return <SettingsWorkspace tenantSlug={tenantSlug} />;
}
