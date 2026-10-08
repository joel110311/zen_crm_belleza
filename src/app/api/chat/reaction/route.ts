import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendChannelReaction } from "@/lib/channel-delivery";
import { auth } from "@/lib/auth";
import { ensurePermissionResponse } from "@/lib/authz";

export async function POST(request: NextRequest) {
    try {
        const session = await auth();
        const denied = ensurePermissionResponse(session, "chats.manage");
        if (denied) return denied;

        const { messageId, reaction } = await request.json();
        if (!messageId) {
            return NextResponse.json({ error: "messageId required" }, { status: 400 });
        }

        const existing = await prisma.message.findUnique({
            where: { id: messageId },
            include: {
                conversation: {
                    include: {
                        contact: true,
                    },
                },
            },
        });

        if (!existing) {
            return NextResponse.json({
                success: true,
                messageId,
                reaction: reaction || null,
                whatsappSynced: false,
                whatsappWarning: null,
                notFound: true,
            });
        }

        const nextReaction = typeof reaction === "string" && reaction.trim()
            ? reaction.trim()
            : null;
        const shouldSyncClear = Boolean(existing.reaction && !nextReaction);

        const updated = await prisma.message.update({
            where: { id: messageId },
            data: { reaction: nextReaction },
        });

        let whatsappSynced = false;
        let whatsappWarning: string | null = null;

        if ((nextReaction || shouldSyncClear) && existing.providerMessageId && existing.conversation.contact?.phone) {
            try {
                await sendChannelReaction({
                        sourceType: existing.sourceType === "meta" ? "meta" : "wuzapi",
                        sourceId: existing.sourceId || existing.conversation.sourceId,
                        to: existing.conversation.contact.phone,
                        reaction: nextReaction,
                        providerMessageId: existing.providerMessageId,
                        ownMessage: existing.direction === "outbound",
                });
                whatsappSynced = true;
            } catch (error) {
                console.error("[Reaction API] WhatsApp sync error:", error);
                whatsappWarning = error instanceof Error ? error.message : "No se pudo sincronizar con WhatsApp";
            }
        } else if (nextReaction || shouldSyncClear) {
            whatsappWarning = "Este mensaje no tiene identificador nativo de WhatsApp todavia.";
        }

        return NextResponse.json({
            success: true,
            messageId: updated.id,
            reaction: updated.reaction,
            whatsappSynced,
            whatsappWarning,
        });
    } catch (error) {
        console.error("[Reaction API] Error:", error);
        return NextResponse.json({ error: "Failed to update reaction" }, { status: 500 });
    }
}
