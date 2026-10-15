import assert from "node:assert/strict";
import test from "node:test";
import {
  getWorkspaceDestinations,
  isWorkspaceDestinationActive,
} from "../src/lib/workspace-navigation.ts";

test("mobile destinations use business paths and retain the primary task order", () => {
  const items = getWorkspaceDestinations({
    subject: { role: "ADMINISTRADOR" },
    tenantSlug: "salon-a",
    canManageBilling: true,
  });
  assert.deepEqual(
    items.filter((x) => x.primary).map((x) => x.title),
    ["Hoy", "Agenda", "Chats", "Clientes"],
  );
  assert.ok(
    items
      .filter((x) => x.icon !== "billing")
      .every((x) => x.href.startsWith("/t/salon-a/")),
  );
  assert.equal(
    items.find((x) => x.icon === "billing")?.href,
    "/billing/salon-a",
  );
  assert.ok(!items.some((x) => x.icon === "control"));
});

test("billing, platform and specialist links require their explicit context", () => {
  const legacy = getWorkspaceDestinations({
    subject: { role: "ADMINISTRADOR" },
  });
  assert.ok(
    !legacy.some((x) => ["billing", "team", "control"].includes(x.icon)),
  );
  const staff = getWorkspaceDestinations({
    subject: { role: "PROFESIONAL" },
    tenantSlug: "salon-a",
  });
  assert.ok(!staff.some((x) => ["billing", "ai", "control"].includes(x.icon)));
  assert.ok(staff.some((x) => x.icon === "calendar"));
  assert.ok(
    getWorkspaceDestinations({
      subject: { role: "ADMINISTRADOR" },
      isPlatformAdmin: true,
    }).some((x) => x.icon === "control"),
  );
});

test("loading does not briefly expose modules and nested routes keep the right selection", () => {
  const loading = getWorkspaceDestinations({
    loading: true,
    tenantSlug: "salon-a",
  });
  assert.ok(!loading.some((x) => x.permission));
  const items = getWorkspaceDestinations({
    subject: { role: "ADMINISTRADOR" },
    tenantSlug: "salon-a",
  });
  const home = items.find((x) => x.icon === "home")!;
  const clients = items.find((x) => x.icon === "clients")!;
  assert.equal(
    isWorkspaceDestinationActive("/t/salon-a/contacts/customer", home),
    false,
  );
  assert.equal(
    isWorkspaceDestinationActive("/t/salon-a/contacts/customer", clients),
    true,
  );
  assert.equal(
    isWorkspaceDestinationActive("/t/salon-a/contacts-other", clients),
    false,
  );
});

test("Pipeline remains excluded from the CRM navigation", () => {
  for (const tenantSlug of [undefined, "salon-a"]) {
    const items = getWorkspaceDestinations({
      subject: { role: "ADMINISTRADOR" },
      tenantSlug,
      canManageBilling: true,
    });
    assert.ok(
      !items.some(
        (item) =>
          /pipeline/i.test(item.title) || item.href.includes("/pipeline"),
      ),
    );
  }
});
