export type BotReplyMessageEvidence = {
    id: string;
    direction: string;
    type: string;
    senderType: string | null;
    status: string;
};

export function isSentCustomerBotText(
    message: BotReplyMessageEvidence | null | undefined,
) {
    return Boolean(
        message &&
        message.direction === "outbound" &&
        message.type === "text" &&
        message.senderType === "bot" &&
        ["sent", "delivered", "read"].includes(message.status),
    );
}

export function hasNewSentCustomerBotText(
    before: BotReplyMessageEvidence | null | undefined,
    after: BotReplyMessageEvidence | null | undefined,
) {
    return isSentCustomerBotText(after) && after?.id !== before?.id;
}

export type BotBatchCompletionDecision = "sent" | "disabled" | "superseded" | "retry";

export function resolveBotBatchCompletion(params: {
    sentCustomerReply: boolean;
    botActive: boolean;
    hasNewerPendingInbound: boolean;
}): BotBatchCompletionDecision {
    if (params.sentCustomerReply) return "sent";
    if (!params.botActive) return "disabled";
    if (params.hasNewerPendingInbound) return "superseded";
    return "retry";
}
