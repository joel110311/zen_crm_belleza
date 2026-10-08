export type CampaignChannel = { sourceType: "wuzapi" | "meta"; sourceId: string | null; label: string };
type TenantConnection = { provider: string; status: string; externalAccountId: string };
type ChannelDependencies = {
    tenantId: string | null;
    tenantChannelsEnabled: boolean;
    tenantConnections: (tenantId: string) => Promise<TenantConnection[]>;
    tenantQr: (tenantId: string) => Promise<{ active?: boolean; connected?: boolean }>;
    legacyQr: () => Promise<{ loggedIn?: boolean; connected?: boolean; sourceId?: string | null }>;
    legacyMeta: () => Promise<{ metaConnected?: boolean; phoneNumberId?: string | null }>;
};

/** Connected means usable, not merely configured. Never fall back to global channels for a tenant. */
export async function loadActiveCampaignChannels(deps: ChannelDependencies): Promise<CampaignChannel[]> {
    if (deps.tenantId) {
        if (!deps.tenantChannelsEnabled) return [];
        const connections = await deps.tenantConnections(deps.tenantId);
        const qr = connections.some((c) => c.provider === "WUZAPI")
            ? await deps.tenantQr(deps.tenantId).catch(() => null) : null;
        const channels: CampaignChannel[] = [];
        const qrConnection = connections.find((c) => c.provider === "WUZAPI");
        if (qrConnection && qr?.active && qr.connected) channels.push({ sourceType: "wuzapi", sourceId: qrConnection.externalAccountId, label: "WhatsApp por QR" });
        const meta = connections.find((c) => c.provider === "META_CLOUD" && c.status === "CONNECTED");
        if (meta) channels.push({ sourceType: "meta", sourceId: meta.externalAccountId, label: "WhatsApp API oficial" });
        return channels;
    }
    const [qr, meta] = await Promise.all([
        deps.legacyQr().catch(() => null), deps.legacyMeta().catch(() => null),
    ]);
    const channels: CampaignChannel[] = [];
    if (qr?.loggedIn && qr.connected) channels.push({ sourceType: "wuzapi", sourceId: qr.sourceId || null, label: "WhatsApp por QR" });
    if (meta?.metaConnected) channels.push({ sourceType: "meta", sourceId: meta.phoneNumberId || null, label: "WhatsApp API oficial" });
    return channels;
}

export function findActiveCampaignChannel(channels: CampaignChannel[], sourceType: string, sourceId?: string | null) {
    return channels.find((channel) => channel.sourceType === sourceType
        && (sourceType !== "meta" || !sourceId || sourceId === channel.sourceId));
}
