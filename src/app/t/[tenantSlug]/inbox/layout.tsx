import { requireTenantPagePermission } from "@/lib/tenant-page-access";

export default async function InboxAccessLayout({ children, params }: Readonly<{ children: React.ReactNode; params: Promise<{ tenantSlug: string }> }>) {
    const { tenantSlug } = await params;
    await requireTenantPagePermission(tenantSlug, "chats.manage");
    return children;
}
