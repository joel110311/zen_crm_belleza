import type { PrismaClient } from "@prisma/client";

type EchoContact = { id: string; name?: string | null };
export type WuzapiOutboundEcho = {
    phoneCandidates: string[];
    content: string;
    sourceId: string | null;
    providerMessageId?: string;
    occurredAt?: Date | null;
    contactName?: string;
    media?: { type?: string; mediaUrl?: string | null; mediaType?: string | null; mediaFileName?: string | null };
};

export type OutboundEchoDependencies = {
    db: Pick<PrismaClient, "message" | "conversation" | "contact">;
    findContact: (phones: string[]) => Promise<EchoContact | null>;
    findConversation: (params: { contactId: string; sourceType: "wuzapi"; sourceId: string | null; defaults: { botActive: boolean } }) => Promise<{ id: string }>;
};

/** Persist a linked-device echo, without ever sending it back to WhatsApp. */
export async function persistWuzapiOutboundEcho(input: WuzapiOutboundEcho, deps: OutboundEchoDependencies) {
    const { db } = deps;
    const type = input.media?.type || "text";
    const name = input.contactName?.trim().replace(/\s+/g, " ");
    const contactName = name && !/^(unknown|desconocido|sin nombre|null|undefined|n\/a|na)$/i.test(name) ? name : undefined;

    async function acknowledge(message: { id: string; conversationId: string; senderType: string | null; providerMessageId: string | null; status: string }) {
        await db.message.update({ where: { id: message.id }, data: {
            ...(!["delivered", "read"].includes(message.status) ? { status: "sent" } : {}),
            ...(!message.providerMessageId && input.providerMessageId ? { providerMessageId: input.providerMessageId } : {}),
            ...(input.occurredAt ? { createdAt: input.occurredAt } : {}),
        } });
        await db.conversation.update({ where: { id: message.conversationId }, data: {
            updatedAt: new Date(),
            // Bot echoes acknowledge delivery; only a human takes over the conversation.
            ...(message.senderType !== "bot" ? { botActive: false } : {}),
        } });
        return { conversationId: message.conversationId, messageId: message.id, duplicate: true };
    }

    if (input.providerMessageId) {
        const known = await db.message.findFirst({ where: { sourceType: "wuzapi", direction: "outbound", providerMessageId: input.providerMessageId } });
        if (known) return acknowledge(known);
    }

    let contact = await deps.findContact(input.phoneCandidates);
    if (!contact) {
        const phone = input.phoneCandidates[0]?.replace(/\D/g, "");
        if (!phone) throw new Error("The outbound echo has no recipient phone.");
        try {
            contact = await db.contact.create({ data: { phone, name: contactName, status: "lead" } });
        } catch (error) {
            contact = await deps.findContact(input.phoneCandidates);
            if (!contact) throw error;
        }
    } else if (contactName && !contact.name?.trim()) {
        contact = await db.contact.update({ where: { id: contact.id }, data: { name: contactName } });
    }
    const conversation = await deps.findConversation({
        contactId: contact.id, sourceType: "wuzapi", sourceId: input.sourceId, defaults: { botActive: false },
    });

    // The provider can deliver its echo before the send request returns an ID.
    // Bot/human sends therefore create their pending message before calling the transport.
    const fallbackContents = [input.content];
    if (type !== "text" && /^\[(?:imagen|image|video|audio|documento|document)\]$/i.test(input.content)) {
        fallbackContents.push(`[${type}]`);
    }
    const pending = await db.message.findFirst({ where: {
        conversationId: conversation.id, sourceType: "wuzapi", direction: "outbound", type,
        providerMessageId: null, content: { in: fallbackContents },
        OR: [
            { status: "sending", createdAt: { gte: new Date(Date.now() - 120_000) } },
            { status: "sent", createdAt: { gte: new Date(Date.now() - 15_000) } },
        ],
        ...(input.media?.mediaFileName ? { mediaFileName: input.media.mediaFileName } : {}),
    }, orderBy: { createdAt: "desc" } });
    if (pending) return acknowledge(pending);

    const message = await db.message.create({ data: {
        conversationId: conversation.id, content: input.content, direction: "outbound", status: "sent", type,
        senderType: "human", sourceType: "wuzapi", sourceId: input.sourceId,
        providerMessageId: input.providerMessageId || null,
        mediaUrl: input.media?.mediaUrl || null, mediaType: input.media?.mediaType || null,
        mediaFileName: input.media?.mediaFileName || null,
        ...(input.occurredAt ? { createdAt: input.occurredAt } : {}),
    } });
    await db.conversation.update({ where: { id: conversation.id }, data: { botActive: false, updatedAt: new Date() } });
    return { conversationId: conversation.id, messageId: message.id, duplicate: false };
}
