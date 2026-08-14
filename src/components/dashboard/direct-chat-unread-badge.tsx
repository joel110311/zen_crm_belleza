"use client";

import { useEffect, useState } from "react";
import {
    INBOX_UNREAD_EVENT,
    readUnreadCounts,
    type InboxUnreadCounts,
} from "@/lib/inbox-browser-badge";

function getUnreadCount(conversationId: string, counts: InboxUnreadCounts) {
    return Math.max(0, Number(counts[conversationId] || 0));
}

export function DirectChatUnreadBadge({ conversationId }: { conversationId: string }) {
    const [count, setCount] = useState(0);

    useEffect(() => {
        const sync = () => {
            setCount(getUnreadCount(conversationId, readUnreadCounts()));
        };

        const handleUnreadEvent = (event: Event) => {
            const detail = (event as CustomEvent<{ counts?: InboxUnreadCounts }>).detail;
            setCount(getUnreadCount(conversationId, detail?.counts || readUnreadCounts()));
        };

        sync();
        window.addEventListener("storage", sync);
        window.addEventListener(INBOX_UNREAD_EVENT, handleUnreadEvent);
        document.addEventListener("visibilitychange", sync);

        return () => {
            window.removeEventListener("storage", sync);
            window.removeEventListener(INBOX_UNREAD_EVENT, handleUnreadEvent);
            document.removeEventListener("visibilitychange", sync);
        };
    }, [conversationId]);

    if (count <= 0) {
        return null;
    }

    return (
        <span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-primary px-2 text-xs font-bold text-primary-foreground">
            {count > 99 ? "99+" : count}
        </span>
    );
}
