import { ContactsWorkspace } from "@/components/tenant/contacts-workspace";

export default async function TenantContactsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    return <ContactsWorkspace tenantSlug={tenantSlug} />;
}
