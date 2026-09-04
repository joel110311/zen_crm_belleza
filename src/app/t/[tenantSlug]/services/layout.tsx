import { requireTenantPagePermission } from "@/lib/tenant-page-access";

export default async function ServicesAccessLayout({ children, params }: Readonly<{ children: React.ReactNode; params: Promise<{ tenantSlug: string }> }>) {
    const { tenantSlug } = await params;
    await requireTenantPagePermission(tenantSlug, "services.manage");
    return children;
}
