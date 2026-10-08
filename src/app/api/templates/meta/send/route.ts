import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { sendChannelTemplate, resolveChannelSourceId } from "@/lib/channel-delivery";
import { MESSAGE_SOURCE_META } from "@/lib/message-source";
import { buildPhoneMatchClauses, normalizePhoneDigits, normalizeMetaRecipient } from "@/lib/phone";
import { findOrCreateActiveConversationForContactSource } from "@/lib/source-conversations";
import { resolveAssignableTenantUserId } from "@/lib/user-assignment";
import { ensurePermissionResponse } from "@/lib/authz";
import { requireProviderMessageId } from "@/lib/whatsapp-audio";

async function conversationForPhone(phone: string, assignedUserId?: string | null, requestedSourceId?: string | null) {
    const normalized = normalizePhoneDigits(phone);
    const clauses = buildPhoneMatchClauses([normalized]);
    if (!normalized || clauses.length === 0) throw new Error("Telefono invalido.");
    const sourceId = await resolveChannelSourceId("meta", requestedSourceId);
    let contact = await prisma.contact.findFirst({ where: { sourceType: "meta", OR: clauses } });
    if (!contact) contact = await prisma.contact.upsert({ where: { phone_sourceType: { phone: normalized, sourceType: "meta" } }, update: {}, create: { phone: normalized, sourceType: "meta", status: "lead" } });
    const conversation = await findOrCreateActiveConversationForContactSource({
        contactId: contact.id,
        sourceType: MESSAGE_SOURCE_META,
        sourceId,
        defaults: { assignedUserId, botActive: false },
    });
    return { contact, conversation, sourceId };
}

export async function POST(request: NextRequest) {
    const session = await auth();
    const forbidden = ensurePermissionResponse(session, "chats.manage", "No tienes permiso para enviar mensajes.");
    if (forbidden) return forbidden;
    const userId = (session as { user?: { id?: string } } | null)?.user?.id;
    if (!userId) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const assignedTenantUserId = await resolveAssignableTenantUserId(userId);
    try {
        const body = await request.json();
        const templateName = typeof body.templateName === "string" ? body.templateName.trim() : "";
        const languageCode = typeof body.languageCode === "string" ? body.languageCode.trim() : typeof body.language === "string" ? body.language.trim() : "es";
        const resolvedContent = typeof body.resolvedContent === "string" ? body.resolvedContent.trim() : "";
        const components = Array.isArray(body.components) ? body.components : undefined;
        const recipients = Array.isArray(body.recipients) ? body.recipients.filter((value: unknown): value is string => typeof value === "string" && Boolean(value.trim())) : [];
        const conversationId = typeof body.conversationId === "string" ? body.conversationId.trim() : "";
        if (!templateName || (!conversationId && recipients.length === 0)) return NextResponse.json({ error: "Falta plantilla o destinatario." }, { status: 400 });

        const phones = [...recipients];
        let requestedSourceId: string | null = null;
        if (conversationId) {
            const existing = await prisma.conversation.findUnique({ where: { id: conversationId }, include: { contact: true } });
            if (!existing?.contact.phone) return NextResponse.json({ error: "Conversacion sin telefono." }, { status: 400 });
            phones.push(existing.contact.phone);
            requestedSourceId = existing.sourceType === "meta" ? existing.sourceId : null;
        }

        let sent = 0;
        let lastSent: { message: unknown; conversationId: string } | null = null;
        const errors: Array<{ to: string; error: string }> = [];
        const uniquePhones = [...new Set(phones.map(normalizeMetaRecipient).filter(Boolean))];
        for (const phone of uniquePhones) {
            try {
                const target = await conversationForPhone(phone, assignedTenantUserId, requestedSourceId);
                const result = await sendChannelTemplate({ sourceId: target.sourceId, to: target.contact.phone, templateName, languageCode, components });
                const message = await prisma.message.create({
                    data: {
                        conversationId: target.conversation.id,
                        content: resolvedContent || `[Plantilla: ${templateName}]`,
                        direction: "outbound",
                        status: "sent",
                        type: "template",
                        senderType: "human",
                        sourceType: MESSAGE_SOURCE_META,
                        sourceId: target.sourceId,
                        providerMessageId: requireProviderMessageId(result),
                    },
                });
                await prisma.conversation.update({
                    where: { id: target.conversation.id },
                    data: {
                        updatedAt: new Date(),
                        botActive: false,
                        assignedUserId: assignedTenantUserId ?? target.conversation.assignedUserId,
                    },
                });
                sent += 1;
                lastSent = { message, conversationId: target.conversation.id };
            } catch (error) {
                errors.push({ to: phone, error: error instanceof Error ? error.message : "Error desconocido" });
            }
        }
        revalidatePath("/dashboard/inbox");
        return NextResponse.json({
            success: sent > 0, sent, failed: errors.length, total: uniquePhones.length, errors,
            ...(uniquePhones.length === 1 && lastSent ? lastSent : {}),
            ...(sent === 0 ? { error: errors[0]?.error || "No hay destinatarios válidos para enviar la plantilla." } : {}),
        }, { status: sent > 0 ? 200 : uniquePhones.length ? 502 : 400 });
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo enviar la plantilla." }, { status: 500 });
    }
}
