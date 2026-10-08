import "server-only";

import { getActiveTenantRuntimeContext } from "@/lib/active-tenant-context";
import { getScopedTenantId } from "@/lib/routed-prisma";
import { isMultitenantRuntimeEnabled } from "@/lib/multitenant-features";
import { sendMetaMediaMessage, sendMetaReaction, sendMetaTextMessage } from "@/lib/meta-whatsapp";
import { sendTenantChannelMedia, sendTenantChannelReaction, sendTenantChannelText } from "@/lib/tenant-channels";
import { sendWuzapiMediaMessage, sendWuzapiReaction, sendWuzapiTextMessage } from "@/lib/wuzapi";
import { localMediaFilename, signMediaDownload } from "@/lib/chat-media-policy";
import { assertLocalMediaOwnership } from "@/lib/local-media-access";

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
}) {
    if (params.link) {
        const base = process.env.APP_BASE_URL || process.env.AUTH_URL || process.env.NEXTAUTH_URL;
        const filename = localMediaFilename(params.link, base);
        if (filename) {
            await assertLocalMediaOwnership(filename);
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

export async function sendChannelReaction(params: { sourceType: "meta" | "wuzapi"; to: string; providerMessageId: string; reaction: string | null; ownMessage?: boolean }) {
    const tenantId = await resolveDeliveryTenantId();
    if (tenantId) return sendTenantChannelReaction({ tenantId, ...params });
    return params.sourceType === "meta" ? sendMetaReaction(params)
        : sendWuzapiReaction({ phone: params.to, providerMessageId: params.providerMessageId, reaction: params.reaction || "", ownMessage: params.ownMessage });
}
