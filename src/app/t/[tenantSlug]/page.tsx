import { redirect } from "next/navigation";

export default async function TenantHomePage({
    params,
}: {
    params: Promise<{ tenantSlug: string }>;
}) {
    const { tenantSlug } = await params;
    redirect(`/t/${tenantSlug}/dashboard`);
}
