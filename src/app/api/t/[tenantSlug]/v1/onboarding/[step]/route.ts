import { asRecord } from "@/lib/tenant-services/validation";
import { NextResponse } from "next/server";
import { readTenantJson, runTenantMutation, withTenantApi } from "@/lib/tenant-api";
import { ONBOARDING_STEPS, serializeOnboardingState, updateOnboardingStep, type OnboardingStep } from "../../../onboarding/route";

export const runtime = "nodejs";

function isStep(value: string): value is OnboardingStep {
    return (ONBOARDING_STEPS as readonly string[]).includes(value);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ tenantSlug: string; step: string }> }) {
    const { tenantSlug, step } = await params;
    return withTenantApi(request, tenantSlug, { operation: "write", permission: "services.write" }, async (tenant) => {
        if (!isStep(step)) {
            return NextResponse.json({ error: { code: "NOT_FOUND", message: "No se encontró la etapa solicitada.", requestId: tenant.requestId } }, { status: 404, headers: { "x-request-id": tenant.requestId } });
        }
        const body = asRecord(await readTenantJson(request));
        return runTenantMutation(tenant, request, { step, ...body }, async () => ({
            state: serializeOnboardingState(await updateOnboardingStep(tenant, step, body)),
        }));
    });
}
