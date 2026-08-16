import crypto from "crypto";
import path from "path";
import { mkdir, writeFile } from "fs/promises";
import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { processInboundMessage } from "@/app/actions/chat";
import { prisma } from "@/lib/db";
import { fetchMetaMedia, getMetaWebhookVerifyToken, verifyMetaWebhookSignature } from "@/lib/meta-whatsapp";
import { MESSAGE_SOURCE_META } from "@/lib/message-source";

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue {
    return value && typeof value === "object" ? value as RecordValue : {};
}

function string(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function status(value: string) {
    if (value === "read") return "read";
    if (value === "delivered") return "delivered";
    if (value === "failed") return "failed";
    return "sent";
}

function extension(mimeType: string) {
    const extensions: Record<string, string> = {
        "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp",
        "video/mp4": ".mp4", "audio/ogg": ".ogg", "audio/mpeg": ".mp3",
        "application/pdf": ".pdf",
    };
    return extensions[mimeType.split(";")[0].toLowerCase()] || ".bin";
}

async function persistMedia(mediaId: string, fileName: string) {
    const downloaded = await fetchMetaMedia(mediaId);
    const uploads = path.join(process.cwd(), "public", "uploads", "meta");
    await mkdir(uploads, { recursive: true });
    const safeBase = path.parse(fileName || "archivo").name.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 50) || "archivo";
    const hash = crypto.createHash("sha256").update(mediaId).digest("hex").slice(0, 32);
    const safeName = `${safeBase}-${hash}${extension(downloaded.mimeType)}`;
    await writeFile(path.join(uploads, safeName), downloaded.buffer);
    return { mediaUrl: `/uploads/meta/${safeName}`, mediaType: downloaded.mimeType, mediaFileName: fileName || safeName };
}

async function applyStatus(messageId: string, nextStatus: string) {
    const target = await prisma.message.findFirst({
        where: { providerMessageId: messageId, sourceType: MESSAGE_SOURCE_META },
        select: { id: true, conversationId: true, status: true },
        orderBy: { createdAt: "desc" },
    });
    if (!target || target.status === nextStatus) return;
    await prisma.message.update({ where: { id: target.id }, data: { status: nextStatus } });
    await prisma.conversation.update({ where: { id: target.conversationId }, data: { updatedAt: new Date() } });
}

async function applyReaction(targetMessageId: string, emoji: string | null) {
    const target = await prisma.message.findFirst({
        where: { providerMessageId: targetMessageId, sourceType: MESSAGE_SOURCE_META },
        select: { id: true, conversationId: true },
        orderBy: { createdAt: "desc" },
    });
    if (!target) return;
    await prisma.message.update({ where: { id: target.id }, data: { reaction: emoji || null } });
    await prisma.conversation.update({ where: { id: target.conversationId }, data: { updatedAt: new Date() } });
}

async function handleMessagesValue(value: RecordValue) {
    const metadata = record(value.metadata);
    const sourceId = string(metadata.phone_number_id);
    const contacts = Array.isArray(value.contacts) ? value.contacts.map(record) : [];
    const contactNames = new Map(contacts.map((contact) => [
        string(contact.wa_id),
        string(record(contact.profile).name),
    ]));

    for (const rawStatus of Array.isArray(value.statuses) ? value.statuses : []) {
        const item = record(rawStatus);
        const messageId = string(item.id);
        if (messageId) await applyStatus(messageId, status(string(item.status)));
    }

    for (const rawMessage of Array.isArray(value.messages) ? value.messages : []) {
        const message = record(rawMessage);
        const from = string(message.from);
        const messageId = string(message.id);
        const type = string(message.type) || "text";
        if (!from || !messageId) continue;

        if (type === "reaction") {
            const reaction = record(message.reaction);
            const targetId = string(reaction.message_id);
            if (targetId) await applyReaction(targetId, string(reaction.emoji) || null);
            continue;
        }

        let content = string(record(message.text).body);
        let media: { type?: string; mediaUrl?: string; mediaType?: string; mediaFileName?: string } | undefined;

        if (type === "button") content = string(record(message.button).text) || "[Boton]";
        if (type === "interactive") {
            const interactive = record(message.interactive);
            content = string(record(interactive.button_reply).title) || string(record(interactive.list_reply).title) || "[Respuesta interactiva]";
        }

        if (["image", "video", "audio", "document", "sticker"].includes(type)) {
            const mediaObject = record(message[type]);
            const mediaId = string(mediaObject.id);
            const fileName = string(mediaObject.filename) || `${type}-${messageId}`;
            content = string(mediaObject.caption) || `[${type}]`;
            if (mediaId) {
                try {
                    const persisted = await persistMedia(mediaId, fileName);
                    media = { type: type === "sticker" ? "image" : type, ...persisted };
                } catch (error) {
                    console.error("[Meta Webhook] No se pudo guardar multimedia", error);
                }
            }
        }

        const timestamp = Number.parseInt(string(message.timestamp), 10);
        await processInboundMessage(
            from,
            content || `[${type}]`,
            contactNames.get(from),
            media,
            messageId,
            undefined,
            {
                sourceType: MESSAGE_SOURCE_META,
                sourceId: sourceId || null,
                occurredAt: Number.isFinite(timestamp) ? new Date(timestamp * 1000) : null,
            },
        );
    }
}

export async function GET(request: NextRequest) {
    const mode = request.nextUrl.searchParams.get("hub.mode");
    const token = request.nextUrl.searchParams.get("hub.verify_token") || "";
    const challenge = request.nextUrl.searchParams.get("hub.challenge") || "";
    const expected = await getMetaWebhookVerifyToken();
    if (mode === "subscribe" && expected && token === expected) {
        return new NextResponse(challenge, { status: 200 });
    }
    return NextResponse.json({ ok: false, error: "Verificacion rechazada." }, { status: 403 });
}

export async function POST(request: NextRequest) {
    const rawBody = await request.text();
    if (!(await verifyMetaWebhookSignature(rawBody, request.headers.get("x-hub-signature-256")))) {
        return NextResponse.json({ ok: false, error: "Firma invalida." }, { status: 401 });
    }

    try {
        const payload = JSON.parse(rawBody) as RecordValue;
        if (payload.object !== "whatsapp_business_account") return NextResponse.json({ ok: true, ignored: true });
        for (const rawEntry of Array.isArray(payload.entry) ? payload.entry : []) {
            const entry = record(rawEntry);
            for (const rawChange of Array.isArray(entry.changes) ? entry.changes : []) {
                const change = record(rawChange);
                if (change.field === "messages") await handleMessagesValue(record(change.value));
            }
        }
        revalidatePath("/dashboard/inbox");
        revalidatePath("/dashboard/contacts");
        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error("[Meta Webhook]", error);
        return NextResponse.json({ ok: false, error: "No se pudo procesar el webhook." }, { status: 500 });
    }
}
