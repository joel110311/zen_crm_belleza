import assert from "node:assert/strict";
import test from "node:test";
import { loadTsModule } from "./helpers/load-ts-module.mts";

function service(existing = true, denied = false) {
    let creates = 0, conversations = 0;
    const saved = { id: "contact-a", name: "Nombre conservado", phone: "525512345678" };
    const db = {
        contact: {
            findFirst: async ({ where }: { where: { sourceType: string; phone: { in: string[] } } }) => {
                assert.equal(where.sourceType, "wuzapi");
                return existing && where.phone.in.includes(saved.phone) ? saved : null;
            },
            create: async () => { creates++; return saved; },
        },
        patient: { create: async () => ({}) },
        conversation: { create: async () => { conversations++; return { id: "conversation-a" }; } },
        $transaction: async (operation: (tx: unknown) => unknown) => operation(db),
    };
    const mod = loadTsModule("src/app/actions/contacts.ts", {
        "next/cache": { revalidatePath() {} }, "@/lib/db": { prisma: db }, "@/lib/whatsapp-avatar": {},
        "@/lib/message-source": { resolveMessageSourceId: () => "line-a" },
        "@/lib/system-settings": { getSystemSettingsOrDefaults: async () => ({ phoneDefaultCountry: "MX" }) },
        "@/lib/authz": { requireAnyPermission: async () => { if (denied) throw new Error("denied"); }, requirePermission: async () => {} },
        "@/lib/active-tenant-context": {}, "@/lib/contacts-view": {},
        "@/lib/operation-context": loadTsModule("src/lib/operation-context.ts", {}),
        "@/lib/source-conversations": { findOrCreateActiveConversationForContactSource: async (input: { contactId: string; sourceType: string }) => { assert.equal(input.contactId, saved.id); assert.equal(input.sourceType, "wuzapi"); conversations++; return { id: "conversation-a" }; } },
    });
    return {
        counts: () => ({ creates, conversations }),
        start: (phone: string) => {
            const form = new FormData(); form.set("name", "Nombre escrito de nuevo"); form.set("phone", phone);
            return (mod.startContactChat as (form: FormData) => Promise<{ success: boolean; contact?: { name: string }; conversationId?: string }>)(form);
        },
    };
}

for (const phone of ["+52 55 1234 5678", "525512345678", "5512345678"]) {
    test(`starting a chat reuses the booking client for phone format ${phone}`, async () => {
        const subject = service(); const result = await subject.start(phone);
        assert.equal(result.success, true); assert.equal(result.contact?.name, "Nombre conservado");
        assert.equal(result.conversationId, "conversation-a"); assert.deepEqual(subject.counts(), { creates: 0, conversations: 1 });
    });
}
test("a new chat still creates the client, patient and conversation when the phone is new", async () => {
    const subject = service(false); const result = await subject.start("525512345678");
    assert.equal(result.success, true); assert.deepEqual(subject.counts(), { creates: 1, conversations: 1 });
});
test("denied access cannot look up or create a chat", async () => {
    const subject = service(true, true); await assert.rejects(subject.start("525512345678"), /denied/);
    assert.deepEqual(subject.counts(), { creates: 0, conversations: 0 });
});
