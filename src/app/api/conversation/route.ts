// API route for conversation actions: mute, favorite, close, clear, delete
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { conversationId, action, botActive, assignedUserId } = body;

        if (!conversationId || !action) {
            return NextResponse.json({ error: "conversationId and action are required" }, { status: 400 });
        }

        const session = await auth();
        const currentUser = session?.user as { id?: string; role?: string; permissions?: unknown } | undefined;

        console.log("[API] Conversation action:", action, "for:", conversationId);

        switch (action) {
            case "mute": {
                const conv = await prisma.conversation.findUnique({ where: { id: conversationId } });
                const updated = await prisma.conversation.update({
                    where: { id: conversationId },
                    data: { isMuted: !conv?.isMuted },
                });
                return NextResponse.json({ success: true, isMuted: updated.isMuted });
            }

            case "favorite": {
                const conv = await prisma.conversation.findUnique({ where: { id: conversationId } });
                const updated = await prisma.conversation.update({
                    where: { id: conversationId },
                    data: { isFavorite: !conv?.isFavorite },
                });
                return NextResponse.json({ success: true, isFavorite: updated.isFavorite });
            }

            case "close": {
                await prisma.conversation.update({
                    where: { id: conversationId },
                    data: { status: "closed" },
                });
                return NextResponse.json({ success: true, status: "closed" });
            }

            case "reopen": {
                await prisma.conversation.update({
                    where: { id: conversationId },
                    data: { status: "active" },
                });
                return NextResponse.json({ success: true, status: "active" });
            }

            case "clear": {
                // Delete all messages in the conversation
                await prisma.message.deleteMany({
                    where: { conversationId },
                });
                return NextResponse.json({ success: true, messagesCleared: true });
            }

            case "delete": {
                // Delete all messages first, then the conversation
                await prisma.message.deleteMany({
                    where: { conversationId },
                });
                await prisma.conversation.delete({
                    where: { id: conversationId },
                });
                return NextResponse.json({ success: true, deleted: true });
            }

            case "toggleBot": {
                const conv = await prisma.conversation.findUnique({
                    where: { id: conversationId },
                });
                const newBotActive = typeof botActive === "boolean"
                    ? botActive
                    : !conv?.botActive;
                const updated = await prisma.conversation.update({
                    where: { id: conversationId },
                    data: { botActive: newBotActive },
                });

                return NextResponse.json({ success: true, botActive: updated.botActive });
            }

            case "assign": {
                const nextAssignedUserId =
                    typeof assignedUserId === "string" && assignedUserId.trim().length > 0
                        ? assignedUserId.trim()
                        : null;

                if (
                    !hasPermission(currentUser, "users.manage") &&
                    nextAssignedUserId &&
                    nextAssignedUserId !== currentUser?.id
                ) {
                    return NextResponse.json({ error: "No tienes permiso para asignar a otro usuario." }, { status: 403 });
                }

                const updated = await prisma.conversation.update({
                    where: { id: conversationId },
                    data: { assignedUserId: nextAssignedUserId },
                    include: {
                        assignedUser: {
                            select: {
                                id: true,
                                name: true,
                                email: true,
                                role: true,
                            },
                        },
                    },
                });

                return NextResponse.json({
                    success: true,
                    assignedUserId: updated.assignedUserId,
                    assignedUser: updated.assignedUser,
                });
            }

            default:
                return NextResponse.json({ error: "Unknown action" }, { status: 400 });
        }
    } catch (error) {
        console.error("[API] Conversation action error:", error);
        return NextResponse.json({ error: "Action failed" }, { status: 500 });
    }
}
