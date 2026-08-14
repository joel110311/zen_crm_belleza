"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { maybePlayNotification } from "@/lib/notificationSounds";
import { incrementUnreadCounts } from "@/lib/inbox-browser-badge";

const NOTIFIER_CONVERSATION_LIMIT = 300;
const NOTIFIER_DELTA_POLL_INTERVAL_MS = 4000;
const NOTIFIER_FULL_RESYNC_INTERVAL_MS = 60000;

type ConversationSnapshot = {
    id: string;
    lastMessageTime?: string | Date;
    updatedAt?: string | Date;
    lastMessageDirection?: string;
    isMuted?: boolean;
};

function toIsoTimestamp(value: string | Date | undefined) {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }
    return parsed.toISOString();
}

export function InboxNotifier() {
    const pathname = usePathname();
    const isFirstFetchRef = useRef(true);
    const previousTimestampsRef = useRef<Record<string, string>>({});
    const cursorRef = useRef<string | null>(null);
    const pollInFlightRef = useRef(false);

    useEffect(() => {
        if (pathname === "/dashboard/inbox") {
            return;
        }

        let disposed = false;

        const updateCursor = (conversations: ConversationSnapshot[]) => {
            for (const conversation of conversations) {
                const timestamp =
                    toIsoTimestamp(conversation.lastMessageTime) ||
                    toIsoTimestamp(conversation.updatedAt);
                if (!timestamp) continue;
                if (!cursorRef.current || timestamp > cursorRef.current) {
                    cursorRef.current = timestamp;
                }
            }
        };

        const poll = async (mode: "full" | "delta") => {
            if (disposed) return;
            if (mode === "delta" && !cursorRef.current) return;
            if (pollInFlightRef.current) return;

            pollInFlightRef.current = true;
            try {
                const url = new URL("/api/chat", window.location.origin);
                url.searchParams.set("limit", String(NOTIFIER_CONVERSATION_LIMIT));
                if (mode === "delta" && cursorRef.current) {
                    url.searchParams.set("updatedSince", cursorRef.current);
                }

                const response = await fetch(url.toString(), { cache: "no-store" });
                const conversations = (await response.json()) as ConversationSnapshot[];
                if (!Array.isArray(conversations) || disposed) {
                    return;
                }

                updateCursor(conversations);

                const nextTimestamps =
                    mode === "full"
                        ? {} as Record<string, string>
                        : { ...previousTimestampsRef.current };
                let playedSound = false;
                const changedInboundConversationIds: string[] = [];

                for (const conversation of conversations) {
                    const timestamp =
                        toIsoTimestamp(conversation.lastMessageTime) ||
                        toIsoTimestamp(conversation.updatedAt) ||
                        new Date().toISOString();
                    nextTimestamps[conversation.id] = timestamp;

                    if (isFirstFetchRef.current) {
                        continue;
                    }

                    if (
                        previousTimestampsRef.current[conversation.id] &&
                        previousTimestampsRef.current[conversation.id] !== timestamp &&
                        conversation.lastMessageDirection === "inbound"
                    ) {
                        changedInboundConversationIds.push(conversation.id);

                        if (!playedSound) {
                            maybePlayNotification(Boolean(conversation.isMuted));
                            playedSound = true;
                        }
                    }
                }

                if (changedInboundConversationIds.length > 0) {
                    incrementUnreadCounts(changedInboundConversationIds);
                }

                previousTimestampsRef.current = nextTimestamps;
                isFirstFetchRef.current = false;
            } catch (error) {
                console.error("Failed to poll inbox notifications:", error);
            } finally {
                pollInFlightRef.current = false;
            }
        };

        void poll("full");
        const deltaInterval = setInterval(() => {
            void poll("delta");
        }, NOTIFIER_DELTA_POLL_INTERVAL_MS);
        const fullResyncInterval = setInterval(() => {
            void poll("full");
        }, NOTIFIER_FULL_RESYNC_INTERVAL_MS);

        return () => {
            disposed = true;
            clearInterval(deltaInterval);
            clearInterval(fullResyncInterval);
        };
    }, [pathname]);

    return null;
}
