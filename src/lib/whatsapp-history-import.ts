import { prisma } from "@/lib/db";
import { buildPhoneMatchClauses, getPhoneSuffix, normalizePhoneDigits } from "@/lib/phone";
import {
    getWuzapiChatHistory,
    getWuzapiHistoryIndex,
    getWuzapiSessionStatus,
    requestWuzapiHistorySync,
    setWuzapiHistoryLimit,
    type WuzapiHistoryIndexRecord,
    type WuzapiHistoryMessageRecord,
} from "@/lib/wuzapi";
import { refreshWhatsAppAvatarForContacts } from "@/lib/whatsapp-avatar";

const HISTORY_FETCH_LIMIT_BY_MONTHS: Record<1 | 2 | 3, number> = {
    1: 1500,
    2: 3000,
    3: 5000,
};

const HISTORY_DAYS_BY_MONTHS: Record<1 | 2 | 3, number> = {
    1: 30,
    2: 60,
    3: 90,
};

const HISTORY_SYNC_REQUEST_COUNT_BY_MONTHS: Record<1 | 2 | 3, number> = {
    1: 150,
    2: 300,
    3: 450,
};

type ImportWhatsAppHistoryOptions = {
    months: 1 | 2 | 3;
};

type ImportWhatsAppHistorySummary = {
    months: 1 | 2 | 3;
    cutoffAt: string;
    syncRequested: boolean;
    chatsDiscovered: number;
    chatsImported: number;
    contactsCreated: number;
    contactsUpdated: number;
    conversationsCreated: number;
    messagesCreated: number;
    messagesSkipped: number;
};

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeHistoryMonths(value: number) {
    if (value >= 3) return 3;
    if (value >= 2) return 2;
    return 1;
}

function resolveCutoffDate(months: 1 | 2 | 3) {
    const days = HISTORY_DAYS_BY_MONTHS[months];
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function resolveHistoryIndexChatJid(entry: WuzapiHistoryIndexRecord) {
    return (entry.chat_jid || entry.ChatJID || "").trim();
}

function isDirectChatJid(value: string) {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return false;
    if (normalized.includes("@g.us")) return false;
    if (normalized.includes("@broadcast")) return false;
    if (normalized.includes("@newsletter")) return false;
    if (normalized.includes("@lid")) return false;
    return normalized.includes("@s.whatsapp.net");
}

function getPhoneFromChatJid(chatJid: string) {
    const normalized = chatJid.replace(/:\d+@/, "@");
    const phone = normalized.includes("@")
        ? normalized.split("@")[0]
        : normalized;
    return normalizePhoneDigits(phone);
}

function phonesLikelyMatch(left: string, right: string) {
    const normalizedLeft = normalizePhoneDigits(left);
    const normalizedRight = normalizePhoneDigits(right);
    if (!normalizedLeft || !normalizedRight) return false;
    if (normalizedLeft === normalizedRight) return true;
    return getPhoneSuffix(normalizedLeft) === getPhoneSuffix(normalizedRight);
}

function resolveDirection(chatPhone: string, senderJid: string) {
    if (senderJid === "me") return "outbound";
    return phonesLikelyMatch(chatPhone, senderJid)
        ? "inbound"
        : "outbound";
}

function parseHistoryTimestamp(value: string | number | undefined | null) {
    if (value === undefined || value === null) return null;

    const raw = String(value).trim();
    if (!raw) return null;

    if (/^\d+(\.\d+)?$/.test(raw)) {
        const numeric = Number.parseFloat(raw);
        if (Number.isFinite(numeric) && numeric > 0) {
            const millis = numeric >= 1e12 ? Math.trunc(numeric) : Math.trunc(numeric * 1000);
            const fromEpoch = new Date(millis);
            if (!Number.isNaN(fromEpoch.getTime())) {
                return fromEpoch;
            }
        }
    }

    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
        return parsed;
    }

    const normalized = raw.replace(" UTC", "").replace(" ", "T");
    const normalizedParsed = new Date(normalized);
    return Number.isNaN(normalizedParsed.getTime()) ? null : normalizedParsed;
}

function mapHistoryMessageType(value: string | undefined) {
    const normalized = (value || "").trim().toLowerCase();
    if (normalized === "image" || normalized === "audio" || normalized === "video" || normalized === "document") {
        return normalized;
    }
    return "text";
}

function normalizeHistoryContent(message: WuzapiHistoryMessageRecord) {
    const messageType = (message.message_type || "").trim().toLowerCase();
    const rawContent = (message.text_content || "").trim();

    if (rawContent === ":image:") return "[Imagen]";
    if (rawContent === ":video:") return "[Video]";
    if (rawContent === ":audio:") return "[Audio]";
    if (rawContent === ":document:") return "[Documento]";
    if (rawContent === ":sticker:") return "[Sticker]";
    if (rawContent === ":contact:") return "[Contacto]";
    if (rawContent === ":location:") return "[Ubicacion]";

    if (rawContent) return rawContent;

    if (messageType === "reaction") {
        return "[Reaccion]";
    }

    if (messageType === "buttons_response" || messageType === "list_response") {
        return "[Respuesta interactiva]";
    }

    if (messageType === "image") return "[Imagen]";
    if (messageType === "video") return "[Video]";
    if (messageType === "audio") return "[Audio]";
    if (messageType === "document") return "[Documento]";

    return "[Mensaje de WhatsApp]";
}

async function waitForHistoryIndex() {
    let latestEntries: WuzapiHistoryIndexRecord[] = [];
    let lastSignature = "";
    let stableReads = 0;

    for (let attempt = 0; attempt < 5; attempt += 1) {
        if (attempt > 0) {
            await sleep(3500);
        }

        const nextEntries = await getWuzapiHistoryIndex().catch(() => latestEntries);
        const deduplicated = new Map<string, WuzapiHistoryIndexRecord>();

        for (const entry of nextEntries) {
            const chatJid = resolveHistoryIndexChatJid(entry);
            if (!isDirectChatJid(chatJid)) continue;
            deduplicated.set(chatJid, entry);
        }

        latestEntries = [...deduplicated.values()];
        const signature = latestEntries
            .map((entry) => `${resolveHistoryIndexChatJid(entry)}:${entry.last_updated || entry.LastUpdated || ""}`)
            .sort()
            .join("|");

        if (signature && signature === lastSignature) {
            stableReads += 1;
        } else {
            stableReads = 0;
        }

        lastSignature = signature;

        if (signature && stableReads >= 1) {
            break;
        }
    }

    return latestEntries;
}

async function importDirectChatHistory(params: {
    chatJid: string;
    cutoff: Date;
    historyLimit: number;
}) {
    const phone = getPhoneFromChatJid(params.chatJid);
    if (!phone) {
        return {
            imported: false,
            contactId: null,
            contactsCreated: 0,
            contactsUpdated: 0,
            conversationsCreated: 0,
            messagesCreated: 0,
            messagesSkipped: 0,
        };
    }

    const rawMessages = await getWuzapiChatHistory(params.chatJid, params.historyLimit);
    const relevantMessages = rawMessages
        .map((message) => ({
            ...message,
            parsedTimestamp: parseHistoryTimestamp(message.timestamp),
        }))
        .filter((message) => message.parsedTimestamp && message.parsedTimestamp >= params.cutoff)
        .sort((left, right) => left.parsedTimestamp!.getTime() - right.parsedTimestamp!.getTime());

    if (relevantMessages.length === 0) {
        return {
            imported: false,
            contactId: null,
            contactsCreated: 0,
            contactsUpdated: 0,
            conversationsCreated: 0,
            messagesCreated: 0,
            messagesSkipped: rawMessages.length,
        };
    }

    let conversationsCreated = 0;
    let messagesCreated = 0;
    let messagesSkipped = 0;
    let contactId: string | null = null;

    await prisma.$transaction(async (tx) => {
        const contact = await tx.contact.findFirst({
            where: {
                OR: buildPhoneMatchClauses([phone]),
            },
        });

        if (!contact) {
            // Requested behavior: do not import contacts during history import.
            messagesSkipped += relevantMessages.length;
            return;
        }
        contactId = contact.id;

        let conversation = await tx.conversation.findFirst({
            where: {
                contactId: contact.id,
                status: "active",
                sourceType: "wuzapi",
            },
            orderBy: {
                updatedAt: "desc",
            },
        });

        const createdConversation = !conversation;
        if (!conversation) {
            conversation = await tx.conversation.create({
                data: {
                    contactId: contact.id,
                    status: "active",
                    sourceType: "wuzapi",
                },
            });
            conversationsCreated += 1;
        }
        const activeConversation = conversation;

        const providerMessageIds = relevantMessages
            .map((message) => (message.message_id || "").trim())
            .filter(Boolean);
        const existingMessages = providerMessageIds.length > 0
            ? await tx.message.findMany({
                where: {
                    providerMessageId: {
                        in: providerMessageIds,
                    },
                },
                select: {
                    providerMessageId: true,
                },
            })
            : [];
        const existingMessageIds = new Set(
            existingMessages
                .map((message) => message.providerMessageId)
                .filter((value): value is string => Boolean(value)),
        );

        const messagesToCreate = relevantMessages
            .filter((message) => {
                const providerMessageId = (message.message_id || "").trim();
                return providerMessageId ? !existingMessageIds.has(providerMessageId) : false;
            })
            .map((message) => {
                const direction = resolveDirection(phone, message.sender_jid || "");
                return {
                    conversationId: activeConversation.id,
                    content: normalizeHistoryContent(message),
                    direction,
                    status: direction === "outbound" ? "sent" : "delivered",
                    type: mapHistoryMessageType(message.message_type),
                    sourceType: "wuzapi",
                    senderType: direction === "outbound" ? "human" : null,
                    providerMessageId: (message.message_id || "").trim() || null,
                    createdAt: message.parsedTimestamp!,
                };
            });

        messagesSkipped += relevantMessages.length - messagesToCreate.length;

        if (messagesToCreate.length > 0) {
            await tx.message.createMany({
                data: messagesToCreate,
            });
            messagesCreated += messagesToCreate.length;
        }

        const firstImportedAt = relevantMessages[0]?.parsedTimestamp;
        const lastImportedAt = relevantMessages[relevantMessages.length - 1]?.parsedTimestamp;

        if (createdConversation && firstImportedAt && lastImportedAt) {
            await tx.$executeRaw`
                UPDATE "Conversation"
                SET "createdAt" = ${firstImportedAt},
                    "updatedAt" = ${lastImportedAt}
                WHERE id = ${activeConversation.id}
            `;
        } else if (lastImportedAt && lastImportedAt > activeConversation.updatedAt) {
            await tx.$executeRaw`
                UPDATE "Conversation"
                SET "updatedAt" = ${lastImportedAt}
                WHERE id = ${activeConversation.id}
            `;
        }
    });

    return {
        imported: Boolean(contactId),
        contactId,
        contactsCreated: 0,
        contactsUpdated: 0,
        conversationsCreated,
        messagesCreated,
        messagesSkipped,
    };
}

export async function importWhatsAppHistory(
    options: ImportWhatsAppHistoryOptions,
): Promise<ImportWhatsAppHistorySummary> {
    const months = normalizeHistoryMonths(options.months) as 1 | 2 | 3;
    const cutoff = resolveCutoffDate(months);
    const session = await getWuzapiSessionStatus();

    if (!session.loggedIn) {
        throw new Error("Conecta y vincula el numero primero para poder importar el historial.");
    }
    if (!session.connected) {
        throw new Error("La sesion esta pausada. Reconecta el canal antes de importar el historial.");
    }

    await setWuzapiHistoryLimit(HISTORY_FETCH_LIMIT_BY_MONTHS[months]);

    let syncRequested = false;
    try {
        await requestWuzapiHistorySync({
            count: HISTORY_SYNC_REQUEST_COUNT_BY_MONTHS[months],
        });
        syncRequested = true;
    } catch (error) {
        console.warn("[WhatsAppHistoryImport] History sync request failed, continuing with cached history", error);
    }

    const historyIndex = await waitForHistoryIndex();

    let chatsImported = 0;
    let contactsCreated = 0;
    let contactsUpdated = 0;
    let conversationsCreated = 0;
    let messagesCreated = 0;
    let messagesSkipped = 0;
    const contactsToRefresh = new Set<string>();

    for (const entry of historyIndex) {
        const chatJid = resolveHistoryIndexChatJid(entry);
        if (!isDirectChatJid(chatJid)) {
            continue;
        }

        const result = await importDirectChatHistory({
            chatJid,
            cutoff,
            historyLimit: HISTORY_FETCH_LIMIT_BY_MONTHS[months],
        });

        if (result.imported) {
            chatsImported += 1;
        }
        if (result.contactId) {
            contactsToRefresh.add(result.contactId);
        }
        contactsCreated += result.contactsCreated;
        contactsUpdated += result.contactsUpdated;
        conversationsCreated += result.conversationsCreated;
        messagesCreated += result.messagesCreated;
        messagesSkipped += result.messagesSkipped;
    }

    if (contactsToRefresh.size > 0) {
        await refreshWhatsAppAvatarForContacts([...contactsToRefresh], {
            limit: 80,
            concurrency: 4,
        });
    }

    return {
        months,
        cutoffAt: cutoff.toISOString(),
        syncRequested,
        chatsDiscovered: historyIndex.length,
        chatsImported,
        contactsCreated,
        contactsUpdated,
        conversationsCreated,
        messagesCreated,
        messagesSkipped,
    };
}

export async function clearCrmChatHistory() {
    await prisma.$transaction(async (tx) => {
        await tx.bulkCampaignRecipient.updateMany({
            where: {
                conversationId: {
                    not: null,
                },
            },
            data: {
                conversationId: null,
            },
        });

        await tx.message.deleteMany();
        await tx.catalogConversationState.deleteMany();
        await tx.conversation.deleteMany();
    });
}
