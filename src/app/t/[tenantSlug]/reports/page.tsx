import { redirect } from "next/navigation";

export default async function RetiredTenantReportsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    redirect(`/t/${encodeURIComponent(tenantSlug)}/dashboard`);
}
