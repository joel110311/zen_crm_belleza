export const INBOX_DRAFT_STORAGE_KEY = "zen-crm-inbox-draft";

export type InboxDraftPayload = {
    conversationId: string;
    content: string;
    mediaUrl: string;
    fileName: string;
    mimeType: string;
    mediaCategory: "image" | "video" | "audio" | "document";
    previewUrl?: string;
    createdAt: string;
    source: "patient-prescription" | "patient-study-request" | "quote" | "manual";
};
