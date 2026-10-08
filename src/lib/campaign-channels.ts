import "server-only";
import { getControlDb } from "@/lib/control-db";
import { resolveDeliveryTenantId } from "@/lib/channel-delivery";
import { getTenantQrConnection } from "@/lib/tenant-channels";
import { getWuzapiSessionStatus } from "@/lib/wuzapi";
import { getMetaSessionSnapshot } from "@/lib/meta-whatsapp";
import { isMultitenantChannelsEnabled } from "@/lib/multitenant-features";
import { getSystemSettingsOrDefaults } from "@/lib/system-settings";
import { resolveMessageSourceId } from "@/lib/message-source";
import { findActiveCampaignChannel, loadActiveCampaignChannels } from "@/lib/campaign-channel-availability";

export async function getActiveCampaignChannels() {
    return loadActiveCampaignChannels({
        tenantId: await resolveDeliveryTenantId(),
        tenantChannelsEnabled: isMultitenantChannelsEnabled(),
        tenantConnections: (tenantId) => getControlDb().channelConnection.findMany({
            where: { tenantId }, orderBy: { createdAt: "asc" },
            select: { provider: true, status: true, externalAccountId: true },
        }),
        tenantQr: (tenantId) => getTenantQrConnection(tenantId),
        legacyQr: async () => ({
            ...await getWuzapiSessionStatus(),
            sourceId: resolveMessageSourceId("wuzapi", await getSystemSettingsOrDefaults()),
        }),
        legacyMeta: getMetaSessionSnapshot,
    });
}

export async function assertCampaignChannelActive(sourceType: string, sourceId?: string | null) {
    if (!findActiveCampaignChannel(await getActiveCampaignChannels(), sourceType, sourceId)) {
        throw new Error("El canal de esta campaña no está conectado. Conéctalo o guarda un canal activo antes de iniciar el envío.");
    }
}
