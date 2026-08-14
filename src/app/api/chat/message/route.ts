import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { sendWuzapiDeleteMessage } from "@/lib/wuzapi";

export async function DELETE(request: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: "No autorizado." }, { status: 401 });
        }

        const { messageId, conversationId } = await request.json();

        if (!messageId || !conversationId) {
            return NextResponse.json(
                { error: "messageId y conversationId son obligatorios." },
                { status: 400 },
            );
        }

        const message = await prisma.message.findUnique({
            where: { id: messageId },
            select: {
                id: true,
                conversationId: true,
                providerMessageId: true,
                sourceType: true,
                direction: true,
                conversation: {
                    select: {
                        contact: {
                            select: {
                                phone: true,
                            },
                        },
                    },
                },
            },
        });

        if (!message || message.conversationId !== conversationId) {
            return NextResponse.json({
                success: true,
                deletedMessageId: messageId,
                alreadyDeleted: true,
                whatsappSynced: false,
                whatsappWarning: null,
            });
        }

        let whatsappSynced = false;
        let whatsappWarning: string | null = null;

        if (message.providerMessageId && message.conversation?.contact?.phone && message.sourceType === "wuzapi") {
            try {
                await sendWuzapiDeleteMessage({
                    phone: message.conversation.contact.phone,
                    providerMessageId: message.providerMessageId,
                    ownMessage: message.direction === "outbound",
                });
                whatsappSynced = true;
            } catch (syncError) {
                console.error("[API] WhatsApp delete sync error:", syncError);
                whatsappWarning = syncError instanceof Error
                    ? syncError.message
                    : "No se pudo sincronizar borrado con WhatsApp.";
            }
        } else if (message.providerMessageId && !message.conversation?.contact?.phone && message.sourceType === "wuzapi") {
            whatsappWarning = "No hay telefono del contacto para sincronizar borrado con WhatsApp.";
        } else if (message.providerMessageId && message.sourceType !== "wuzapi") {
            whatsappWarning = "Este mensaje proviene de otro origen y no se sincroniza con WhatsApp.";
        } else if (!message.providerMessageId) {
            whatsappWarning = "Este mensaje no tiene identificador nativo para borrarlo en WhatsApp.";
        }

        await prisma.message.delete({
            where: { id: messageId },
        });

        return NextResponse.json({
            success: true,
            deletedMessageId: messageId,
            whatsappSynced,
            whatsappWarning,
        });
    } catch (error) {
        console.error("[API] Delete message error:", error);
        return NextResponse.json(
            { error: "No se pudo eliminar el mensaje." },
            { status: 500 },
        );
    }
}
