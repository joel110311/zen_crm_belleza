import assert from "node:assert/strict";
import test from "node:test";
import { paidPeriodStart } from "../src/lib/billing/paid-period.ts";

test("switching to Mercado Pago preserves the remainder of the previous paid period", () => {
    const paidAt = new Date("2026-10-06T12:00:00Z");
    const previousProviderEndsAt = new Date("2026-10-10T12:00:00Z");
    assert.equal(paidPeriodStart(paidAt, [null, previousProviderEndsAt]).toISOString(), previousProviderEndsAt.toISOString());
});

test("the latest trial or paid end wins and expired periods do not postpone the month", () => {
    const paidAt = new Date("2026-10-06T12:00:00Z");
    assert.equal(paidPeriodStart(paidAt, [new Date("2026-09-10T12:00:00Z"), undefined]).toISOString(), paidAt.toISOString());
    assert.equal(paidPeriodStart(paidAt, [new Date("2026-10-13T12:00:00Z"), new Date("2026-11-13T12:00:00Z")]).toISOString(), "2026-11-13T12:00:00.000Z");
});
