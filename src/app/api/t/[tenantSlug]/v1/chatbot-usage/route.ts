import { getChatbotUsage } from "@/lib/billing/chatbot-usage";
import { tenantData, withTenantApi } from "@/lib/tenant-api";

export async function GET(request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    return withTenantApi(request, tenantSlug, { permission: "channels.read" }, async (context) => {
        const response = tenantData(await getChatbotUsage(context.tenantId), context.requestId);
        response.headers.set("Cache-Control", "private, no-store");
        return response;
    });
}
