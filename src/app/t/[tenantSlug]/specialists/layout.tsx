import { requireTenantPagePermission } from "@/lib/tenant-page-access";

export default async function SpecialistsAccessLayout({ children, params }: Readonly<{ children: React.ReactNode; params: Promise<{ tenantSlug: string }> }>) {
    const { tenantSlug } = await params;
    await requireTenantPagePermission(tenantSlug, "specialists.manage");
    return children;
}
