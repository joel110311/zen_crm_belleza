"use server";

import crypto from "crypto";
import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import {
    refreshWhatsAppAvatarForContact,
    refreshWhatsAppAvatarForContactsInBackground,
} from "@/lib/whatsapp-avatar";
import { resolveMessageSourceId } from "@/lib/message-source";
import { getSystemSettingsOrDefaults } from "@/lib/system-settings";
import { requireAnyPermission } from "@/lib/authz";

const CONTACT_LIST_INCLUDE = {
    conversations: {
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: {
            botActive: true,
            assignedUser: {
                select: {
                    name: true,
                },
            },
            updatedAt: true,
        },
    },
    deals: {
        orderBy: { updatedAt: "desc" },
        take: 1,
        include: {
            stage: {
                select: {
                    name: true,
                    color: true,
                    isClosedWon: true,
                    isClosedLost: true,
                },
            },
            intelligence: {
                select: {
                    score: true,
                    interestStatus: true,
                    currentStep: true,
                },
            },
        },
    },
    appointments: {
        orderBy: { startTime: "desc" },
        select: {
            id: true,
            title: true,
            appointmentType: true,
            serviceId: true,
            patientId: true,
            specialistId: true,
            notes: true,
            source: true,
            isOverbook: true,
            visitMode: true,
            meetStatus: true,
            meetLink: true,
            paymentStatus: true,
            paymentAmount: true,
            paymentCurrency: true,
            remindersOptOut: true,
            googleCalendarId: true,
            startTime: true,
            endTime: true,
            status: true,
            confirmationStatus: true,
        },
    },
    patients: {
        select: {
            id: true,
            appointments: {
                orderBy: { startTime: "desc" },
                select: {
                    id: true,
                    title: true,
                    appointmentType: true,
                    serviceId: true,
                    patientId: true,
                    specialistId: true,
                    notes: true,
                    source: true,
                    isOverbook: true,
                    visitMode: true,
                    meetStatus: true,
                    meetLink: true,
                    paymentStatus: true,
                    paymentAmount: true,
                    paymentCurrency: true,
                    remindersOptOut: true,
                    googleCalendarId: true,
                    startTime: true,
                    endTime: true,
                    status: true,
                    confirmationStatus: true,
                },
            },
        },
    },
} satisfies Prisma.ContactInclude;

export type ContactListItem = Prisma.ContactGetPayload<{
    include: typeof CONTACT_LIST_INCLUDE;
}>;

function buildContactSearchWhere(query?: string): Prisma.ContactWhereInput {
    if (!query) {
        return {};
    }

    return {
        OR: [
            { name: { contains: query, mode: "insensitive" } },
            { lastName: { contains: query, mode: "insensitive" } },
            { email: { contains: query, mode: "insensitive" } },
            { phone: { contains: query, mode: "insensitive" } },
            { company: { contains: query, mode: "insensitive" } },
        ],
    };
}

function normalizeContactIds(contactIds: string[]) {
    return [...new Set(contactIds.map((value) => value.trim()).filter(Boolean))];
}

function makeInternalClientNumber() {
    return `CLI-${crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
}

async function requireClientAccess() {
    return requireAnyPermission(["contacts.manage", "patients.manage"]);
}

async function synchronizeClientRecords() {
    const orphanPatients = await prisma.patient.findMany({
        where: {
            contactId: null,
            phone: { not: null },
        },
        select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
        },
    });

    for (const patient of orphanPatients) {
        if (!patient.phone) continue;
        const contact = await prisma.contact.upsert({
            where: { phone: patient.phone },
            create: {
                phone: patient.phone,
                name: patient.firstName,
                lastName: patient.lastName || null,
                status: "customer",
                tags: ["Cliente"],
            },
            update: { status: "customer" },
            select: { id: true },
        });
        await prisma.patient.update({
            where: { id: patient.id },
            data: { contactId: contact.id },
        });
    }

    const contactsWithoutPatient = await prisma.contact.findMany({
        where: { patients: { none: {} } },
        select: {
            id: true,
            name: true,
            lastName: true,
            phone: true,
        },
    });

    for (const contact of contactsWithoutPatient) {
        const matchingPatient = await prisma.patient.findFirst({
            where: { phone: contact.phone },
            select: { id: true },
        });
        if (matchingPatient) {
            await prisma.patient.update({
                where: { id: matchingPatient.id },
                data: { contactId: contact.id },
            });
            continue;
        }

        await prisma.patient.create({
            data: {
                patientNumber: makeInternalClientNumber(),
                firstName: contact.name?.trim() || "Cliente",
                lastName: contact.lastName?.trim() || "",
                phone: contact.phone,
                contactId: contact.id,
            },
        });
    }
}

function revalidateContactSurfaces(contactIds: string[] = []) {
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/contacts");
    revalidatePath("/dashboard/inbox");
    revalidatePath("/dashboard/pipeline");

    for (const contactId of contactIds) {
        revalidatePath(`/dashboard/contacts/${contactId}`);
    }
}

function isPhoneUniqueConstraintError(error: unknown) {
    if (!error || typeof error !== "object") {
        return false;
    }

    const maybePrismaError = error as {
        code?: string;
        meta?: {
            target?: unknown;
        };
    };

    const targets = Array.isArray(maybePrismaError.meta?.target)
        ? maybePrismaError.meta.target.map(String)
        : [];

    return maybePrismaError.code === "P2002" && targets.includes("phone");
}

async function deleteContactsGraph(contactIds: string[]) {
    const ids = normalizeContactIds(contactIds);
    if (ids.length === 0) {
        return 0;
    }

    const conversations = await prisma.conversation.findMany({
        where: {
            contactId: {
                in: ids,
            },
        },
        select: {
            id: true,
        },
    });

    const conversationIds = conversations.map((conversation) => conversation.id);
    const patients = await prisma.patient.findMany({
        where: { contactId: { in: ids } },
        select: { id: true },
    });
    const patientIds = patients.map((patient) => patient.id);
    let deletedCount = 0;

    await prisma.$transaction(async (tx) => {
        if (conversationIds.length > 0) {
            await tx.message.deleteMany({
                where: {
                    conversationId: {
                        in: conversationIds,
                    },
                },
            });

            await tx.catalogConversationState.deleteMany({
                where: {
                    conversationId: {
                        in: conversationIds,
                    },
                },
            });

            await tx.bulkCampaignRecipient.updateMany({
                where: {
                    conversationId: {
                        in: conversationIds,
                    },
                },
                data: {
                    conversationId: null,
                },
            });

            await tx.conversation.deleteMany({
                where: {
                    id: {
                        in: conversationIds,
                    },
                },
            });
        }

        await tx.appointment.deleteMany({
            where: {
                OR: [
                    { contactId: { in: ids } },
                    ...(patientIds.length > 0 ? [{ patientId: { in: patientIds } }] : []),
                ],
            },
        });

        await tx.deal.deleteMany({
            where: {
                contactId: {
                    in: ids,
                },
            },
        });

        if (patientIds.length > 0) {
            await tx.patient.deleteMany({
                where: { id: { in: patientIds } },
            });
        }

        const deletedContacts = await tx.contact.deleteMany({
            where: {
                id: {
                    in: ids,
                },
            },
        });

        deletedCount = deletedContacts.count;
    });

    return deletedCount;
}

export async function getContacts(query?: string) {
    await requireClientAccess();

    try {
        await synchronizeClientRecords();
        const contacts = await prisma.contact.findMany({
            where: buildContactSearchWhere(query),
            orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
            include: CONTACT_LIST_INCLUDE,
        });

        refreshWhatsAppAvatarForContactsInBackground(
            contacts.map((contact) => contact.id).slice(0, 20),
            { limit: 6, concurrency: 2 },
        );

        return contacts;
    } catch (error) {
        console.error("Failed to fetch contacts:", error);
        return [];
    }
}

export async function getContact(id: string) {
    await requireClientAccess();

    try {
        await refreshWhatsAppAvatarForContact(id).catch((error) => {
            console.warn("[Contacts] Could not refresh WhatsApp avatar for contact details", error);
        });

        const contact = await prisma.contact.findUnique({
            where: { id },
            include: {
                deals: {
                    include: {
                        dealTags: {
                            include: {
                                tag: true,
                            },
                        },
                    },
                },
                appointments: true,
            },
        });

        return contact;
    } catch (error) {
        console.error("Failed to fetch contact:", error);
        return null;
    }
}

export async function createContact(formData: FormData) {
    await requireClientAccess();

    const name = String(formData.get("name") || "").trim();
    const phone = String(formData.get("phone") || "").trim();

    if (!name || !phone) {
        return { success: false, error: "El nombre y el teléfono son obligatorios." };
    }

    try {
        const settings = await getSystemSettingsOrDefaults();
        const wuzapiSourceId = resolveMessageSourceId("wuzapi", settings);
        const contact = await prisma.$transaction(async (tx) => {
            const createdContact = await tx.contact.create({
                data: {
                    name,
                    phone,
                    status: "customer",
                    tags: ["Cliente"],
                },
            });

            await tx.patient.create({
                data: {
                    patientNumber: makeInternalClientNumber(),
                    firstName: name,
                    lastName: "",
                    phone,
                    contactId: createdContact.id,
                },
            });

            await tx.conversation.create({
                data: {
                    contactId: createdContact.id,
                    status: "active",
                    sourceType: "wuzapi",
                    sourceId: wuzapiSourceId,
                    botActive: true,
                },
            });

            return createdContact;
        });

        revalidateContactSurfaces([contact.id]);
        return { success: true, contact };
    } catch (error) {
        console.error("Failed to create contact:", error);
        if (isPhoneUniqueConstraintError(error)) {
            return { success: false, error: "Ya existe un cliente con este número de teléfono." };
        }
        return { success: false, error: "No se pudo crear el cliente." };
    }
}

export async function updateContact(
    id: string,
    data: Partial<{
        name: string;
        lastName: string;
        email: string;
        phone: string;
        company: string;
        role: string;
        status: string;
        tags: string[];
    }>,
) {
    await requireClientAccess();

    try {
        const contact = await prisma.contact.update({
            where: { id },
            data,
        });

        revalidatePath("/dashboard/contacts");
        revalidatePath(`/dashboard/contacts/${id}`);
        return { success: true, contact };
    } catch (error) {
        console.error("Failed to update contact:", error);
        if (isPhoneUniqueConstraintError(error)) {
            return { success: false, error: "Ya existe un cliente con este número de teléfono." };
        }
        return {
            success: false,
            error: `Error al actualizar: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

export async function deleteContact(id: string) {
    await requireClientAccess();

    try {
        const deletedCount = await deleteContactsGraph([id]);
        revalidateContactSurfaces([id]);

        if (deletedCount === 0) {
            return { success: false, error: "No se encontró el cliente." };
        }

        return { success: true };
    } catch (error) {
        console.error("Failed to delete contact:", error);
        return { success: false, error: "Error al eliminar el cliente." };
    }
}

export async function deleteContactsBulk(contactIds: string[]) {
    await requireClientAccess();

    try {
        const ids = normalizeContactIds(contactIds);
        if (ids.length === 0) {
            return { success: false, error: "Selecciona al menos un cliente." };
        }

        const deletedCount = await deleteContactsGraph(ids);
        revalidateContactSurfaces(ids);

        return {
            success: true,
            deletedCount,
        };
    } catch (error) {
        console.error("Failed to bulk delete contacts:", error);
        return {
            success: false,
            error: "Error al eliminar los clientes seleccionados.",
        };
    }
}

export async function addContactTag(contactId: string, tag: string) {
    await requireClientAccess();

    try {
        const contact = await prisma.contact.findUnique({ where: { id: contactId } });
        if (!contact) {
            return { success: false, error: "Contact not found" };
        }

        const newTags = Array.from(new Set([...contact.tags, tag]));

        await prisma.contact.update({
            where: { id: contactId },
            data: { tags: newTags },
        });

        revalidatePath(`/dashboard/contacts/${contactId}`);
        return { success: true };
    } catch (error) {
        console.error("Failed to add tag:", error);
        return { success: false, error: "Failed to add tag" };
    }
}

export async function removeContactTag(contactId: string, tag: string) {
    await requireClientAccess();

    try {
        const contact = await prisma.contact.findUnique({ where: { id: contactId } });
        if (!contact) {
            return { success: false, error: "Contact not found" };
        }

        const newTags = contact.tags.filter((entry: string) => entry !== tag);

        await prisma.contact.update({
            where: { id: contactId },
            data: { tags: newTags },
        });

        revalidatePath(`/dashboard/contacts/${contactId}`);
        return { success: true };
    } catch (error) {
        console.error("Failed to remove tag:", error);
        return { success: false, error: "Failed to remove tag" };
    }
}
