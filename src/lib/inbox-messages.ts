export type Message = {
    id: string;
    content: string;
    senderId: string | null;
    direction: string;
    createdAt: Date;
    type: string;
    status?: string | null;
    sourceType: "wuzapi" | "meta";
    sourceId?: string | null;
    senderType?: string | null;
    mediaUrl?: string | null;
    mediaType?: string | null;
    mediaFileName?: string | null;
    reaction?: string | null;
};

export function isTemporaryMessage(message: Message) {
    return message.id.startsWith("temp-");
}

function normalizeComparableMediaUrl(mediaUrl?: string | null) {
    const trimmed = mediaUrl?.trim();
    if (!trimmed) return null;

    try {
        const parsed = new URL(trimmed, "https://crm.local");
        return parsed.pathname + parsed.search;
    } catch {
        return trimmed.replace(/^https?:\/\/[^/]+/i, "");
    }
}

function areLikelySameMessage(left: Message, right: Message) {
    if (left.id === right.id) return true;

    const leftCreatedAt = left.createdAt instanceof Date ? left.createdAt.getTime() : new Date(left.createdAt).getTime();
    const rightCreatedAt = right.createdAt instanceof Date ? right.createdAt.getTime() : new Date(right.createdAt).getTime();
    const leftMediaUrl = normalizeComparableMediaUrl(left.mediaUrl);
    const rightMediaUrl = normalizeComparableMediaUrl(right.mediaUrl);

    return (
        left.direction === right.direction &&
        (left.senderType || null) === (right.senderType || null) &&
        left.type === right.type &&
        left.sourceType === right.sourceType &&
        (left.sourceId || null) === (right.sourceId || null) &&
        (left.content || "") === (right.content || "") &&
        leftMediaUrl === rightMediaUrl &&
        (left.mediaFileName || null) === (right.mediaFileName || null) &&
        Math.abs(leftCreatedAt - rightCreatedAt) <= 15000
    );
}

export function replaceOptimisticMessage(
    prev: Message[],
    optimisticId: string,
    persistedMessage: Message,
) {
    let replaced = false;
    const next = prev.map((message) => {
        if (message.id === optimisticId) {
            replaced = true;
            return persistedMessage;
        }

        return message;
    });

    return collapseMessageDuplicates(replaced ? next : [...next, persistedMessage]);
}

export function mergeFetchedMessages(prev: Message[], incoming: Message[]) {
    if (incoming.length === 0) return prev;

    const next = [...prev];

    for (const incomingMessage of incoming) {
        const exactIndex = next.findIndex((message) => message.id === incomingMessage.id);
        if (exactIndex >= 0) {
            next[exactIndex] = incomingMessage;
            continue;
        }

        const optimisticIndex = next.findIndex((message) =>
            isTemporaryMessage(message) && areLikelySameMessage(message, incomingMessage),
        );
        if (optimisticIndex >= 0) {
            next[optimisticIndex] = incomingMessage;
            continue;
        }

        next.push(incomingMessage);
    }

    return collapseMessageDuplicates(next);
}

export function collapseMessageDuplicates(messages: Message[]) {
    const collapsed: Message[] = [];
    const positions = new Map<string, number>();
    const temporaryPositions = new Set<number>();

    const replaceAt = (index: number, message: Message) => {
        positions.delete(collapsed[index].id);
        collapsed[index] = message;
        positions.set(message.id, index);
        if (isTemporaryMessage(message)) temporaryPositions.add(index);
        else temporaryPositions.delete(index);
    };

    for (const message of messages) {
        const exactIndex = positions.get(message.id);
        if (exactIndex !== undefined) {
            replaceAt(exactIndex, message);
            continue;
        }

        // Persisted messages can only match pending sends. Searching all historical
        // messages here made every refresh quadratic as the history grew.
        const optimisticMatchIndex = isTemporaryMessage(message)
            ? collapsed.findIndex((existing) => areLikelySameMessage(existing, message))
            : [...temporaryPositions].sort((a, b) => a - b).find((index) =>
                areLikelySameMessage(collapsed[index], message),
            ) ?? -1;

        if (optimisticMatchIndex >= 0) {
            const existing = collapsed[optimisticMatchIndex];
            if (isTemporaryMessage(existing) && !isTemporaryMessage(message)) {
                replaceAt(optimisticMatchIndex, message);
            }
            continue;
        }

        positions.set(message.id, collapsed.length);
        if (isTemporaryMessage(message)) temporaryPositions.add(collapsed.length);
        collapsed.push(message);
    }

    collapsed.sort((left, right) => {
        const timeDelta = left.createdAt.getTime() - right.createdAt.getTime();
        if (timeDelta !== 0) return timeDelta;
        return left.id.localeCompare(right.id);
    });
    return collapsed;
}
