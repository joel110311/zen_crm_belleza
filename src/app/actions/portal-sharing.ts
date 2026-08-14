"use server";

import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAnyPermission, getSessionUserId } from "@/lib/authz";
import { normalizePhoneDigits, parsePhoneByCountry } from "@/lib/operation-context";
import { getSystemSettingsOrDefaults } from "@/lib/system-settings";
import { normalizeMessageSourceType } from "@/lib/message-source";
import {
    findOrCreateActiveConversationForContact,
    sendOutboundConversationMessage,
} from "@/lib/outbound-messages";

export type PortalShareClient = {
    id: string;
    name: string;
    phone: string;
};

export type SharePortalInput = {
    portalUrl: string;
    contactId?: string;
    name?: string;
    phone?: string;
};

function makeInternalClientNumber() {
    return `CLI-${crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
}

function validatePortalUrl(value: string) {
    try {
        const url = new URL(value);
        return url.pathname.startsWith("/portal/") ? url.toString() : null;
    } catch {
        return null;
    }
}

export async function getPortalShareClients(query = ""): Promise<PortalShareClient[]> {
    await requireAnyPermission(["portal.manage", "settings.manage"]);

    const cleanQuery = query.trim();
    const clients = await prisma.contact.findMany({
        where: cleanQuery
            ? {
                  OR: [
                      { name: { contains: cleanQuery, mode: "insensitive" } },
                      { lastName: { contains: cleanQuery, mode: "insensitive" } },
                      { phone: { contains: normalizePhoneDigits(cleanQuery) || cleanQuery } },
                  ],
              }
            : undefined,
        orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
        take: 100,
        select: { id: true, name: true, lastName: true, phone: true },
    });

    return clients.map((client) => ({
        id: client.id,
        name: [client.name, client.lastName].filter(Boolean).join(" ").trim() || "Cliente",
        phone: client.phone,
    }));
}

export async function sharePortalByWhatsApp(input: SharePortalInput) {
    const session = await requireAnyPermission(["portal.manage", "settings.manage"]);
    const currentUserId = getSessionUserId(session);
    const portalUrl = validatePortalUrl(input.portalUrl);

    if (!portalUrl) {
        return { success: false, error: "El enlace del portal no es válido." };
    }

    let contact = input.contactId
        ? await prisma.contact.findUnique({
              where: { id: input.contactId },
              select: { id: true, name: true, lastName: true, phone: true },
          })
        : null;
    let createdClient = false;

    if (!contact) {
        const name = input.name?.trim() || "";
        const phone = normalizePhoneDigits(input.phone);
        const settings = await getSystemSettingsOrDefaults();
        const parsedPhone = parsePhoneByCountry(phone, settings.phoneDefaultCountry);

        if (!name || !phone) {
            return { success: false, error: "Captura el nombre y teléfono del cliente." };
        }
        if (parsedPhone.country.code === "MX" && parsedPhone.nationalNumber.length !== 10) {
            return { success: false, error: "El teléfono debe tener 10 dígitos, sin contar el prefijo +52." };
        }

        contact = await prisma.contact.findUnique({
            where: { phone },
            select: { id: true, name: true, lastName: true, phone: true },
        });

        if (!contact) {
            contact = await prisma.$transaction(async (tx) => {
                const created = await tx.contact.create({
                    data: {
                        name,
                        phone,
                        status: "customer",
                        tags: ["Cliente"],
                    },
                    select: { id: true, name: true, lastName: true, phone: true },
                });

                await tx.patient.create({
                    data: {
                        patientNumber: makeInternalClientNumber(),
                        firstName: name,
                        lastName: "",
                        phone,
                        contactId: created.id,
                    },
                });

                return created;
            });
            createdClient = true;
        }
    }

    if (!contact?.phone) {
        return { success: false, error: "El cliente seleccionado no tiene teléfono." };
    }

    const existingConversation = await prisma.conversation.findFirst({
        where: { contactId: contact.id, status: "active" },
        orderBy: { updatedAt: "desc" },
        select: { id: true, sourceType: true, sourceId: true },
    });
    const conversation = existingConversation || await findOrCreateActiveConversationForContact(contact.id);
    const clientName = [contact.name, contact.lastName].filter(Boolean).join(" ").trim() || "cliente";
    const message = `Hola ${clientName}, te compartimos nuestro portal para reservar tu próximo servicio:\n\n${portalUrl}`;

    try {
        await sendOutboundConversationMessage({
            conversationId: conversation.id,
            content: message,
            sourceType: normalizeMessageSourceType(existingConversation?.sourceType),
            sourceId: existingConversation?.sourceId || null,
            currentUserId,
            senderType: "human",
        });
    } catch (error) {
        console.error("[Portal Share] WhatsApp send failed", error);
        return {
            success: false,
            clientCreated: createdClient,
            error: error instanceof Error ? error.message : "No se pudo enviar el enlace por WhatsApp.",
        };
    }

    revalidatePath("/dashboard/contacts");
    revalidatePath("/dashboard/inbox");

    return {
        success: true,
        clientCreated: createdClient,
        clientName,
    };
}
