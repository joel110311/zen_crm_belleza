import assert from "node:assert/strict";
import test from "node:test";
import { findActiveCampaignChannel, loadActiveCampaignChannels } from "../src/lib/campaign-channel-availability.ts";

function dependencies() {
    return {
        tenantId: null as string | null, tenantChannelsEnabled: true,
        tenantConnections: async (id: string) => { assert.equal(typeof id, "string"); return [] as { provider: string; status: string; externalAccountId: string }[]; },
        tenantQr: async (id: string) => { assert.equal(typeof id, "string"); return { active: false, connected: false }; },
        legacyQr: async () => ({ loggedIn: false, connected: false, sourceId: "qr" }),
        legacyMeta: async () => ({ metaConnected: false, phoneNumberId: "phone-id" }),
    };
}
test("solo ofrece QR si esta conectado y autenticado; configurar credenciales no basta", async () => {
    for (const connected of [false, true]) for (const loggedIn of [false, true]) {
        const deps = dependencies(); deps.legacyQr = async () => ({ connected, loggedIn, sourceId: "qr" });
        assert.equal((await loadActiveCampaignChannels(deps)).length, connected && loggedIn ? 1 : 0);
    }
});
test("solo Meta activo se ofrece solo y no incluye el canal QR desconectado", async () => {
    const deps = dependencies(); deps.legacyMeta = async () => ({ metaConnected: true, phoneNumberId: "phone-id" });
    assert.deepEqual(await loadActiveCampaignChannels(deps), [{ sourceType: "meta", sourceId: "phone-id", label: "WhatsApp API oficial" }]);
});
test("si ambos estan activos, ofrece los dos; un error de QR no oculta Meta", async () => {
    const deps = dependencies(); deps.legacyQr = async () => ({ loggedIn: true, connected: true, sourceId: "qr" });
    deps.legacyMeta = async () => ({ metaConnected: true, phoneNumberId: "phone-id" });
    assert.deepEqual((await loadActiveCampaignChannels(deps)).map((c) => c.sourceType), ["wuzapi", "meta"]);
    deps.legacyQr = async () => { throw new Error("gateway down"); };
    assert.deepEqual((await loadActiveCampaignChannels(deps)).map((c) => c.sourceType), ["meta"]);
});
test("tenant sin conexion nunca utiliza credenciales globales ni de otro negocio", async () => {
    const deps = dependencies(); deps.tenantId = "logicapp";
    let globalCalls = 0;
    deps.legacyQr = async () => { globalCalls++; return { loggedIn: true, connected: true, sourceId: "otro-negocio" }; };
    deps.legacyMeta = async () => { globalCalls++; return { metaConnected: true, phoneNumberId: "otro-negocio" }; };
    deps.tenantConnections = async (id) => { assert.equal(id, "logicapp"); return []; };
    assert.deepEqual(await loadActiveCampaignChannels(deps), []);
    assert.equal(globalCalls, 0);
});
test("comprueba el estado real del QR de ese tenant y filtra Meta pendiente", async () => {
    const deps = dependencies(); deps.tenantId = "logicapp";
    deps.tenantConnections = async () => [
        { provider: "WUZAPI", status: "PENDING", externalAccountId: "instance" },
        { provider: "META_CLOUD", status: "PENDING", externalAccountId: "phone" },
    ];
    deps.tenantQr = async (id) => { assert.equal(id, "logicapp"); return { active: true, connected: true }; };
    assert.deepEqual(await loadActiveCampaignChannels(deps), [{ sourceType: "wuzapi", sourceId: "instance", label: "WhatsApp por QR" }]);
    deps.tenantQr = async () => ({ active: true, connected: false });
    assert.deepEqual(await loadActiveCampaignChannels(deps), []);
});
test("Meta del tenant sigue disponible ante fallo del gateway QR", async () => {
    const deps = dependencies(); deps.tenantId = "logicapp";
    deps.tenantConnections = async () => [
        { provider: "WUZAPI", status: "CONNECTED", externalAccountId: "instance" },
        { provider: "META_CLOUD", status: "CONNECTED", externalAccountId: "phone" },
    ];
    deps.tenantQr = async () => { throw new Error("gateway down"); };
    const channels = await loadActiveCampaignChannels(deps);
    assert.equal(channels.length, 1);
    assert.equal(findActiveCampaignChannel(channels, "meta", "other-phone"), undefined);
    assert.ok(findActiveCampaignChannel(channels, "meta", "phone"));
    assert.equal(findActiveCampaignChannel(channels, "wuzapi"), undefined);
});
test("canales multitenant deshabilitados fallan cerrado sin consultar el CRM historico", async () => {
    const deps = dependencies(); deps.tenantId = "logicapp"; deps.tenantChannelsEnabled = false;
    deps.tenantConnections = async () => { assert.fail("canales deshabilitados"); };
    assert.deepEqual(await loadActiveCampaignChannels(deps), []);
});
