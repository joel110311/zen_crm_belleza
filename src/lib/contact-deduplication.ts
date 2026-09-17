import { buildPhoneMatchClauses, extractNational10 } from "./phone.ts";

export type DeduplicationContact = {
    id: string;
    phone: string;
    name?: string | null;
    lastName?: string | null;
    email?: string | null;
    company?: string | null;
    role?: string | null;
    whatsappAvatarUrl?: string | null;
    whatsappAvatarPictureId?: string | null;
    whatsappAvatarCheckedAt?: Date | null;
    whatsappAvatarUpdatedAt?: Date | null;
    bulkCampaignOptOutAt?: Date | null;
    bulkCampaignOptOutReason?: string | null;
    tags?: string[];
    status?: string;
    createdAt?: Date;
    updatedAt?: Date;
    deals?: Array<{ id: string }>;
    appointments?: Array<{ id: string }>;
    patients?: Array<{ id: string }>;
    conversations?: Array<{
        id: string;
        sourceType?: string | null;
        sourceId?: string | null;
        messages?: Array<{ id: string }>;
    }>;
};

export type PrismaLikeClient = {
    contact: {
        findMany: (args: Record<string, unknown>) => Promise<DeduplicationContact[]>;
        findFirst?: (args: Record<string, unknown>) => Promise<DeduplicationContact | null>;
        update: (args: Record<string, unknown>) => Promise<unknown>;
        delete: (args: Record<string, unknown>) => Promise<unknown>;
    };
    conversation: {
        findMany?: (args: Record<string, unknown>) => Promise<unknown[]>;
        update: (args: Record<string, unknown>) => Promise<unknown>;
        delete: (args: Record<string, unknown>) => Promise<unknown>;
    };
    message: {
        updateMany: (args: Record<string, unknown>) => Promise<unknown>;
    };
    appointment?: {
        updateMany: (args: Record<string, unknown>) => Promise<unknown>;
    };
    patient?: {
        updateMany: (args: Record<string, unknown>) => Promise<unknown>;
    };
    deal?: {
        updateMany: (args: Record<string, unknown>) => Promise<unknown>;
    };
    cashMovement?: {
        updateMany: (args: Record<string, unknown>) => Promise<unknown>;
    };
    paymentLink?: {
        updateMany: (args: Record<string, unknown>) => Promise<unknown>;
    };
    bulkCampaignRecipient?: {
        updateMany: (args: Record<string, unknown>) => Promise<unknown>;
    };
};

let defaultDbPromise: Promise<PrismaLikeClient | null> | null = null;

async function getDefaultDb(): Promise<PrismaLikeClient | null> {
    if (!defaultDbPromise) {
        defaultDbPromise = (async () => {
            try {
                const dbModule = await import("./db.ts").catch(() => import("@/lib/db"));
                return (dbModule as unknown as { prisma: PrismaLikeClient }).prisma;
            } catch {
                return null;
            }
        })();
    }
    return defaultDbPromise;
}

function scoreContactQuality(contact: DeduplicationContact): number {
    let score = 0;
    const name = (contact.name || "").trim();
    const isNumericName = name.length >= 8 && name.replace(/\D/g, "").length >= 8 && name.replace(/[+\s-]/g, "").replace(/\D/g, "") === name.replace(/\D/g, "");
    if (name && !isNumericName && name.length > 2) {
        score += 100;
    }
    if (contact.lastName?.trim()) score += 20;
    if (contact.email?.trim()) score += 20;
    if (contact.deals && contact.deals.length > 0) score += 50;
    if (contact.appointments && contact.appointments.length > 0) score += 50;
    if (contact.patients && contact.patients.length > 0) score += 50;
    const msgCount = Array.isArray(contact.conversations)
        ? contact.conversations.reduce((sum: number, conv) => sum + (conv.messages?.length || 0), 0)
        : 0;
    score += msgCount * 10;
    return score;
}

/**
 * Merges a duplicate contact into a primary contact:
 * - Moves all messages from duplicate conversations to primary conversations
 * - Moves appointments, patients, deals, payment links, cash movements, campaign recipients
 * - Inherits name/avatar if primary is missing them
 * - Deletes the duplicate conversation and contact
 */
export async function mergeDuplicateContactRecords(
    primary: DeduplicationContact,
    duplicates: DeduplicationContact[],
    db: PrismaLikeClient,
) {
    for (const dup of duplicates) {
        if (dup.id === primary.id) continue;

        const dupConversations = dup.conversations || [];
        const primaryConversations = primary.conversations || [];

        for (const dupConv of dupConversations) {
            const matchingPrimaryConv = primaryConversations.find(
                (pc) => pc.sourceType === dupConv.sourceType && (!pc.sourceId || pc.sourceId === dupConv.sourceId),
            ) || primaryConversations[0];

            if (matchingPrimaryConv && matchingPrimaryConv.id !== dupConv.id) {
                // Transfer messages to matching conversation
                await db.message.updateMany({
                    where: { conversationId: dupConv.id },
                    data: { conversationId: matchingPrimaryConv.id },
                });
                // Transfer campaign recipients if any
                if (db.bulkCampaignRecipient) {
                    await db.bulkCampaignRecipient.updateMany({
                        where: { conversationId: dupConv.id },
                        data: { conversationId: matchingPrimaryConv.id },
                    }).catch(() => {});
                }
                // Delete duplicate conversation
                await db.conversation.delete({
                    where: { id: dupConv.id },
                }).catch((err) => {
                    console.warn("[Deduplication] Could not delete dup conversation:", dupConv.id, err);
                });
            } else {
                // Re-link orphan conversation to primary contact
                await db.conversation.update({
                    where: { id: dupConv.id },
                    data: { contactId: primary.id },
                }).catch(() => {});
            }
        }

        // Re-link relations
        if (db.appointment) await db.appointment.updateMany({ where: { contactId: dup.id }, data: { contactId: primary.id } }).catch(() => {});
        if (db.patient) await db.patient.updateMany({ where: { contactId: dup.id }, data: { contactId: primary.id } }).catch(() => {});
        if (db.deal) await db.deal.updateMany({ where: { contactId: dup.id }, data: { contactId: primary.id } }).catch(() => {});
        if (db.cashMovement) await db.cashMovement.updateMany({ where: { contactId: dup.id }, data: { contactId: primary.id } }).catch(() => {});
        if (db.paymentLink) await db.paymentLink.updateMany({ where: { contactId: dup.id }, data: { contactId: primary.id } }).catch(() => {});
        if (db.bulkCampaignRecipient) await db.bulkCampaignRecipient.updateMany({ where: { contactId: dup.id }, data: { contactId: primary.id } }).catch(() => {});

        // Inherit fields if primary was missing them
        const updates: Record<string, unknown> = {};
        if (!primary.name && dup.name) updates.name = dup.name;
        if (!primary.lastName && dup.lastName) updates.lastName = dup.lastName;
        if (!primary.email && dup.email) updates.email = dup.email;
        if (!primary.whatsappAvatarUrl && dup.whatsappAvatarUrl) {
            updates.whatsappAvatarUrl = dup.whatsappAvatarUrl;
            updates.whatsappAvatarPictureId = dup.whatsappAvatarPictureId;
        }

        if (Object.keys(updates).length > 0) {
            await db.contact.update({
                where: { id: primary.id },
                data: updates,
            }).catch(() => {});
        }

        // Delete duplicate contact
        await db.contact.delete({
            where: { id: dup.id },
        }).catch((err) => {
            console.warn("[Deduplication] Could not delete duplicate contact:", dup.id, err);
        });
    }
}

/**
 * Finds all contacts that match any representation of the given phone candidates.
 * If multiple duplicate contacts exist for the same number, consolidates them into the best primary contact.
 */
export async function findAndConsolidateContact(
    phoneCandidates: string[],
    customDb?: unknown,
) {
    const db = (customDb || (await getDefaultDb())) as PrismaLikeClient | null;
    if (!db) return null;
    const clauses = buildPhoneMatchClauses(phoneCandidates);
    if (clauses.length === 0) return null;

    const contacts = await db.contact.findMany({
        where: { OR: clauses },
        include: {
            conversations: {
                include: {
                    messages: {
                        take: 5,
                        orderBy: { createdAt: "desc" },
                    },
                },
            },
            appointments: { select: { id: true } },
            patients: { select: { id: true } },
            deals: { select: { id: true } },
        },
        orderBy: { createdAt: "asc" },
    });

    // Also look for contacts whose national10 matches if not already in list
    const national10 = phoneCandidates
        .map(extractNational10)
        .find((n) => n.length === 10);

    if (national10) {
        const last4 = national10.slice(-4);
        const potentialContacts = await db.contact.findMany({
            where: {
                phone: { contains: last4 },
                id: { notIn: contacts.map((c) => c.id) },
            },
            include: {
                conversations: {
                    include: {
                        messages: {
                            take: 5,
                            orderBy: { createdAt: "desc" },
                        },
                    },
                },
                appointments: { select: { id: true } },
                patients: { select: { id: true } },
                deals: { select: { id: true } },
            },
            take: 50,
        });

        for (const candidate of potentialContacts) {
            if (extractNational10(candidate.phone) === national10) {
                contacts.push(candidate);
            }
        }
    }

    if (contacts.length === 0) return null;
    if (contacts.length === 1) return contacts[0];

    const scored = contacts.map((c) => ({
        contact: c,
        score: scoreContactQuality(c),
    }));

    scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const aTime = a.contact.createdAt instanceof Date ? a.contact.createdAt.getTime() : 0;
        const bTime = b.contact.createdAt instanceof Date ? b.contact.createdAt.getTime() : 0;
        return aTime - bTime;
    });

    const primary = scored[0].contact;
    const duplicates = scored.slice(1).map((s) => s.contact);

    await mergeDuplicateContactRecords(primary, duplicates, db);

    return primary;
}

/**
 * Scans a list of conversations and merges any that belong to duplicate contacts
 * sharing the same 10-digit national number.
 */
export async function consolidateConversationsList(
    conversations: Array<{ id: string; contact?: { id?: string | null; phone?: string | null } | null }>,
    customDb?: unknown,
): Promise<boolean> {
    if (!conversations || conversations.length <= 1) return false;

    const db = (customDb || (await getDefaultDb())) as PrismaLikeClient | null;
    if (!db) return false;
    const nationalMap = new Map<string, string[]>();

    for (const conv of conversations) {
        const phone = conv.contact?.phone;
        const nat10 = extractNational10(phone);
        if (nat10 && nat10.length === 10) {
            const list = nationalMap.get(nat10) || [];
            if (conv.contact?.id && !list.includes(conv.contact.id)) {
                list.push(conv.contact.id);
            }
            nationalMap.set(nat10, list);
        }
    }

    let anyMerged = false;
    for (const [nat10, contactIds] of nationalMap.entries()) {
        if (contactIds.length > 1) {
            try {
                await findAndConsolidateContact([nat10], db);
                anyMerged = true;
            } catch (err) {
                console.warn("[Deduplication] Failed to consolidate for nat10:", nat10, err);
            }
        }
    }

    return anyMerged;
}
