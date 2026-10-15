import assert from "node:assert/strict";
import test from "node:test";
import { billingSubscriptionLabel } from "../src/lib/billing/presentation.ts";
test("billing presentation keeps authorization and payment states distinct", () => {
  for (const [status, label] of Object.entries({
    TRIALING: "En prueba",
    ACTIVE: "Activa",
    PAST_DUE: "Pago vencido",
    UNPAID: "Pago pendiente",
    CANCELED: "Cancelada",
    INCOMPLETE: "Activación pendiente",
    INCOMPLETE_EXPIRED: "Activación vencida",
    PAUSED: "Pausada",
  })) {
    assert.equal(billingSubscriptionLabel(status), label);
  }
  assert.equal(billingSubscriptionLabel("unknown"), "Estado por verificar");
});
