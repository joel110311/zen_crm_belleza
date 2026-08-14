import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sendOutboundConversationMessage } from "@/lib/outbound-messages";

export async function POST(request: NextRequest) {
    try {
        const session = await auth();
        const currentUser = session?.user as { id?: string } | undefined;
        const body = await request.json();
        const {
            conversationId,
            content,
            type = "text",
            sourceType = "wuzapi",
            sourceId = null,
            mediaUrl,
            mediaType,
            mediaFileName,
        } = body;

        if (!conversationId || (!content && !mediaUrl)) {
            return NextResponse.json(
                { error: "conversationId and content or mediaUrl are required" },
                { status: 400 },
            );
        }

        const result = await sendOutboundConversationMessage({
            conversationId,
            content,
            type,
            sourceType,
            sourceId,
            mediaUrl,
            mediaType,
            mediaFileName,
            currentUserId: currentUser?.id || null,
            senderType: "human",
        });

        return NextResponse.json({
            success: true,
            message: result.message,
            conversationId: result.conversation.id,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to send message";
        const status = message === "Conversation not found" ? 404 : 500;

        return NextResponse.json(
            { success: false, error: message },
            { status },
        );
    }
}
