import "server-only";
import { open, stat } from "node:fs/promises";
import path from "node:path";

import { getActiveTenantRuntimeContext } from "@/lib/active-tenant-context";
import { getScopedTenantId } from "@/lib/routed-prisma";
import { isMultitenantRuntimeEnabled } from "@/lib/multitenant-features";
import { sendMetaMediaMessage, sendMetaReaction, sendMetaTextMessage, sendMetaTemplateMessage, listMetaTemplates, createMetaTemplate, deleteMetaTemplate } from "@/lib/meta-whatsapp";
import { sendTenantChannelMedia, sendTenantChannelReaction, sendTenantChannelText, sendTenantChannelTemplate, manageTenantMetaTemplates, getTenantMetaSourceId } from "@/lib/tenant-channels";
import { getSystemSettingsOrDefaults } from "@/lib/system-settings";
import { resolveMessageSourceId, type MessageSourceType } from "@/lib/message-source";
import { sendWuzapiMediaMessage, sendWuzapiReaction, sendWuzapiTextMessage } from "@/lib/wuzapi";
import { localMediaFilename, signMediaDownload } from "@/lib/chat-media-policy";
import { assertLocalMediaOwnership } from "@/lib/local-media-access";
import { validateMetaMedia } from "@/lib/meta-media-policy";

export async function resolveDeliveryTenantId() {
    const scoped = getScopedTenantId();
    if (scoped && scoped !== "legacy") return scoped;
    if (!isMultitenantRuntimeEnabled()) return null;
    try {
        return (await getActiveTenantRuntimeContext("write"))?.tenantId || null;
    } catch (error) {
        if (error instanceof Error && (
            error.message.includes("outside a request scope")
            || error.message.includes("was called outside a request")
        )) return null;
        throw error;
    }
}

export async function sendChannelText(params: {
    sourceType: "meta" | "wuzapi";
    to: string;
    body: string;
    sourceId?: string | null;
}) {
    const tenantId = await resolveDeliveryTenantId();
    if (tenantId) return sendTenantChannelText({ tenantId, ...params });
    return params.sourceType === "meta"
        ? sendMetaTextMessage(params.to, params.body)
        : sendWuzapiTextMessage(params.to, params.body);
}

export async function sendChannelMedia(params: {
    sourceType: "meta" | "wuzapi";
    to: string;
    mediaType: "image" | "document" | "audio" | "video";
    dataUrl?: string;
    link?: string;
    caption?: string;
    fileName?: string;
    mimeType?: string;
    sourceId?: string | null;
}) {
    if (params.link) {
        const base = process.env.APP_BASE_URL || process.env.AUTH_URL || process.env.NEXTAUTH_URL;
        const filename = localMediaFilename(params.link, base);
        if (filename) {
            await assertLocalMediaOwnership(filename);
            if (params.sourceType === "meta") {
                const filePath = path.join(process.cwd(), "public", "uploads", filename);
                const info = await stat(filePath);
                const handle = await open(filePath, "r");
                try {
                    const header = Buffer.alloc(256);
                    await handle.read(header, 0, header.length, 0);
                    validateMetaMedia(params.mediaType, filename, info.size, header, params.mimeType);
                } finally { await handle.close(); }
            }
            const link = new URL(params.link, base);
            link.search = signMediaDownload(filename);
            params = { ...params, link: link.toString() };
        }
    }
    const tenantId = await resolveDeliveryTenantId();
    if (tenantId) return sendTenantChannelMedia({ tenantId, ...params });
    if (params.sourceType === "meta") {
        if (!params.link) throw new Error("La URL pública del archivo es obligatoria para WhatsApp oficial.");
        return sendMetaMediaMessage({
            to: params.to,
            mediaType: params.mediaType,
            link: params.link,
            caption: params.caption,
            fileName: params.fileName,
        });
    }
    if (!params.dataUrl) throw new Error("El archivo no está disponible para la conexión mediante QR.");
    return sendWuzapiMediaMessage({
        phone: params.to,
        mediaCategory: params.mediaType,
        dataUrl: params.dataUrl,
        caption: params.caption,
        fileName: params.fileName,
        mimeType: params.mimeType,
    });
}

export async function sendChannelReaction(params: { sourceType: "meta" | "wuzapi"; sourceId?: string | null; to: string; providerMessageId: string; reaction: string | null; ownMessage?: boolean }) {
    const tenantId = await resolveDeliveryTenantId();
    if (tenantId) return sendTenantChannelReaction({ tenantId, ...params });
    return params.sourceType === "meta" ? sendMetaReaction(params)
        : sendWuzapiReaction({ phone: params.to, providerMessageId: params.providerMessageId, reaction: params.reaction || "", ownMessage: params.ownMessage });
}

export async function resolveChannelSourceId(sourceType: MessageSourceType, sourceId?: string | null) {
    const tenantId = await resolveDeliveryTenantId();
    if (tenantId && sourceType === "meta") return getTenantMetaSourceId(tenantId, sourceId);
    return sourceId?.trim() || resolveMessageSourceId(sourceType, await getSystemSettingsOrDefaults());
}

export async function sendChannelTemplate(params: Parameters<typeof sendMetaTemplateMessage>[0] & { sourceId?: string | null }) {
    const tenantId = await resolveDeliveryTenantId();
    return tenantId ? sendTenantChannelTemplate({ ...params, tenantId }) : sendMetaTemplateMessage(params);
}

export async function listChannelTemplates(params: { limit?: number } = {}) {
    const tenantId = await resolveDeliveryTenantId();
    return tenantId ? manageTenantMetaTemplates(tenantId, "list", params) : listMetaTemplates(params);
}

export async function createChannelTemplate(params: Parameters<typeof createMetaTemplate>[0]) {
    const tenantId = await resolveDeliveryTenantId();
    return tenantId ? manageTenantMetaTemplates(tenantId, "create", params) : createMetaTemplate(params);
}

export async function deleteChannelTemplate(name: string) {
    const tenantId = await resolveDeliveryTenantId();
    return tenantId ? manageTenantMetaTemplates(tenantId, "delete", { name }) : deleteMetaTemplate(name);
}
