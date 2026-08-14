// API route for chat operations - with robust error handling
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { refreshWhatsAppAvatarForContactsInBackground } from "@/lib/whatsapp-avatar";
import { formatPhoneForDisplay } from "@/lib/operation-context";
import type { Prisma } from "@prisma/client";

let lastAvatarRefreshKickAt = 0;
const CHAT_AVATAR_REFRESH_KICK_INTERVAL_MS = 30 * 60 * 1000;
const DEFAULT_CONVERSATION_LIMIT = 300;
const MAX_CONVERSATION_LIMIT = 5000;
const DEFAULT_MESSAGE_LIMIT = 75;
const MAX_MESSAGE_LIMIT = 150;

function shouldKickAvatarRefresh() {
    const now = Date.now();
    if (now - lastAvatarRefreshKickAt < CHAT_AVATAR_REFRESH_KICK_INTERVAL_MS) {
        return false;
    }
    lastAvatarRefreshKickAt = now;
    return true;
}

function parseIsoDate(value: string | null) {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }
    return parsed;
}

function parseBoundedInt(value: string | null, fallback: number, min: number, max: number) {
    const parsed = Number.parseInt(value || String(fallback), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
}

function formatPhone(phone: string | null | undefined) {
    return formatPhoneForDisplay(phone) || null;
}

function normalizeContactName(name?: string | null) {
    const normalized = name?.trim().replace(/\s+/g, " ") || "";
    if (!normalized) return null;

    if (/^(unknown|desconocido|sin nombre|null|undefined|n\/a|na)$/i.test(normalized)) {
        return null;
    }

    return normalized;
}

function getConversationContactName(contact: {
    name?: string | null;
    lastName?: string | null;
    phone?: string | null;
} | null | undefined) {
    const firstName = normalizeContactName(contact?.name);
    const lastName = normalizeContactName(contact?.lastName);
    const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();

    if (fullName) return fullName;
    return formatPhone(contact?.phone) || "Contacto sin nombre";
}

// GET /api/chat - Get all conversations or messages for a specific conversation
export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get("conversationId");

    const since = searchParams.get("since");
    const updatedSince = parseIsoDate(searchParams.get("updatedSince"));
    const beforeUpdatedAt = parseIsoDate(searchParams.get("beforeUpdatedAt"));
    const beforeMessageAt = parseIsoDate(searchParams.get("before"));
    const conversationLimit = parseBoundedInt(
        searchParams.get("limit"),
        DEFAULT_CONVERSATION_LIMIT,
        1,
        MAX_CONVERSATION_LIMIT,
    );
    const messageLimit = parseBoundedInt(
        searchParams.get("messageLimit"),
        DEFAULT_MESSAGE_LIMIT,
        1,
        MAX_MESSAGE_LIMIT,
    );

    try {
        if (conversationId) {
            // Get messages for a specific conversation
            const whereClause: Prisma.MessageWhereInput = { conversationId };
            const sinceDate = parseIsoDate(since);
            if (sinceDate) {
                // Subtract 1 second to handle Postgres millisecond truncation race conditions
                sinceDate.setSeconds(sinceDate.getSeconds() - 1);
                whereClause.createdAt = { gt: sinceDate };
            } else if (beforeMessageAt) {
                whereClause.createdAt = { lt: beforeMessageAt };
            }

            const messages = await prisma.message.findMany({
                where: whereClause,
                orderBy: [
                    { createdAt: "desc" },
                    { id: "desc" },
                ], // Get newest first
                take: sinceDate ? undefined : messageLimit,
            });
            // Reverse so they are chronological for UI
            return NextResponse.json(messages.reverse());
        } else {
            const conversationWhere: Prisma.ConversationWhereInput = {};
            if (updatedSince) {
                // Apply a small overlap window to avoid missing updates due clock skew.
                conversationWhere.updatedAt = { gt: new Date(updatedSince.getTime() - 1000) };
            } else if (beforeUpdatedAt) {
                conversationWhere.updatedAt = { lt: beforeUpdatedAt };
            }

            // Get all conversations with last message
            const conversations = await prisma.conversation.findMany({
                where: conversationWhere,
                include: {
                    contact: {
                        include: {
                            deals: {
                                orderBy: { updatedAt: "desc" },
                                take: 1,
                                include: {
                                    stage: true,
                                    intelligence: true,
                                },
                            },
                        },
                    },
                    assignedUser: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                            role: true,
                        },
                    },
                    messages: {
                        where: {
                            type: {
                                not: "system",
                            },
                        },
                        orderBy: [
                            { createdAt: "desc" },
                            { id: "desc" },
                        ],
                        take: 1,
                    },
                },
                orderBy: { updatedAt: "desc" },
                take: conversationLimit,
            });

            // Transform for frontend
            const result = conversations.map((conv) => ({
                currentDeal: conv.contact?.deals?.[0]
                    ? {
                        id: conv.contact.deals[0].id,
                        stageName: conv.contact.deals[0].stage?.name || null,
                    }
                    : null,
                id: conv.id,
                contactId: conv.contact?.id || null,
                contactName: getConversationContactName(conv.contact),
                contactPhone: conv.contact?.phone,
                contactEmail: conv.contact?.email,
                contactCompany: conv.contact?.company,
                contactStatus: conv.contact?.status,
                contactAvatarUrl: conv.contact?.whatsappAvatarUrl || null,
                lastMessage: conv.messages[0]?.content || "",
                lastMessageTime: conv.messages[0]?.createdAt || conv.updatedAt,
                updatedAt: conv.updatedAt,
                lastMessageType: conv.messages[0]?.type || "text",
                lastMessageDirection: conv.messages[0]?.direction || "inbound",
                lastMessageSenderType: conv.messages[0]?.senderType || null,
                sourceType: conv.sourceType || "wuzapi",
                sourceId: conv.sourceId || null,
                lastMessageSourceType: conv.messages[0]?.sourceType || conv.sourceType || "wuzapi",
                lastMessageSourceId: conv.messages[0]?.sourceId || conv.sourceId || null,
                sessionExpiresAt: conv.sessionExpiresAt,
                status: conv.status,
                isMuted: conv.isMuted,
                isFavorite: conv.isFavorite,
                isGroup: conv.isGroup,
                botActive: conv.botActive,
                assignedUserId: conv.assignedUserId,
                assignedUser: conv.assignedUser,
                leadIntelligence: conv.contact?.deals?.[0]?.intelligence
                    ? {
                        score: conv.contact.deals[0].intelligence.score,
                        interestStatus: conv.contact.deals[0].intelligence.interestStatus,
                        currentStep: conv.contact.deals[0].intelligence.currentStep,
                        stepProgress: conv.contact.deals[0].intelligence.stepProgress,
                        capturedName: conv.contact.deals[0].intelligence.capturedName,
                        capturedEmail: conv.contact.deals[0].intelligence.capturedEmail,
                        sameDayInboundCount: conv.contact.deals[0].intelligence.sameDayInboundCount,
                    }
                    : null,
            }));

            const contactIds = conversations
                .map((conv) => conv.contact?.id)
                .filter((id): id is string => Boolean(id))
                .slice(0, 20);
            if (shouldKickAvatarRefresh()) {
                refreshWhatsAppAvatarForContactsInBackground(contactIds, {
                    limit: 8,
                    concurrency: 2,
                });
            }

            return NextResponse.json(result);
        }
    } catch (error) {
        console.error("[API] Chat error:", error);
        return NextResponse.json([]);
    }
}
