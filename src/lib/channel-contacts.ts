import { prisma } from "@/lib/db";
import { buildPhoneMatchClauses } from "@/lib/phone";
import type { MessageSourceType } from "@/lib/message-source";

/** A phone may have independent customer records on QR and Cloud API. */
export async function ensureContactForChannel(contactId: string, sourceType: MessageSourceType) {
    const contact = await prisma.contact.findUnique({ where: { id: contactId } });
    if (!contact) throw new Error("El contacto ya no existe.");
    if (contact.sourceType === sourceType) return contact;
    const existing = await prisma.contact.findFirst({ where: { sourceType, OR: buildPhoneMatchClauses([contact.phone]) } });
    if (existing) return existing;
    return prisma.contact.upsert({
        where: { phone_sourceType: { phone: contact.phone, sourceType } },
        update: {},
        create: {
            phone: contact.phone, sourceType, name: contact.name, lastName: contact.lastName,
            email: contact.email, company: contact.company, role: contact.role, tags: contact.tags,
            status: contact.status, bulkCampaignOptOutAt: contact.bulkCampaignOptOutAt,
            bulkCampaignOptOutReason: contact.bulkCampaignOptOutReason,
        },
    });
}
