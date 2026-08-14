import { prisma } from "@/lib/db";
import { MESSAGE_SOURCE_WUZAPI, type MessageSourceType } from "@/lib/message-source";
import { Prisma } from "@prisma/client";

export async function findOrCreateActiveConversationForContactSource(params: {
    contactId: string;
    sourceType: MessageSourceType;
    sourceId?: string | null;
    defaults?: {
        assignedUserId?: string | null;
        botActive?: boolean;
        sessionExpiresAt?: Date | null;
    };
}) {
    const sourceId = params.sourceId?.trim() || null;

    const findExistingConversation = () =>
        prisma.conversation.findFirst({
            where: {
                contactId: params.contactId,
                status: "active",
                sourceType: params.sourceType,
                sourceId,
            },
            orderBy: { updatedAt: "desc" },
        });

    if (params.sourceType === MESSAGE_SOURCE_WUZAPI) {
        const existingWuzapiConversations = await prisma.conversation.findMany({
            where: {
                contactId: params.contactId,
                status: "active",
                sourceType: MESSAGE_SOURCE_WUZAPI,
            },
            orderBy: { updatedAt: "desc" },
        });

        if (existingWuzapiConversations.length > 0) {
            return existingWuzapiConversations.sort((left, right) => {
                const leftAssignedScore = left.assignedUserId ? 1 : 0;
                const rightAssignedScore = right.assignedUserId ? 1 : 0;
                if (leftAssignedScore !== rightAssignedScore) {
                    return rightAssignedScore - leftAssignedScore;
                }

                const leftHumanModeScore = left.botActive ? 0 : 1;
                const rightHumanModeScore = right.botActive ? 0 : 1;
                if (leftHumanModeScore !== rightHumanModeScore) {
                    return rightHumanModeScore - leftHumanModeScore;
                }

                return right.updatedAt.getTime() - left.updatedAt.getTime();
            })[0];
        }
    }

    const existingConversation = await findExistingConversation();

    if (existingConversation) {
        return existingConversation;
    }

    try {
        return await prisma.conversation.create({
            data: {
                contactId: params.contactId,
                status: "active",
                sourceType: params.sourceType,
                sourceId: params.sourceType === MESSAGE_SOURCE_WUZAPI ? null : sourceId,
                assignedUserId: params.defaults?.assignedUserId || undefined,
                botActive: params.defaults?.botActive ?? true,
                sessionExpiresAt: params.defaults?.sessionExpiresAt || undefined,
            },
        });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            if (params.sourceType === MESSAGE_SOURCE_WUZAPI) {
                const recoveredWuzapiConversations = await prisma.conversation.findMany({
                    where: {
                        contactId: params.contactId,
                        status: "active",
                        sourceType: MESSAGE_SOURCE_WUZAPI,
                    },
                    orderBy: { updatedAt: "desc" },
                });

                if (recoveredWuzapiConversations.length > 0) {
                    return recoveredWuzapiConversations.sort((left, right) => {
                        const leftAssignedScore = left.assignedUserId ? 1 : 0;
                        const rightAssignedScore = right.assignedUserId ? 1 : 0;
                        if (leftAssignedScore !== rightAssignedScore) {
                            return rightAssignedScore - leftAssignedScore;
                        }

                        const leftHumanModeScore = left.botActive ? 0 : 1;
                        const rightHumanModeScore = right.botActive ? 0 : 1;
                        if (leftHumanModeScore !== rightHumanModeScore) {
                            return rightHumanModeScore - leftHumanModeScore;
                        }

                        return right.updatedAt.getTime() - left.updatedAt.getTime();
                    })[0];
                }
            }

            const recoveredConversation = await findExistingConversation();
            if (recoveredConversation) {
                return recoveredConversation;
            }
        }

        throw error;
    }
}
