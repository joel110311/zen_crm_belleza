import type { Prisma, PrismaClient } from "@prisma/client";
import { requireProviderMessageId } from "./whatsapp-audio.ts";

/** A pending bot row must exist before WhatsApp can echo the send back to us. */
export async function sendTrackedBotMessage(params: {
    db: Pick<PrismaClient, "message" | "conversation">;
    data: Omit<Prisma.MessageUncheckedCreateInput, "direction">;
    send: () => Promise<{ Id?: string | null } | null | undefined>;
}) {
    const conversation = await params.db.conversation.findUnique({
        where: { id: params.data.conversationId }, select: { botActive: true, status: true, sourceType: true, sessionExpiresAt: true },
    });
    if (!conversation?.botActive || conversation.status !== "active") return null;
    if (conversation.sourceType === "meta" && (!conversation.sessionExpiresAt || conversation.sessionExpiresAt.getTime() <= Date.now())) {
        throw new Error("La ventana de 24 horas de WhatsApp API está cerrada; se requiere una plantilla aprobada.");
    }

    const message = await params.db.message.create({ data: {
        ...params.data, direction: "outbound", senderType: "bot", status: "sending",
    } });
    try {
        const result = await params.send();
        const providerMessageId = requireProviderMessageId(result);
        // A delivery receipt/echo may already have advanced the state during the request.
        await params.db.message.updateMany({
            where: { id: message.id, status: "sending" }, data: { status: "sent" },
        });
        await params.db.message.update({ where: { id: message.id }, data: { providerMessageId } });
        return message;
    } catch (error) {
        await params.db.message.updateMany({
            where: { id: message.id, status: "sending" }, data: { status: "failed" },
        });
        throw error;
    }
}
