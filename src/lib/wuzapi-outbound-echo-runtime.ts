import { prisma } from "@/lib/db";
import { findAndConsolidateContact } from "@/lib/contact-deduplication";
import { findOrCreateActiveConversationForContactSource } from "@/lib/source-conversations";
import { persistWuzapiOutboundEcho, type WuzapiOutboundEcho } from "@/lib/wuzapi-outbound-echo";
import { refreshWhatsAppAvatarForContact } from "@/lib/whatsapp-avatar";

export async function storeWuzapiOutboundEcho(input: WuzapiOutboundEcho) {
    const result = await persistWuzapiOutboundEcho(input, {
        db: prisma,
        // Explicitly pass the scoped client: phone aliases must never resolve in another tenant.
        findContact: (phones) => findAndConsolidateContact(phones, prisma),
        findConversation: findOrCreateActiveConversationForContactSource,
    });
    if (!result.duplicate) {
        const conversation = await prisma.conversation.findUnique({ where: { id: result.conversationId }, select: { contactId: true } });
        if (conversation) {
            await refreshWhatsAppAvatarForContact(conversation.contactId).catch((error) => {
                console.warn("[WuzAPI] Failed to refresh outbound contact avatar", error);
            });
        }
    }
    return result;
}
