import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { sendMetaTemplateMessage } from "@/lib/meta-whatsapp";
import { MESSAGE_SOURCE_META, resolveMessageSourceId } from "@/lib/message-source";
import { buildPhoneMatchClauses, normalizePhoneDigits } from "@/lib/phone";
import { findOrCreateActiveConversationForContactSource } from "@/lib/source-conversations";
import { getSystemSettingsOrDefaults } from "@/lib/system-settings";

async function conversationForPhone(phone: string, assignedUserId?: string | null) {
    const normalized = normalizePhoneDigits(phone);
    const clauses = buildPhoneMatchClauses([normalized]);
    if (!normalized || clauses.length === 0) throw new Error("Telefono invalido.");
    let contact = await prisma.contact.findFirst({ where: { OR: clauses } });
    if (!contact) contact = await prisma.contact.create({ data: { phone: normalized, status: "lead" } });
    const settings = await getSystemSettingsOrDefaults();
    const conversation = await findOrCreateActiveConversationForContactSource({
        contactId: contact.id,
        sourceType: MESSAGE_SOURCE_META,
        sourceId: resolveMessageSourceId(MESSAGE_SOURCE_META, settings),
        defaults: { assignedUserId, botActive: false, sessionExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
    });
    return { contact, conversation, sourceId: resolveMessageSourceId(MESSAGE_SOURCE_META, settings) };
}

export async function POST(request: NextRequest) {
    const session = await auth();
    const userId = (session as { user?: { id?: string } } | null)?.user?.id;
    if (!userId) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
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
        if (conversationId) {
            const existing = await prisma.conversation.findUnique({ where: { id: conversationId }, include: { contact: true } });
            if (!existing?.contact.phone) return NextResponse.json({ error: "Conversacion sin telefono." }, { status: 400 });
            phones.push(existing.contact.phone);
        }

        let sent = 0;
        const errors: Array<{ to: string; error: string }> = [];
        for (const phone of phones) {
            try {
                const target = await conversationForPhone(phone, userId);
                const result = await sendMetaTemplateMessage({ to: target.contact.phone, templateName, languageCode, components });
                await prisma.message.create({
                    data: {
                        conversationId: target.conversation.id,
                        content: resolvedContent || `[Plantilla: ${templateName}]`,
                        direction: "outbound",
                        status: "sent",
                        type: "template",
                        senderType: "human",
                        sourceType: MESSAGE_SOURCE_META,
                        sourceId: target.sourceId,
                        providerMessageId: result.Id,
                    },
                });
                await prisma.conversation.update({ where: { id: target.conversation.id }, data: { updatedAt: new Date(), sessionExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), botActive: false, assignedUserId: userId } });
                sent += 1;
            } catch (error) {
                errors.push({ to: phone, error: error instanceof Error ? error.message : "Error desconocido" });
            }
        }
        revalidatePath("/dashboard/inbox");
        return NextResponse.json({ success: sent > 0, sent, failed: errors.length, total: phones.length, errors });
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo enviar la plantilla." }, { status: 500 });
    }
}
