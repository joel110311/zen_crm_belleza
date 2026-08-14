import { prisma } from "@/lib/db";

const CREATE_BATCH_SIZE = 500;

export type ConversationCoverageSnapshot = {
    contactsTotal: number;
    activeConversationsTotal: number;
    contactsWithActiveConversation: number;
    contactsWithoutActiveConversation: number;
};

function chunkArray<T>(items: T[], size: number) {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }
    return chunks;
}

export async function getConversationCoverageSnapshot(): Promise<ConversationCoverageSnapshot> {
    const [contactsTotal, activeConversationsTotal, contactsWithActiveConversation] = await Promise.all([
        prisma.contact.count(),
        prisma.conversation.count({
            where: { status: "active" },
        }),
        prisma.contact.count({
            where: {
                conversations: {
                    some: { status: "active" },
                },
            },
        }),
    ]);

    return {
        contactsTotal,
        activeConversationsTotal,
        contactsWithActiveConversation,
        contactsWithoutActiveConversation: Math.max(0, contactsTotal - contactsWithActiveConversation),
    };
}

export async function backfillMissingActiveConversations(params?: { dryRun?: boolean }) {
    const before = await getConversationCoverageSnapshot();

    const missingContacts = await prisma.contact.findMany({
        where: {
            conversations: {
                none: {
                    status: "active",
                },
            },
        },
        select: {
            id: true,
        },
    });

    let createdConversations = 0;

    if (!params?.dryRun && missingContacts.length > 0) {
        const missingContactIds = missingContacts.map((contact) => contact.id);
        const chunks = chunkArray(missingContactIds, CREATE_BATCH_SIZE);

        for (const contactIdChunk of chunks) {
            const result = await prisma.conversation.createMany({
                data: contactIdChunk.map((contactId) => ({
                    contactId,
                    status: "active",
                    sourceType: "wuzapi",
                    botActive: true,
                })),
            });
            createdConversations += result.count;
        }
    }

    const after = await getConversationCoverageSnapshot();

    return {
        dryRun: Boolean(params?.dryRun),
        createdConversations,
        contactsMissingBefore: missingContacts.length,
        before,
        after,
    };
}
