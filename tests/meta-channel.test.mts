// Tenant Cloud API regression suite; providers are simulated, never contacted.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
import { loadTsModule } from "./helpers/load-ts-module.mts";
import * as phone from "../src/lib/phone.ts";
import * as audio from "../src/lib/whatsapp-audio.ts";
import * as sources from "../src/lib/message-source.ts";
import * as normalization from "../src/lib/tenant-webhook-payload.ts";
import { mergeDuplicateContactRecords } from "../src/lib/contact-deduplication.ts";

const require = createRequire(import.meta.url);
const { NextRequest } = require("next/server");
const metaEnv = { ...process.env, META_APP_ID: "audit-app", META_APP_SECRET: "audit-secret", META_EMBEDDED_SIGNUP_CONFIG_ID: "audit-config" };

test("Meta sends text/emoji, image, video, MP3, voice, document and reactions using the tenant token", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown>; bearer: string | null }> = [];
    const loaded = loadTsModule("src/lib/tenant-channels.ts", {
        "server-only": {}, "@/generated/control-plane": { Prisma: {} }, "@/lib/security": {},
        "@/lib/tenant-channel-secrets": { decryptChannelSecret: () => "audit-tenant-token" },
        "@/lib/tenant-services/context": {}, "@/lib/phone": phone, "@/lib/whatsapp-audio": audio,
        "@/lib/control-db": { getControlDb: () => ({ channelConnection: { findFirst: async ({ where }: { where: Record<string, unknown> }) => {
            assert.equal(where.tenantId, "audit-tenant"); assert.equal(where.provider, "META_CLOUD");
            return { externalAccountId: "12345", secretCiphertext: new Uint8Array([1]), secretKeyVersion: 1 };
        } } }) },
    }, { process: { ...process, env: metaEnv }, fetch: async (url: string, init: RequestInit) => {
        calls.push({ url: String(url), body: JSON.parse(String(init.body)), bearer: new Headers(init.headers).get("authorization") });
        return Response.json({ messages: [{ id: "wamid.audit" }] });
    } });
    const sendText = loaded.sendTenantChannelText as (p: Record<string, unknown>) => Promise<{ Id: string }>;
    const sendMedia = loaded.sendTenantChannelMedia as typeof sendText;
    const react = loaded.sendTenantChannelReaction as typeof sendText;
    const template = loaded.sendTenantChannelTemplate as typeof sendText;
    assert.equal((await sendText({ tenantId: "audit-tenant", sourceType: "meta", to: "5214771234567", body: "Hola 👋" })).Id, "wamid.audit");
    for (const type of ["image", "video", "audio", "audio", "document"]) {
        await sendMedia({ tenantId: "audit-tenant", sourceType: "meta", to: "5214771234567", mediaType: type, link: "https://app.test/api/media/file?signature=test", caption: "Texto", fileName: "file.pdf" });
        const body = calls.at(-1)!.body;
        assert.equal(body.to, "524771234567");
        const media = body[type] as Record<string, unknown>;
        assert.equal(media.link, "https://app.test/api/media/file?signature=test");
        assert.equal(media.caption, type === "audio" ? undefined : "Texto");
        assert.equal(media.filename, type === "document" ? "file.pdf" : undefined);
    }
    await react({ tenantId: "audit-tenant", sourceType: "meta", to: "5214771234567", providerMessageId: "wamid.original", reaction: "❤️" });
    await react({ tenantId: "audit-tenant", sourceType: "meta", to: "5214771234567", providerMessageId: "wamid.original", reaction: null });
    assert.equal((calls.at(-1)!.body.reaction as Record<string, unknown>).emoji, "");
    await template({ tenantId: "audit-tenant", sourceId: "12345", to: "5214771234567", templateName: "hello", languageCode: "es_MX", components: [{ type: "body", parameters: [{ type: "text", text: "Joel" }] }] });
    assert.equal(calls.at(-1)!.body.type, "template");
    assert.equal(calls.at(-1)!.body.to, "524771234567");
    assert.ok(calls.every(c => c.bearer === "Bearer audit-tenant-token" && c.url.endsWith("/12345/messages")));
});

test("Meta webhook verifies HMAC, challenge, tenant ownership and keeps a stable event identity", async () => {
    const events: Array<Record<string, unknown>> = [];
    const loaded = loadTsModule("src/app/api/webhooks/tenant/meta/[routeToken]/route.ts", {
        "@/lib/multitenant-features": { isMultitenantChannelsEnabled: () => true },
        "@/lib/tenant-channels": {
            getChannelForRoute: async () => ({ id: "conn", tenantId: "audit-tenant", externalAccountId: "12345" }),
            getChannelForRouteVerification: async () => ({ id: "conn" }), touchChannelWebhook: async () => {},
        },
        "@/lib/security": { safeSecretEqual: (a: string, b: string) => a === b },
        "@/lib/tenant-work-queue": { ingestTenantWebhook: async (p: Record<string, unknown>) => { events.push(p); } },
        "@/lib/tenant-webhook-payload": normalization,
    }, { process: { ...process, env: metaEnv } });
    const post = loaded.POST as (r: Request, c: Record<string, unknown>) => Promise<Response>;
    const get = loaded.GET as typeof post;
    const context = { params: Promise.resolve({ routeToken: "audit-route" }) };
    assert.equal(await (await get(new NextRequest("https://app.test/api/webhooks/tenant/meta/audit-route?hub.mode=subscribe&hub.verify_token=audit-route&hub.challenge=challenge"), context)).text(), "challenge");
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: {
        metadata: { phone_number_id: "12345" }, messages: [{ id: "wamid.input", from: "524771234567", type: "text", text: { body: "Hola 👋" } }],
    } }] }] });
    const signature = `sha256=${crypto.createHmac("sha256", "audit-secret").update(body).digest("hex")}`;
    const request = (signature: string, content = body) => new NextRequest("https://app.test/api/webhooks/tenant/meta/audit-route", { method: "POST", body: content, headers: { "x-hub-signature-256": signature } });
    assert.equal((await post(request("bad-signature"), context)).status, 401);
    assert.equal(events.length, 0);
    assert.equal((await post(request(signature), context)).status, 200);
    await post(request(signature), context);
    assert.equal(events[0].tenantId, "audit-tenant");
    assert.equal(events[0].providerEventId, events[1].providerEventId);
    const foreign = body.replace('"12345"', '"98765"');
    await post(request(`sha256=${crypto.createHmac("sha256", "audit-secret").update(foreign).digest("hex")}`, foreign), context);
    assert.equal(events.at(-1)!.ignored, true);
    assert.equal(events.at(-1)!.tenantId, null);
});

test("QR and official chats use separate contact records and reuse each channel independently", async () => {
    const conversations: Array<Record<string, unknown>> = [{ id: "qr", contactId: "contact", status: "active", sourceType: "wuzapi", sourceId: null, updatedAt: new Date() }];
    const loaded = loadTsModule("src/lib/source-conversations.ts", {
        "@/lib/db": { prisma: { conversation: {
            findFirst: async ({ where }: { where: Record<string, unknown> }) => conversations.find(c => Object.entries(where).every(([key, value]) => c[key] === value)),
            findMany: async ({ where }: { where: Record<string, unknown> }) => conversations.filter(c => Object.entries(where).every(([key, value]) => c[key] === value)),
            create: async ({ data }: { data: Record<string, unknown> }) => { const created = { id: "official", ...data }; conversations.push(created); return created; },
        } } }, "@/lib/message-source": sources, "@prisma/client": { Prisma: {} }, "@/lib/user-assignment": {},
        "@/lib/channel-contacts": { ensureContactForChannel: async (_id: string, source: string) => ({ id: source === "meta" ? "api-contact" : "contact" }) },
        "@/lib/channel-delivery": { resolveChannelSourceId: async (_source: string, id: string) => id },
    });
    const resolve = loaded.findOrCreateActiveConversationForContactSource as (p: Record<string, unknown>) => Promise<{ id: string; contactId: string }>;
    const params = { contactId: "contact", sourceType: "meta", sourceId: "12345" };
    assert.equal((await resolve(params)).id, "official");
    assert.equal((await resolve(params)).id, "official");
    assert.equal((await resolve({ contactId: "contact", sourceType: "wuzapi", sourceId: "qr-instance" })).id, "qr");
    assert.equal(conversations.length, 2);
    assert.equal(conversations.find(c => c.sourceType === "meta")!.contactId, "api-contact");
    assert.equal(conversations.find(c => c.sourceType === "wuzapi")!.contactId, "contact");
});

test("deduplication must not merge contacts or chats belonging to different channels", async () => {
    const transfers: unknown[] = []; const relinks: unknown[] = [];
    await mergeDuplicateContactRecords({ id: "primary", phone: "524771234567", sourceType: "wuzapi", conversations: [{ id: "qr", sourceType: "wuzapi", sourceId: null }] }, [
        { id: "duplicate", phone: "5214771234567", sourceType: "meta", conversations: [{ id: "official", sourceType: "meta", sourceId: "12345" }] },
    ], {
        message: { updateMany: async p => { transfers.push(p); } },
        conversation: { update: async p => { relinks.push(p); }, delete: async () => {} },
        contact: { findMany: async () => [], update: async () => {}, delete: async () => {} },
    });
    assert.equal(transfers.length, 0, "official history was merged into QR by the fallback conversation");
    assert.equal(relinks.length, 0);
});

function templateHarness(rejectSend = false) {
    const writes: Array<Record<string, unknown>> = []; let legacySends = 0;
    const loaded = loadTsModule("src/app/api/templates/meta/send/route.ts", {
        "next/cache": { revalidatePath: () => {} }, "@/lib/auth": { auth: async () => ({ user: { id: "user" } }) },
        "@/lib/db": { prisma: {
            contact: { findFirst: async () => ({ id: "contact", phone: "524771234567" }) },
            conversation: { update: async ({ data }: { data: Record<string, unknown> }) => { writes.push(data); } },
            message: { create: async () => ({ id: "message" }) },
        } },
        "@/lib/meta-whatsapp": { sendMetaTemplateMessage: async () => { legacySends++; return { Id: "wamid.template" }; } },
        "@/lib/channel-delivery": { sendChannelTemplate: async () => { if (rejectSend) throw new Error("Meta rechazó la plantilla"); return { Id: "wamid.template" }; }, resolveChannelSourceId: async () => "12345" },
        "@/lib/authz": { ensurePermissionResponse: () => null },
        "@/lib/whatsapp-audio": audio,
        "@/lib/message-source": sources, "@/lib/phone": phone,
        "@/lib/source-conversations": { findOrCreateActiveConversationForContactSource: async () => ({ id: "official", assignedUserId: null }) },
        "@/lib/system-settings": { getSystemSettingsOrDefaults: async () => ({ whatsappPhoneNumberId: "legacy-phone-id" }) },
        "@/lib/user-assignment": { resolveAssignableTenantUserId: async () => null },
    }, { Error });
    const post = loaded.POST as (r: Request) => Promise<Response>;
    return { writes, legacySends: () => legacySends, send: () => post(new NextRequest("https://app.test/api/templates/meta/send", { method: "POST", body: JSON.stringify({ templateName: "hello", recipients: ["524771234567"] }) })) };
}

test("templates must use tenant channel delivery, not legacy credentials", async () => {
    const audit = templateHarness(); const response = await audit.send();
    const result = await response.json();
    assert.equal(result.sent, 1);
    assert.equal(result.message.id, "message");
    assert.equal(result.conversationId, "official");
    assert.equal(audit.legacySends(), 0, "the tenant template route called the legacy delivery function");
});

test("a rejected template is not reported as sent; UI never opens a window after a template", async () => {
    const audit = templateHarness(true); const response = await audit.send();
    assert.equal(response.ok, false);
    const result = await response.json();
    assert.equal(result.success, false); assert.equal(result.sent, 0);
    assert.match(result.error, /rechazó/); assert.equal(audit.writes.length, 0);
    const inbox = fs.readFileSync("src/app/dashboard/inbox/page.tsx", "utf8");
    const onSent = inbox.slice(inbox.indexOf("onSent={(rawResult)"), inbox.indexOf("{/* Forward Message Dialog */}"));
    assert.ok(onSent.length > 0);
    assert.ok(!onSent.includes("sessionExpiresAt:") && !onSent.includes("setIsWindowOpen(true)"));
});

test("sending a template must not open a customer service window without a customer reply", async () => {
    const audit = templateHarness(); const response = await audit.send();
    assert.equal((await response.json()).sent, 1);
    assert.equal(audit.writes.length, 1);
    assert.ok(audit.writes.every(write => !('sessionExpiresAt' in write)), "outbound template incorrectly unlocks free-form replies for 24 hours");
});

test("delayed sent receipts must not downgrade a read message", async () => {
    const worker = fs.readFileSync("scripts/tenant-work-worker.mjs", "utf8");
    const start = worker.indexOf("function text("); const end = worker.indexOf("async function processWebhookEvent(", start);
    const context = vm.createContext({}); vm.runInContext(worker.slice(start, end), context);
    const apply = context.applyStatus as (db: unknown, event: unknown) => Promise<void>;
    const db = new PGlite();
    try {
        await db.exec(`CREATE TABLE "Conversation" ("id" TEXT PRIMARY KEY, "updatedAt" TIMESTAMP);
            CREATE TABLE "Message" ("id" TEXT PRIMARY KEY, "conversationId" TEXT, "source_type" TEXT, "providerMessageId" TEXT, "status" TEXT, "createdAt" TIMESTAMP, "source_id" TEXT);
            INSERT INTO "Conversation" VALUES ('official', NOW());
            INSERT INTO "Message" VALUES ('msg', 'official', 'meta', 'wamid.a', 'read', NOW(), '12345');`);
        const adapter = { query: async (sql: string, params: unknown[]) => { const result = await db.query(sql, params); return { ...result, rowCount: result.affectedRows || result.rows.length }; } };
        await apply(adapter, { payload: { sourceType: "meta", sourceId: "12345", providerMessageId: "wamid.a", messageStatus: "sent" } });
        assert.equal((await db.query<{ status: string }>('SELECT "status" FROM "Message"')).rows[0].status, "read");
        await apply(adapter, { payload: { sourceType: "meta", sourceId: "12345", providerMessageId: "wamid.a", messageStatus: "failed" } });
        assert.equal((await db.query<{ status: string }>('SELECT "status" FROM "Message"')).rows[0].status, "read");
        await assert.rejects(apply(adapter, { payload: { sourceType: "meta", sourceId: "other-number", providerMessageId: "wamid.a", messageStatus: "sent" } }), /retry/);
        await assert.rejects(apply(adapter, { payload: { sourceType: "meta", sourceId: "12345", providerMessageId: "wamid.not-persisted-yet", messageStatus: "delivered" } }), /retry/);
    } finally { await db.close(); }
});

test("server must reject a free-form official reply after the customer window expires", async () => {
    let sends = 0;
    const loaded = loadTsModule("src/lib/outbound-messages.ts", {
        "@/lib/db": { prisma: {
            conversation: { findUnique: async () => ({ id: "official", contact: { phone: "524771234567" }, sourceType: "meta", sourceId: "12345", sessionExpiresAt: new Date(0) }), update: async () => ({}) },
            message: { create: async () => ({ id: "message" }), update: async () => ({ id: "message" }) },
        } },
        "@/lib/media-data-url": {}, "@/lib/media-url": {}, "@/lib/message-source": sources,
        "@/lib/system-settings": { getSystemSettingsOrDefaults: async () => ({}) },
        "@/lib/source-conversations": {}, "@/lib/billing/chatbot-usage": {},
        "@/lib/user-assignment": { resolveAssignableTenantUserId: async () => null },
        "@/lib/whatsapp-audio": audio,
        "@/lib/channel-delivery": { sendChannelText: async () => { sends++; return { Id: "wamid.test" }; } },
    });
    const send = loaded.sendOutboundConversationMessage as (params: Record<string, unknown>) => Promise<unknown>;
    await assert.rejects(send({ conversationId: "official", sourceType: "meta", content: "Hola" }), /ventana|plantilla|24/i);
    assert.equal(sends, 0);
});

test("template management and sends select only the tenant's WABA and exact sending number", async () => {
    const calls: Array<{ url: string; method?: string; body: Record<string, unknown> }> = [];
    const loaded = loadTsModule("src/lib/tenant-channels.ts", {
        "server-only": {}, "@/generated/control-plane": { Prisma: {} }, "@/lib/security": {},
        "@/lib/tenant-channel-secrets": { decryptChannelSecret: () => "tenant-token" },
        "@/lib/tenant-services/context": {}, "@/lib/phone": phone, "@/lib/whatsapp-audio": audio,
        "@/lib/control-db": { getControlDb: () => ({ channelConnection: { findFirst: async ({ where }: { where: Record<string, unknown> }) => {
            assert.equal(where.tenantId, "tenant");
            if (where.externalAccountId && where.externalAccountId !== "12345") return null;
            return { externalAccountId: "12345", wabaId: "67890", secretCiphertext: new Uint8Array([1]), secretKeyVersion: 1 };
        } } }) },
    }, { process: { ...process, env: metaEnv }, fetch: async (url: string, init: RequestInit) => {
        calls.push({ url: String(url), method: init.method, body: JSON.parse(String(init.body || "{}")) });
        return Response.json({ messages: [{ id: "wamid.ok" }], data: [{ name: "hello" }], success: true });
    } });
    const manage = loaded.manageTenantMetaTemplates as (tenant: string, operation: string, input?: Record<string, unknown>) => Promise<{ items: unknown[] }>;
    assert.equal((await manage("tenant", "list")).items.length, 1);
    await manage("tenant", "create", { name: "hello", category: "UTILITY", components: [{ type: "BODY", text: "Hola" }] });
    await manage("tenant", "delete", { name: "hello" });
    assert.ok(calls.every(c => c.url.includes("/67890/message_templates")));
    assert.equal(calls[1].method, "POST"); assert.equal(calls[2].method, "DELETE");
    const send = loaded.sendTenantChannelText as (params: Record<string, unknown>) => Promise<unknown>;
    await assert.rejects(send({ tenantId: "tenant", sourceType: "meta", sourceId: "foreign-number", to: "524771234567", body: "hola" }), /conectado/);
    assert.equal(calls.length, 3);
    await send({ tenantId: "tenant", sourceType: "meta", sourceId: "12345", to: "524771234567", body: "hola" });
    assert.ok(calls.at(-1)!.url.endsWith("/12345/messages"));
});

test("Cloud API requires a native acknowledgement, not just HTTP 200", async () => {
    const loaded = loadTsModule("src/lib/tenant-channels.ts", {
        "server-only": {}, "@/generated/control-plane": { Prisma: {} }, "@/lib/security": {},
        "@/lib/tenant-channel-secrets": { decryptChannelSecret: () => "tenant-token" },
        "@/lib/tenant-services/context": {}, "@/lib/phone": phone, "@/lib/whatsapp-audio": audio,
        "@/lib/control-db": { getControlDb: () => ({ channelConnection: { findFirst: async () => ({ externalAccountId: "12345", secretCiphertext: new Uint8Array([1]), secretKeyVersion: 1 }) } }) },
    }, { process: { ...process, env: metaEnv }, fetch: async () => Response.json({}) });
    for (const [name, params] of [
        ["sendTenantChannelText", { body: "hola" }],
        ["sendTenantChannelTemplate", { templateName: "hello" }],
        ["sendTenantChannelMedia", { mediaType: "audio", link: "https://app.test/file.mp3" }],
        ["sendTenantChannelReaction", { providerMessageId: "wamid.original", reaction: "👍" }],
    ] as const) {
        const send = loaded[name] as (params: Record<string, unknown>) => Promise<unknown>;
        await assert.rejects(send({ tenantId: "tenant", sourceType: "meta", to: "524771234567", ...params }), /confirm/i);
    }
});

test("Embedded Signup persists tenant WABA, validates PIN and requires confirmed registration", async () => {
    const writes: Array<Record<string, unknown>> = [];
    let stateRecord: Record<string, unknown> | null = null;
    let registrationSuccess = true;
    let requests = 0;
    const connection = {
        findUnique: async () => null,
        findFirst: async () => null,
        upsert: async ({ create }: { create: Record<string, unknown> }) => { writes.push(create); return { id: "conn" }; },
        update: async ({ data }: { data: Record<string, unknown> }) => { writes.push(data); return { id: "conn", provider: "META_CLOUD", wabaId: "67890", ...data }; },
    };
    const state = {
        create: async ({ data }: { data: Record<string, unknown> }) => { stateRecord = { id: "state", ...data }; },
        findUnique: async () => stateRecord,
        updateMany: async ({ data }: { data: Record<string, unknown> }) => {
            if (!stateRecord || stateRecord.consumedAt) return { count: 0 };
            Object.assign(stateRecord, data);
            return { count: 1 };
        },
    };
    const loaded = loadTsModule("src/lib/tenant-channels.ts", {
        "server-only": {}, "@/generated/control-plane": { Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" }, PrismaClientKnownRequestError: class extends Error {} } },
        "@/lib/security": { hashSecurityIdentifier: (s: string) => crypto.createHash("sha256").update(s).digest("hex"), safeSecretEqual: (a: string, b: string) => a === b },
        "@/lib/tenant-channel-secrets": { encryptChannelSecret: () => ({ ciphertext: new Uint8Array([1]), keyVersion: 1 }) },
        "@/lib/tenant-services/context": { TenantServiceError: class extends Error { constructor(_code: string, message: string) { super(message); } } },
        "@/lib/phone": phone, "@/lib/whatsapp-audio": audio,
        "@/lib/control-db": { getControlDb: () => ({ channelConnection: connection, channelConnectionState: state,
            $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ channelConnection: connection, channelConnectionState: state }),
        }) },
    }, { process: { ...process, env: { ...metaEnv, APP_BASE_URL: "https://app.test", AUTH_SECRET: "fixture-only-long-signing-key-at-least-32-chars", META_WHATSAPP_REGISTRATION_PIN: "" } }, fetch: async (url: string) => {
        requests++;
        if (String(url).includes("oauth/access_token")) return Response.json({ access_token: "tenant-only-token" });
        if (String(url).includes("phone_numbers?")) return Response.json({ data: [{ id: "12345" }] });
        if (String(url).includes("?fields=id,display_phone_number")) return Response.json({ display_phone_number: "524771234567" });
        if (String(url).endsWith("/register")) return Response.json({ success: registrationSuccess });
        return Response.json({ success: true });
    } });
    const begin = loaded.beginMetaEmbeddedSignup as (params: Record<string, unknown>) => Promise<{ state: string }>;
    const complete = loaded.completeMetaEmbeddedSignup as (params: Record<string, unknown>) => Promise<unknown>;
    const start = await begin({ tenantId: "tenant", userId: "user" });
    const params = { tenantId: "tenant", userId: "user", state: start.state, code: "fixture-code", wabaId: "67890", phoneNumberId: "12345" };
    await assert.rejects(complete(params), /PIN/); assert.equal(requests, 0);
    const completed = await complete({ ...params, registrationPin: "123456" }) as { channel: { requiresReconnect: boolean } };
    assert.equal(writes[0].wabaId, "67890"); assert.equal(writes[0].tenantId, "tenant");
    assert.equal(writes.at(-1)!.status, "CONNECTED");
    assert.equal(completed.channel.requiresReconnect, false);
    await assert.rejects(complete({ ...params, registrationPin: "123456" }), /usado|consumido|inválido/i);
    registrationSuccess = false;
    const next = await begin({ tenantId: "tenant", userId: "user" });
    await assert.rejects(complete({ ...params, state: next.state, registrationPin: "123456" }), /Meta/);
    assert.equal(writes.at(-1)!.status, "FAILED");
});
