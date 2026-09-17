import test from "node:test";
import assert from "node:assert/strict";
import {
    extractNational10,
    normalizeWuzapiRecipient,
    normalizeMetaRecipient,
    buildPhoneMatchClauses,
} from "../src/lib/phone.ts";
import { formatPhoneForDisplay } from "../src/lib/operation-context.ts";
import {
    mergeDuplicateContactRecords,
    consolidateConversationsList,
    type PrismaLikeClient,
    type DeduplicationContact,
} from "../src/lib/contact-deduplication.ts";

test("normalizeWuzapiRecipient: asegura prefijo 521 para numeros mexicanos en WuzAPI", () => {
    assert.equal(normalizeWuzapiRecipient("4772683928"), "5214772683928");
    assert.equal(normalizeWuzapiRecipient("524772683928"), "5214772683928");
    assert.equal(normalizeWuzapiRecipient("5214772683928"), "5214772683928");
    assert.equal(normalizeWuzapiRecipient("+52 477 268 3928"), "5214772683928");
    assert.equal(normalizeWuzapiRecipient("+52 1 477 268 3928"), "5214772683928");
    assert.equal(normalizeWuzapiRecipient("me:12345"), "me:12345");
    assert.equal(normalizeWuzapiRecipient("14155552671"), "14155552671");
});

test("normalizeMetaRecipient: asegura formato E.164 sin '1' para WhatsApp Cloud API", () => {
    assert.equal(normalizeMetaRecipient("4772683928"), "524772683928");
    assert.equal(normalizeMetaRecipient("524772683928"), "524772683928");
    assert.equal(normalizeMetaRecipient("5214772683928"), "524772683928");
    assert.equal(normalizeMetaRecipient("+52 1 477 268 3928"), "524772683928");
    assert.equal(normalizeMetaRecipient("+52 477 268 3928"), "524772683928");
    assert.equal(normalizeMetaRecipient("14155552671"), "14155552671");
});

test("extractNational10: extrae los 10 digitos nacionales limpios", () => {
    assert.equal(extractNational10("5214772683928"), "4772683928");
    assert.equal(extractNational10("524772683928"), "4772683928");
    assert.equal(extractNational10("+52 477 268 3928"), "4772683928");
    assert.equal(extractNational10("+52 147 726 83928"), "4772683928");
    assert.equal(extractNational10("4772683928"), "4772683928");
});

test("formatPhoneForDisplay: formatea numeros mexicanos sin mostrar '147'", () => {
    assert.equal(formatPhoneForDisplay("5214772683928"), "+52 477 268 3928");
    assert.equal(formatPhoneForDisplay("524772683928"), "+52 477 268 3928");
    assert.equal(formatPhoneForDisplay("+52 477 268 3928"), "+52 477 268 3928");
    assert.equal(formatPhoneForDisplay("+5214772683928"), "+52 477 268 3928");
});

test("buildPhoneMatchClauses: genera variaciones para coincidir con formatos existentes", () => {
    const clauses = buildPhoneMatchClauses(["5214772683928"]);
    const plainPhones = clauses
        .filter((c): c is { phone: string } => typeof c.phone === "string")
        .map((c) => c.phone);

    assert.ok(plainPhones.includes("5214772683928"));
    assert.ok(plainPhones.includes("524772683928"));
    assert.ok(plainPhones.includes("4772683928"));
    assert.ok(plainPhones.includes("+52 477 268 3928"));
});

test("mergeDuplicateContactRecords: transfiere mensajes y elimina el contacto duplicado", async () => {
    const updatedMessages: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
    const deletedConversations: string[] = [];
    const deletedContacts: string[] = [];

    const mockDb: PrismaLikeClient = {
        message: {
            updateMany: async (args: Record<string, unknown>) => {
                updatedMessages.push(args as { where: Record<string, unknown>; data: Record<string, unknown> });
                return { count: 1 };
            },
        },
        conversation: {
            delete: async (args: Record<string, unknown>) => {
                const where = args.where as { id: string } | undefined;
                if (where?.id) deletedConversations.push(where.id);
                return {};
            },
            update: async () => ({}),
        },
        contact: {
            findMany: async () => [],
            update: async () => ({}),
            delete: async (args: Record<string, unknown>) => {
                const where = args.where as { id: string } | undefined;
                if (where?.id) deletedContacts.push(where.id);
                return {};
            },
        },
    };

    const primaryContact: DeduplicationContact = {
        id: "primary-1",
        name: "Joel Venegas Vargas",
        phone: "+52 477 268 3928",
        conversations: [
            { id: "conv-primary", sourceType: "wuzapi", sourceId: null },
        ],
    };

    const duplicateContact: DeduplicationContact = {
        id: "dup-1",
        name: "+52 147 726 83928",
        phone: "5214772683928",
        conversations: [
            { id: "conv-dup", sourceType: "wuzapi", sourceId: null },
        ],
    };

    await mergeDuplicateContactRecords(primaryContact, [duplicateContact], mockDb);

    // Mensajes transferidos de conv-dup a conv-primary
    assert.equal(updatedMessages.length, 1);
    assert.equal((updatedMessages[0].where as { conversationId: string }).conversationId, "conv-dup");
    assert.equal((updatedMessages[0].data as { conversationId: string }).conversationId, "conv-primary");

    // Conversacion duplicada eliminada
    assert.ok(deletedConversations.includes("conv-dup"));

    // Contacto duplicado eliminado
    assert.ok(deletedContacts.includes("dup-1"));
});

test("consolidateConversationsList: consolida conversaciones duplicadas detectadas en la lista", async () => {
    const mockDb: PrismaLikeClient = {
        contact: {
            findMany: async () => [],
            update: async () => ({}),
            delete: async () => ({}),
        },
        conversation: {
            delete: async () => ({}),
            update: async () => ({}),
        },
        message: {
            updateMany: async () => ({ count: 0 }),
        },
    };

    const conversations = [
        {
            id: "conv-1",
            contact: { id: "contact-1", phone: "+52 477 268 3928" },
        },
        {
            id: "conv-2",
            contact: { id: "contact-2", phone: "5214772683928" },
        },
    ];

    const didMerge = await consolidateConversationsList(conversations, mockDb);
    // Dado que contact-1 y contact-2 comparten nat10 "4772683928", se detecta duplicado
    assert.equal(didMerge, true);
});
