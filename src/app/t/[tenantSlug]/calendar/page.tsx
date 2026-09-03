import { CalendarWorkspace } from "@/components/tenant/calendar-workspace";

export default async function TenantCalendarPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    return <CalendarWorkspace tenantSlug={tenantSlug} />;
}
