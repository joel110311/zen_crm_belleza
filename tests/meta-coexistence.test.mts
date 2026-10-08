import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { loadTsModule } from "./helpers/load-ts-module.mts";
import { metaSignupExtras, parseMetaSignupMessage, metaSignupFailure, isMetaSignupOrigin } from "../src/lib/meta-signup.ts";
import { normalizeMetaWebhook } from "../src/lib/tenant-webhook-payload.ts";
import { storeMetaSyncedMessage, applyMetaContactSync, applyMetaMessageChange, applyMetaSyncedReaction } from "../src/lib/meta-coexistence-processing.ts";
import * as phone from "../src/lib/phone.ts";
import * as audio from "../src/lib/whatsapp-audio.ts";

function envelope(field: string, value: Record<string, unknown>, wabaId = "waba") {
    return { object: "whatsapp_business_account", entry: [{ id: wabaId, changes: [{ field, value: { metadata: { phone_number_id: "official", display_phone_number: "524771111111" }, ...value } }] }] };
}

test("both signup panels launch v4 coexistence and accept a WABA-only finish safely", () => {
    assert.equal(metaSignupExtras("coexistence").featureType, "whatsapp_business_app_onboarding");
    assert.equal(metaSignupExtras("coexistence").version, "v4");
    assert.equal(metaSignupExtras("coexistence").sessionInfoVersion, "3");
    assert.ok(!("featureType" in metaSignupExtras("cloud")));
    assert.equal(parseMetaSignupMessage({ type: "WA_EMBEDDED_SIGNUP", event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", data: { waba_id: "waba" } })?.phoneNumberId, "");
    assert.equal(parseMetaSignupMessage({ type: "WA_EMBEDDED_SIGNUP", event: "FINISH", data: { waba_id: "waba" } }), null);
    assert.equal(isMetaSignupOrigin("https://www.facebook.com"), true);
    assert.equal(isMetaSignupOrigin("https://fakefacebook.com"), false);
    assert.equal(isMetaSignupOrigin("https://facebook.com.evil.test"), false);
    assert.match(metaSignupFailure({ type: "WA_EMBEDDED_SIGNUP", event: "CANCEL" })!, /Cancelaste/);
    assert.match(metaSignupFailure(JSON.stringify({ type: "WA_EMBEDDED_SIGNUP", event: "ERROR" }))!, /no pudo completar/);
    assert.equal(metaSignupFailure({ type: "OTHER", event: "ERROR" }), null);
    for (const path of ["src/components/tenant/tenant-channel-setup.tsx", "src/components/settings/meta-whatsapp-panel.tsx"]) assert.match(fs.readFileSync(path, "utf8"), /metaSignupExtras\(/);
});

test("phone echoes use the customer recipient and preserve native IDs and attachment metadata", () => {
    for (const type of ["text", "image", "audio", "video", "document"] as const) {
        const payload = envelope("smb_message_echoes", { message_echoes: [{ from: "524771111111", to: "524772222222", id: `wamid.${type}`, timestamp: "1791410400", type, [type]: type === "text" ? { body: "Hola 👍" } : { id: "media", mime_type: type === "audio" ? "audio/mpeg" : `${type}/test`, caption: "Archivo", filename: "test" } }] });
        const [event] = normalizeMetaWebhook(payload, "hash");
        assert.equal(event.sourceId, "official"); assert.equal(event.payload.phone, "524772222222");
        assert.equal(event.payload.direction, "outbound"); assert.equal(event.payload.isHistorical, false);
        assert.equal(event.payload.providerMessageId, `wamid.${type}`);
        if (type !== "text") assert.equal(event.payload.providerMediaId, "media");
        assert.equal(normalizeMetaWebhook(payload, "hash")[0].providerEventId, event.providerEventId);
    }
});

test("history is chunked, direction-aware, never live; media supplements and denied consent are retained", () => {
    const messages = Array.from({ length: 51 }, (_, i) => ({ id: `history-${i}`, from: i % 2 ? "524771111111" : "524772222222", timestamp: "1791000000", type: "text", text: { body: "pasado" }, history_context: { status: "READ" } }));
    const events = normalizeMetaWebhook(envelope("history", { history: [{ metadata: { progress: 100 }, threads: [{ id: "524772222222", messages }] }] }), "history-hash");
    const batches = events.filter(e => e.payload.kind === "history");
    assert.deepEqual(batches.map(e => e.payload.historyItems!.length), [50, 1]);
    assert.ok(batches.flatMap(e => e.payload.historyItems!).every(m => m.isHistorical));
    assert.equal(batches[0].payload.historyItems![0].direction, "inbound"); assert.equal(batches[0].payload.historyItems![1].direction, "outbound");
    assert.equal(events.at(-1)!.payload.syncProgress, 100);
    const media = normalizeMetaWebhook(envelope("history", { messages: [{ id: "history-0", from: "524772222222", timestamp: "1791000000", type: "image", image: { id: "asset" } }] }), "media-hash");
    assert.equal(media[0].payload.historyItems![0].providerMediaId, "asset");
    const declined = normalizeMetaWebhook(envelope("history", { history: [{ errors: [{ code: 2593109 }] }] }), "denied");
    assert.match(declined[0].payload.syncError!, /no compartir/);
});

test("account lifecycle without phone ID binds only to the signed route's matching WABA", () => {
    const payload = { object: "whatsapp_business_account", entry: [{ id: "waba", changes: [{ field: "account_update", value: { event: "PARTNER_REMOVED" } }] }] };
    assert.equal(normalizeMetaWebhook(payload, "hash", { sourceId: "official", wabaId: "waba" })[0].payload.channelEvent, "PARTNER_REMOVED");
    assert.equal(normalizeMetaWebhook(payload, "hash", { sourceId: "official", wabaId: "foreign" })[0].payload.kind, "ignored");
});

type Row = Record<string, unknown>;
function memoryDatabase() {
    const contacts: Row[] = [{ id: "qr", phone: "524772222222", sourceType: "wuzapi", name: "QR" }];
    const conversations: Row[] = [{ id: "qr-chat", contactId: "qr", sourceType: "wuzapi", sourceId: null, status: "active", botActive: true, updatedAt: new Date(0) }];
    const messages: Row[] = []; const conversationWrites: Row[] = [];
    function matches(row: Row, where: Row): boolean {
        return Object.entries(where).every(([key, value]) => {
            if (key === "OR") return (value as Row[]).some(clause => matches(row, clause));
            if (value === null) return row[key] == null;
            if (value && typeof value === "object" && "lt" in value) return row[key] != null && Number(row[key]) < Number((value as { lt: Date }).lt);
            if (value && typeof value === "object" && "endsWith" in value) return String(row[key]).endsWith(String((value as Row).endsWith));
            return row[key] === value;
        });
    }
    function model(rows: Row[], prefix: string) {
        return {
            findFirst: async ({ where }: { where: Row }) => rows.find(r => matches(r, where)) || null,
            findUnique: async ({ where }: { where: Row }) => rows.find(r => r.id === where.id) || null,
            upsert: async ({ create }: { create: Row }) => { const row = { id: `${prefix}-${rows.length}`, ...create }; rows.push(row); return row; },
            create: async ({ data }: { data: Row }) => { const row = { id: `${prefix}-${rows.length}`, updatedAt: new Date(0), ...data }; rows.push(row); return row; },
            update: async ({ where, data }: { where: Row; data: Row }) => { const row = rows.find(r => r.id === where.id)!; if (prefix === "conv") conversationWrites.push(data); Object.assign(row, data); return row; },
            updateMany: async ({ where, data }: { where: Row; data: Row }) => { const row = rows.find(r => matches(r, where)); if (!row) return { count: 0 }; if (prefix === "conv") conversationWrites.push(data); Object.assign(row, data); return { count: 1 }; },
        };
    }
    const db = { contact: model(contacts,"contact"), conversation: model(conversations,"conv"), message: model(messages,"message"), $queryRawUnsafe: async () => [], $transaction: async (run: (tx: unknown) => Promise<unknown>) => run(db) };
    return { db: db as unknown as Parameters<typeof storeMetaSyncedMessage>[0], contacts, conversations, messages, conversationWrites };
}

test("a live phone reply pauses only API, persists once and never sends back or opens a window", async () => {
    const m = memoryDatabase(); const payload = normalizeMetaWebhook(envelope("smb_message_echoes", { message_echoes: [{ id: "phone-msg", from: "524771111111", to: "524772222222", timestamp: "1791410400", type: "text", text: { body: "lo atiendo yo" } }] }), "echo")[0].payload;
    await storeMetaSyncedMessage(m.db, payload, async () => ({ type: "text" }));
    await storeMetaSyncedMessage(m.db, payload, async () => ({ type: "text" }));
    assert.equal(m.contacts.length, 2); assert.equal(m.messages.length, 1);
    assert.equal(m.messages[0].senderType, "human"); assert.equal(m.conversations.find(c=>c.sourceType==="meta")!.botActive,false);
    assert.equal(m.conversations[0].botActive,true); assert.ok(m.conversationWrites.every(write => !("sessionExpiresAt" in write)));
});

test("history imports do not pause a live bot or enqueue AI; later media hydrates the same message", async () => {
    const m = memoryDatabase(); m.contacts.push({ id:"api", sourceType:"meta", phone:"524772222222" });
    m.conversations.push({ id:"api-chat", contactId:"api", sourceType:"meta", sourceId:"official", status:"active", botActive:true, updatedAt:new Date() });
    const item = { kind:"message" as const, sourceType:"meta" as const, sourceId:"official", phone:"524772222222", providerMessageId:"past", direction:"inbound" as const, isHistorical:true, occurredAt:"2026-09-01T00:00:00Z", content:"[Archivo histórico]", mediaPlaceholder:true };
    await storeMetaSyncedMessage(m.db,item,async()=> { assert.fail("no media in placeholder"); });
    assert.ok(m.messages[0].botProcessedAt); assert.equal(m.conversations[1].botActive,true);
    await storeMetaSyncedMessage(m.db,{...item, mediaPlaceholder:false, providerMediaId:"asset", messageType:"image", content:"foto"},async()=>({type:"image",mediaUrl:"/api/media/tenant-file.jpg"}));
    assert.equal(m.messages.length,1); assert.equal(m.messages[0].mediaUrl,"/api/media/tenant-file.jpg");
    assert.equal(m.messages[0].direction,"inbound"); assert.equal(m.conversations[1].botActive,true);
});

test("echoes of already acknowledged bot messages do not pause the bot", async () => {
    const m=memoryDatabase(); m.contacts.push({id:"api",sourceType:"meta",phone:"524772222222"});
    m.conversations.push({id:"api-chat",contactId:"api",sourceType:"meta",sourceId:"official",status:"active",botActive:true,updatedAt:new Date()});
    m.messages.push({id:"bot",conversationId:"api-chat",sourceType:"meta",sourceId:"official",providerMessageId:"bot-id",senderType:"bot",type:"text"});
    await storeMetaSyncedMessage(m.db,{kind:"message",sourceType:"meta",sourceId:"official",providerMessageId:"bot-id",phone:"524772222222",direction:"outbound",content:"bot"},async()=>({type:"text"}));
    assert.equal(m.messages.length,1); assert.equal(m.conversations[1].botActive,true);
});

test("contact removal preserves CRM data; edits, revocations and reactions remain scoped to API", async () => {
    const m=memoryDatabase(); await applyMetaContactSync(m.db,{kind:"contacts",sourceType:"meta",sourceId:"official",contactItems:[{phone:"524772222222",name:"Nombre API",action:"add",occurredAt:"2026-10-08T00:00:00Z"}]});
    await applyMetaContactSync(m.db,{kind:"contacts",sourceType:"meta",sourceId:"official",contactItems:[{phone:"524772222222",action:"remove",occurredAt:"2026-10-08T01:00:00Z"}]});
    assert.equal(m.contacts.length,2); assert.equal(m.contacts[0].name,"QR"); assert.ok(m.contacts[1].providerContactRemovedAt);
    m.messages.push({id:"api-message",providerMessageId:"original",sourceType:"meta",sourceId:"official",conversationId:"api-chat",content:"antes",type:"text"});
    await applyMetaMessageChange(m.db,{kind:"message_change",sourceType:"meta",sourceId:"official",targetProviderMessageId:"original",changeAction:"edit",content:"después"},async()=>({type:"text"}));
    assert.equal(m.messages[0].content,"después");
    await assert.rejects(applyMetaMessageChange(m.db,{kind:"message_change",sourceType:"meta",sourceId:"foreign",targetProviderMessageId:"original",changeAction:"revoke"},async()=>({type:"text"})), /antes/);
    await applyMetaSyncedReaction(m.db,{kind:"reaction",sourceType:"meta",sourceId:"official",targetProviderMessageId:"original",reaction:"👍"}); assert.equal(m.messages[0].reaction,"👍");
    await applyMetaMessageChange(m.db,{kind:"message_change",sourceType:"meta",sourceId:"official",targetProviderMessageId:"original",changeAction:"revoke"},async()=>({type:"text"}));
    assert.equal(m.messages.length,1); assert.match(String(m.messages[0].content),/eliminado/);
});

test("late contact updates and edits cannot resurrect deleted data or overwrite newer changes", async () => {
    const m = memoryDatabase();
    const contactEvent = { kind: "contacts" as const, sourceType: "meta" as const, sourceId: "official" };
    await applyMetaContactSync(m.db, { ...contactEvent, contactItems: [{ phone: "524772222222", name: "Actual", action: "add", occurredAt: "2026-10-08T02:00:00Z" }] });
    await applyMetaContactSync(m.db, { ...contactEvent, contactItems: [{ phone: "524772222222", name: "Anterior", action: "add", occurredAt: "2026-10-08T01:00:00Z" }] });
    assert.equal(m.contacts[1].name, "Actual");
    m.messages.push({ id: "msg", providerMessageId: "native", sourceType: "meta", sourceId: "official", conversationId: "api-chat", content: "inicial", type: "image" });
    const change = { kind: "message_change" as const, sourceType: "meta" as const, sourceId: "official", targetProviderMessageId: "native", changeAction: "edit" as const };
    await applyMetaMessageChange(m.db, { ...change, content: "nuevo", occurredAt: "2026-10-08T02:00:00Z" }, async () => ({ type: "text" }));
    await applyMetaMessageChange(m.db, { ...change, content: "viejo", occurredAt: "2026-10-08T01:00:00Z" }, async () => { assert.fail("stale edit must not download media"); });
    assert.equal(m.messages[0].content, "nuevo");
    await applyMetaMessageChange(m.db, { ...change, changeAction: "revoke", occurredAt: "2026-10-08T03:00:00Z" }, async () => ({}));
    await applyMetaMessageChange(m.db, { ...change, content: "resucitado", occurredAt: "2026-10-08T04:00:00Z" }, async () => { assert.fail("revocation is terminal"); });
    await storeMetaSyncedMessage(m.db, { kind: "message", sourceType: "meta", sourceId: "official", phone: "524772222222", providerMessageId: "native", isHistorical: true, providerMediaId: "late-asset", messageType: "image" }, async () => { assert.fail("a historical supplement must not resurrect deleted media"); });
    assert.match(String(m.messages[0].content), /eliminado/); assert.equal(m.messages[0].mediaUrl, null);
});

test("malformed historical reactions and changes without a target are discarded", () => {
    for (const type of ["edit", "revoke", "reaction"]) {
        const result = normalizeMetaWebhook(envelope("smb_message_echoes", { message_echoes: [{ id: "malformed", from: "524771111111", to: "524772222222", type, [type]: {} }] }), "bad");
        assert.ok(result.every(event => event.payload.kind === "ignored"));
    }
});

test("coexistence migrations preserve rows and agree across legacy and tenant deployments", async () => {
    const sql=fs.readFileSync("prisma/tenant-migrations/20261008001000_meta_contact_sync/migration.sql","utf8");
    assert.equal(sql,fs.readFileSync("prisma/legacy-runtime-migrations/20261008_meta_contact_sync.sql","utf8"));
    assert.equal(sql,fs.readFileSync("prisma/migrations/20261008001000_meta_contact_sync/migration.sql","utf8"));
    const db=new PGlite(); try {
        await db.exec(`CREATE TABLE "Contact" (id text); CREATE TABLE "Message" (id text); CREATE TABLE "SystemSettings" (id text); CREATE TABLE "ChannelConnection" (id text); INSERT INTO "Contact" VALUES ('keep');`);
        await db.exec(sql); await db.exec(fs.readFileSync("prisma/control-plane/migrations/20261008001000_meta_coexistence/migration.sql","utf8"));
        assert.equal((await db.query('SELECT * FROM "Contact"')).rows.length,1);
        await db.exec(`INSERT INTO "ChannelConnection" (id) VALUES ('conn')`);
        await db.query(`UPDATE "ChannelConnection" SET "coexistenceSync"=COALESCE("coexistenceSync",'{}'::jsonb)||$1::jsonb WHERE id='conn'`,[JSON.stringify({historyProgress:100})]);
        await db.query(`UPDATE "ChannelConnection" SET "coexistenceSync"=COALESCE("coexistenceSync",'{}'::jsonb)||$1::jsonb WHERE id='conn'`,[JSON.stringify({historyState:"REQUESTED"})]);
        assert.deepEqual((await db.query<{coexistenceSync:unknown}>('SELECT "coexistenceSync" FROM "ChannelConnection"')).rows[0].coexistenceSync,{historyProgress:100,historyState:"REQUESTED"});
        const claim = `UPDATE "ChannelConnection" SET "coexistenceSync"=COALESCE("coexistenceSync",'{}'::jsonb)||$1::jsonb WHERE id='conn' AND NOT (COALESCE("coexistenceSync",'{}'::jsonb) ? $2::text) RETURNING id`;
        assert.equal((await db.query(claim, [JSON.stringify({ smb_app_state_syncState: "REQUESTING" }), "smb_app_state_syncState"])).rows.length, 1);
        assert.equal((await db.query(claim, [JSON.stringify({ smb_app_state_syncState: "REQUESTING" }), "smb_app_state_syncState"])).rows.length, 0);
        await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text",["native-message"]);
    } finally { await db.close(); }
});

test("tenant history processing bypasses AI and rejects nested messages from a foreign channel", async () => {
    let processed = 0; let imported = 0;
    const payload: Row = { kind: "history", sourceType: "meta", sourceId: "official", historyItems: [{ kind: "message", sourceType: "meta", sourceId: "official", isHistorical: true }] };
    const db = { webhookEvent: { findFirst: async () => ({ payload }), update: async ({ data }: { data: Row }) => { if (data.status === "PROCESSED") processed++; } }, channelConnection: { findFirst: async () => ({ id: "conn" }) } };
    const loaded = loadTsModule("src/lib/tenant-inbound-processing.ts", {
        "server-only": {}, "@/app/actions/chat": { processInboundMessage: () => assert.fail("history must never enqueue the AI") },
        "@/lib/control-db": { getControlDb: () => db }, "@/lib/routed-prisma": { runWithTenantPrisma: (_db: unknown, run: () => Promise<unknown>) => run() },
        "@/lib/tenant-prisma-manager": { getTenantPrismaManager: () => ({ getForTenant: async () => ({}) }) }, "@/lib/wuzapi-outbound-echo-runtime": {},
        "@/lib/tenant-inbound-media": {}, "@/lib/tenant-channels": {}, "@/lib/meta-coexistence-processing": { storeMetaSyncedMessage: async () => { imported++; } },
    });
    const processEvent = loaded.processTenantInboundWebhookEvent as (tenant: string, event: string) => Promise<unknown>;
    await processEvent("tenant", "event"); assert.equal(imported, 1); assert.equal(processed, 1);
    payload.historyItems = [{ kind: "message", sourceType: "meta", sourceId: "foreign" }];
    await assert.rejects(processEvent("tenant", "foreign-event"), /otro canal/);
    assert.equal(imported, 1); assert.equal(processed, 1);
});

function signupHarness(options: { multiple?: boolean; unconfirmed?: boolean; priorSync?: Record<string,unknown>; rejectSync?: boolean }={}) {
    const requests: Array<{url:string;body:Record<string,unknown>}> = []; const writes: Row[]=[]; let state: Row | null=null;
    const connection={ findFirst:async()=>null,findUnique:async()=>options.priorSync ? {tenantId:"tenant",coexistenceSync:options.priorSync}:null,
        upsert:async({create}:{create:Row})=>{writes.push(create);return{id:"conn"};},update:async({data}:{data:Row})=>({id:"conn",provider:"META_CLOUD",wabaId:"waba",isCoexistence:true,...data}) };
    const stateModel={ create:async({data}:{data:Row})=>{state={id:"state",...data};},findUnique:async()=>state,updateMany:async()=>{if(state?.consumedAt)return{count:0};state!.consumedAt=new Date();return{count:1};} };
    const db={channelConnection:connection,channelConnectionState:stateModel,$transaction:async(run:(tx:unknown)=>Promise<unknown>)=>run({channelConnection:connection,channelConnectionState:stateModel}),$executeRawUnsafe:async(_sql:string,_id:string,patch:string)=>{writes.push(JSON.parse(patch));return 1;} };
    const loaded=loadTsModule("src/lib/tenant-channels.ts",{"server-only":{},"@/generated/control-plane":{Prisma:{TransactionIsolationLevel:{Serializable:"Serializable"},PrismaClientKnownRequestError:class extends Error{}}},
        "@/lib/security":{hashSecurityIdentifier:(s:string)=>crypto.createHash("sha256").update(s).digest("hex"),safeSecretEqual:(a:string,b:string)=>a===b},
        "@/lib/tenant-channel-secrets":{encryptChannelSecret:()=>({ciphertext:new Uint8Array([1]),keyVersion:1})},"@/lib/tenant-services/context":{TenantServiceError:class extends Error{constructor(_c:string,m:string){super(m);}}},"@/lib/phone":phone,"@/lib/whatsapp-audio":audio,"@/lib/control-db":{getControlDb:()=>db}},
        {Error,process:{...process,env:{...process.env,META_APP_ID:"app",META_APP_SECRET:"secret",META_EMBEDDED_SIGNUP_CONFIG_ID:"config",AUTH_SECRET:"fixture-signing-secret-at-least-32-characters",APP_BASE_URL:"https://app.test",META_WHATSAPP_REGISTRATION_PIN:""}},fetch:async(url:string,input:{body?:string}={})=>{
            const body=input.body?JSON.parse(input.body):{};requests.push({url:String(url),body});
            if(String(url).includes("oauth/access_token"))return Response.json({access_token:"tenant-token"});
            if(String(url).includes("phone_numbers?"))return Response.json({data:[{id:"number",is_on_biz_app:true,platform_type:"CLOUD_API"},...(options.multiple?[{id:"other",is_on_biz_app:true,platform_type:"CLOUD_API"}]:[])]});
            if(String(url).includes("?fields=id,display_phone_number"))return Response.json({display_phone_number:"524771111111",is_on_biz_app:!options.unconfirmed,platform_type:"CLOUD_API"});
            if(String(url).endsWith("/smb_app_data"))return options.rejectSync?Response.json({error:{message:"sync rejected"}},{status:400}):Response.json({request_id:`request-${body.sync_type}`});
            if(String(url).endsWith("/register"))assert.fail("coexistence must never register the existing number");
            return Response.json({success:true});
        }});
    return {requests,writes,begin:loaded.beginMetaEmbeddedSignup as (p:Row)=>Promise<{state:string}>,complete:loaded.completeMetaEmbeddedSignup as(p:Row)=>Promise<Row>};
}

test("tenant coexistence resolves WABA-only signup, skips PIN/register and requests authorized sync once",async()=>{
    const h=signupHarness();const begin=await h.begin({tenantId:"tenant",userId:"user",mode:"coexistence"});
    const result=await h.complete({tenantId:"tenant",userId:"user",state:begin.state,code:"code",wabaId:"waba",phoneNumberId:""});
    assert.equal(result.isCoexistence,true);assert.equal(result.syncWarning,null);
    assert.equal(h.requests.filter(r=>r.url.endsWith("/smb_app_data")).length,2);
    assert.ok(h.writes.some(w=>w.historyRequestId==="request-history"));
    await assert.rejects(h.complete({tenantId:"tenant",userId:"user",state:begin.state,code:"code",wabaId:"waba"}),/usado/);
});

test("ambiguous or unconfirmed coexistence never registers a phone or mutates the connection",async()=>{
    for(const options of [{multiple:true},{unconfirmed:true}]){
        const h=signupHarness(options);const begin=await h.begin({tenantId:"tenant",userId:"user",mode:"coexistence"});
        await assert.rejects(h.complete({tenantId:"tenant",userId:"user",state:begin.state,code:"code",wabaId:"waba"}),/varios|confirmó/);
        assert.equal(h.writes.length,0);assert.ok(!h.requests.some(r=>r.url.endsWith("/register")||r.url.endsWith("/subscribed_apps")));
    }
});

test("a reconnect does not replay one-shot sync and sync failures do not falsely disconnect a working API",async()=>{
    const previous=signupHarness({priorSync:{historyState:"REQUESTED",smb_app_state_syncState:"REQUESTING"}});
    let state=await previous.begin({tenantId:"tenant",userId:"user",mode:"coexistence"});
    const result=await previous.complete({tenantId:"tenant",userId:"user",state:state.state,code:"code",wabaId:"waba"});
    assert.ok(result.syncWarning);assert.equal(previous.requests.filter(r=>r.url.endsWith("/smb_app_data")).length,0);
    const rejected=signupHarness({rejectSync:true});state=await rejected.begin({tenantId:"tenant",userId:"user",mode:"coexistence"});
    const failed=await rejected.complete({tenantId:"tenant",userId:"user",state:state.state,code:"code",wabaId:"waba"});
    assert.equal((failed.channel as Row).status,"CONNECTED");assert.match(String(failed.syncWarning),/rejected/);
    assert.ok(rejected.writes.some(w=>w.historyState==="ERROR"));
});
