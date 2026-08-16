import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeMessageSourceType, resolveMessageSourceId } from "@/lib/message-source";
import { findOrCreateActiveConversationForContactSource } from "@/lib/source-conversations";
import { getSystemSettingsOrDefaults } from "@/lib/system-settings";
import { consumeRateLimit, getBearerToken, getRequestIp, safeSecretEqual } from "@/lib/security";

/**
 * POST /api/bot-message
 * 
 * Called by any external assistant that wants to persist a bot message in the CRM.
 * Stores the bot's response in the CRM so it appears in the chat.
 * 
 * Body:
 *   - to: string (phone number of the recipient, e.g. "524772683928")
 *   - text: string (message content)
 *   - type?: string ("text" | "image" | "audio" | "video" | "document")
 *   - mediaUrl?: string
 *   - mediaType?: string
 *   - mediaFileName?: string
 */
export async function POST(request: NextRequest) {
    try {
        let settings: Awaited<ReturnType<typeof getSystemSettingsOrDefaults>> | null = null;
        let expectedSecret = process.env.BOT_MESSAGE_SECRET || process.env.WUZAPI_USER_TOKEN || "";
        if (!expectedSecret) {
            settings = await getSystemSettingsOrDefaults();
            expectedSecret = settings.whatsappUserToken || "";
        }
        const receivedSecret = getBearerToken(request.headers) || request.headers.get("x-bot-secret") || "";

        if (!expectedSecret) {
            return NextResponse.json({ error: "Integracion no configurada" }, { status: 503 });
        }
        if (!safeSecretEqual(receivedSecret, expectedSecret)) {
            return NextResponse.json({ error: "No autorizado" }, { status: 401 });
        }

        const ip = getRequestIp(request.headers);
        const rateLimit = consumeRateLimit(`bot-message:${ip}`, { limit: 120, windowMs: 60 * 1000 });
        if (!rateLimit.allowed) {
            return NextResponse.json(
                { error: "Demasiadas solicitudes" },
                {
                    status: 429,
                    headers: { "Retry-After": String(Math.max(1, Math.ceil((rateLimit.resetAt - Date.now()) / 1000))) },
                },
            );
        }

        const body = await request.json();
        const { to, text, type = "text", mediaUrl, mediaType, mediaFileName, sourceType } = body;
        const textContent = typeof text === "string" ? text.trim() : "";

        if (!to || (!textContent && !mediaUrl)) {
            return NextResponse.json(
                { error: "Missing required fields: 'to' and ('text' or 'mediaUrl')" },
                { status: 400 }
            );
        }

        // Normalize phone (remove +, spaces, dashes)
        const phone = to.replace(/\D/g, "");
        const suffix10 = phone.slice(-10);

        console.log(`[Bot Message] Storing bot response to ${phone}: ${(textContent || type).substring(0, 50)}...`);

        // Find contact by phone number
        let contact = await prisma.contact.findFirst({
            where: {
                OR: [
                    { phone },
                    { phone: { endsWith: suffix10 } },
                ],
            },
        });

        if (!contact) {
            contact = await prisma.contact.create({
                data: {
                    phone,
                    status: "lead",
                },
            });
            console.log(`[Bot Message] Created contact ${contact.id} for phone ${phone}`);
        }

        settings ||= await getSystemSettingsOrDefaults();
        const normalizedSourceType = normalizeMessageSourceType(sourceType);
        const sourceId = resolveMessageSourceId(normalizedSourceType, settings);
        const conversation = await findOrCreateActiveConversationForContactSource({
            contactId: contact.id,
            sourceType: normalizedSourceType,
            sourceId,
        });

        // Check for recent duplicate (avoid double-storing)
        const recentDuplicate = await prisma.message.findFirst({
            where: {
                conversationId: conversation.id,
                content: textContent || `[${type}]`,
                direction: "outbound",
                sourceType: normalizedSourceType,
                createdAt: { gte: new Date(Date.now() - 15000) }, // Within last 15 seconds
            },
        });

        if (recentDuplicate) {
            console.log(`[Bot Message] Duplicate detected, skipping`);
            return NextResponse.json({ success: true, duplicate: true, messageId: recentDuplicate.id });
        }

        // Store the bot message
        const message = await prisma.message.create({
            data: {
                conversationId: conversation.id,
                content: textContent || `[${type}]`,
                direction: "outbound",
                status: "sent",
                type,
                sourceType: normalizedSourceType,
                sourceId,
                mediaUrl: mediaUrl || null,
                mediaType: mediaType || null,
                mediaFileName: mediaFileName || null,
                senderType: "bot",
            },
        });

        // Update conversation timestamp
        await prisma.conversation.update({
            where: { id: conversation.id },
            data: { updatedAt: new Date() },
        });

        console.log(`[Bot Message] ✓ Stored message ${message.id} for ${contact.name}`);

        return NextResponse.json({
            success: true,
            messageId: message.id,
            contactName: contact.name,
        });

    } catch (error: unknown) {
        console.error("[Bot Message] Error:", error);
        return NextResponse.json(
            { error: "Failed to store bot message" },
            { status: 500 }
        );
    }
}
