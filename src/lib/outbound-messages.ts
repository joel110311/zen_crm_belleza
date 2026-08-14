import { prisma } from "@/lib/db";
import { resolveMediaToDataUrl } from "@/lib/media-data-url";
import { getPublicMediaUrl } from "@/lib/media-url";
import {
    normalizeMessageSourceType,
    resolveMessageSourceId,
    type MessageSourceType,
} from "@/lib/message-source";
import { getSystemSettingsOrDefaults } from "@/lib/system-settings";
import { findOrCreateActiveConversationForContactSource } from "@/lib/source-conversations";
import { sendWuzapiMediaMessage, sendWuzapiTextMessage } from "@/lib/wuzapi";
import { sendMetaMediaMessage, sendMetaTextMessage } from "@/lib/meta-whatsapp";

export type OutboundMessageType = "text" | "image" | "document" | "audio" | "video";

export type SendOutboundConversationMessageParams = {
    conversationId: string;
    content?: string | null;
    type?: OutboundMessageType;
    sourceType?: MessageSourceType | null;
    sourceId?: string | null;
    mediaUrl?: string | null;
    mediaType?: string | null;
    mediaFileName?: string | null;
    currentUserId?: string | null;
    senderType?: string | null;
    preserveBotActive?: boolean;
    botActiveOverride?: boolean;
};

export async function findOrCreateActiveConversationForContact(contactId: string) {
    const settings = await getSystemSettingsOrDefaults();
    return findOrCreateActiveConversationForContactSource({
        contactId,
        sourceType: "wuzapi",
        sourceId: resolveMessageSourceId("wuzapi", settings),
    });
}

export async function sendOutboundConversationMessage(
    params: SendOutboundConversationMessageParams,
) {
    const type = params.type || "text";
    const content = typeof params.content === "string" ? params.content.trim() : "";

    if (!params.conversationId || (!content && !params.mediaUrl)) {
        throw new Error("conversationId and content or mediaUrl are required");
    }

    const selectedSourceType = normalizeMessageSourceType(params.sourceType);
    const requestedSourceId = typeof params.sourceId === "string" && params.sourceId.trim()
        ? params.sourceId.trim()
        : null;

    let conversation = await prisma.conversation.findUnique({
        where: { id: params.conversationId },
        include: { contact: true },
    });

    const settings = await getSystemSettingsOrDefaults();
    const selectedSourceId = conversation?.sourceType === selectedSourceType
        ? conversation.sourceId || null
        : requestedSourceId || resolveMessageSourceId(selectedSourceType, settings);

    if (!conversation) {
        const contactById = await prisma.contact.findUnique({
            where: { id: params.conversationId },
            select: { id: true },
        });

        if (!contactById) {
            throw new Error("Conversation not found");
        }

        const ensuredConversation = await findOrCreateActiveConversationForContactSource({
            contactId: contactById.id,
            sourceType: selectedSourceType,
            sourceId: selectedSourceId,
        });
        conversation = await prisma.conversation.findUnique({
            where: { id: ensuredConversation.id },
            include: { contact: true },
        });
    }

    if (!conversation) {
        throw new Error("Conversation not found");
    }

    if (conversation.sourceType !== selectedSourceType) {
        const ensuredConversation = await findOrCreateActiveConversationForContactSource({
            contactId: conversation.contactId,
            sourceType: selectedSourceType,
            sourceId: selectedSourceId,
            defaults: {
                assignedUserId: params.currentUserId || conversation.assignedUserId,
                botActive: conversation.botActive,
            },
        });
        conversation = await prisma.conversation.findUnique({
            where: { id: ensuredConversation.id },
            include: { contact: true },
        });
        if (!conversation) {
            throw new Error("Conversation not found");
        }
    }

    const message = await prisma.message.create({
        data: {
            conversationId: conversation.id,
            content: content || `[${type}]`,
            direction: "outbound",
            status: "sending",
            type,
            sourceType: selectedSourceType,
            sourceId: selectedSourceId,
            mediaUrl: params.mediaUrl || null,
            mediaType: params.mediaType || null,
            mediaFileName: params.mediaFileName || null,
            senderType: params.senderType || "human",
        },
    });

    await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
            updatedAt: new Date(),
            botActive: typeof params.botActiveOverride === "boolean"
                ? params.botActiveOverride
                : params.preserveBotActive
                    ? conversation.botActive
                    : false,
            assignedUserId: params.currentUserId || conversation.assignedUserId,
        },
    });

    try {
        if (conversation.contact?.phone) {
            let providerMessageId: string | null = null;

            if (type === "text") {
                const result = selectedSourceType === "meta"
                    ? await sendMetaTextMessage(conversation.contact.phone, content)
                    : await sendWuzapiTextMessage(conversation.contact.phone, content);
                providerMessageId = result?.Id || null;
            } else if (params.mediaUrl) {
                let result: { Id?: string | null } | null = null;

                if (selectedSourceType === "meta") {
                    const appBaseUrl = (process.env.APP_BASE_URL || process.env.AUTH_URL || "").trim();
                    const publicMediaUrl = getPublicMediaUrl(params.mediaUrl, appBaseUrl);

                    result = await sendMetaMediaMessage({
                        to: conversation.contact.phone,
                        mediaType: type,
                        link: publicMediaUrl,
                        caption: content && content !== `[${type}]` ? content : undefined,
                        fileName: params.mediaFileName || undefined,
                    });
                } else {
                    const resolvedMedia = await resolveMediaToDataUrl(params.mediaUrl, params.mediaType);
                    result = await sendWuzapiMediaMessage({
                        phone: conversation.contact.phone,
                        mediaCategory: type,
                        dataUrl: resolvedMedia.dataUrl,
                        caption: content && content !== `[${type}]` ? content : undefined,
                        fileName: params.mediaFileName || resolvedMedia.fileName,
                        mimeType: params.mediaType || resolvedMedia.mimeType,
                    });
                }

                providerMessageId = result?.Id || null;
            }

            const updatedMessage = await prisma.message.update({
                where: { id: message.id },
                data: {
                    status: "sent",
                    providerMessageId,
                },
            });

            return {
                message: updatedMessage,
                conversation,
            };
        }

        const updatedMessage = await prisma.message.update({
            where: { id: message.id },
            data: { status: "sent" },
        });

        return {
            message: updatedMessage,
            conversation,
        };
    } catch (error) {
        await prisma.message.update({
            where: { id: message.id },
            data: { status: "failed" },
        });

        throw error;
    }
}
