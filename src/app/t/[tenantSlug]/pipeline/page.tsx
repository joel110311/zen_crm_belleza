import { PipelineWorkspace } from "@/components/tenant/pipeline-workspace";

export default async function TenantPipelinePage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    return <PipelineWorkspace tenantSlug={tenantSlug} />;
}
