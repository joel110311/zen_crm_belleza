import assert from "node:assert/strict";
import test from "node:test";
import * as policies from "../src/lib/ai/business-policies.ts";
import { loadTsModule } from "./helpers/load-ts-module.mts";

const { buildBeautyBusinessContext } = loadTsModule("src/lib/ai/beauty-business-context.ts", {
    "@/lib/db": { prisma: {
        service: { findMany: async () => [] },
        specialist: { findMany: async () => [] },
    } },
    "@/lib/ai/business-policies": policies,
    "@/lib/services/preparation-requirements": {
        formatServiceAftercare: () => [],
        formatServiceBookingQuestions: () => [],
        formatServicePreparation: () => [],
    },
}) as { buildBeautyBusinessContext: (settings: Record<string, unknown>) => Promise<string> };

test("missing payment policies still instruct the assistant to ask the team instead of denying deposits", async () => {
    const context = await buildBeautyBusinessContext({ clinicName: "Atelier Belleza", businessTimeZone: "America/Mexico_City" });
    assert.match(context, /Si falta información de pago verificada.*equipo debe confirmar/);
    assert.match(context, /no afirmes que no se requieren anticipos/);
    assert.match(context, /No menciones detalles internos del CRM al cliente/);
});

test("payment limitations do not become a business policy for either deposit setting", () => {
    for (const required of [false, true]) {
        const context = policies.compileBusinessPolicies({ deposits: { required } }).join("\n");
        assert.match(context, /no ejecutes cobros ni confirmes depósitos/);
        assert.match(context, /no significa que el negocio no solicite anticipos ni acepte pagos/);
        assert.doesNotMatch(context, /el CRM no procesa cobros del negocio/);
    }
});
