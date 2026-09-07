import { NextRequest, NextResponse } from "next/server";
import { getControlDb } from "@/lib/control-db";
import { PlatformAdminAccessError, requirePlatformAdmin } from "@/lib/platform-admin";
import { isSameApplicationOrigin } from "@/lib/security";
import { normalizeChatModelSelection, SUPPORTED_CHAT_MODELS } from "@/lib/ai/models";
import { PLATFORM_AI_RUNTIME_KEY } from "@/lib/ai/platform-runtime";
import { encryptChannelSecret } from "@/lib/tenant-channel-secrets";

export const runtime = "nodejs";

function integer(value: unknown, minimum: number, maximum: number) {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error("El valor numérico no es válido.");
    return parsed;
}

function cleanText(value: unknown, maximum: number, required = false) {
    const result = typeof value === "string" ? value.trim().slice(0, maximum) : "";
    if (required && !result) throw new Error("Completa los campos requeridos.");
    return result;
}

function responseForError(error: unknown) {
    if (error instanceof PlatformAdminAccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    const message = error instanceof Error ? error.message : "No fue posible guardar el cambio.";
    return NextResponse.json({ error: message }, { status: 400 });
}

export async function PATCH(request: NextRequest) {
    if (!isSameApplicationOrigin(request)) return NextResponse.json({ error: "Origen no permitido." }, { status: 403 });
    try {
        const admin = await requirePlatformAdmin();
        const body = await request.json() as Record<string, unknown>;
        const action = cleanText(body.action, 60, true);
        const db = getControlDb();

        if (action === "ai-runtime") {
            const requestedModel = cleanText(body.chatModel, 120, true);
            const chatModel = normalizeChatModelSelection(requestedModel);
            if (!SUPPORTED_CHAT_MODELS.some((model) => model.id === requestedModel) || chatModel !== requestedModel) {
                throw new Error("El modelo seleccionado no está permitido.");
            }
            await db.$transaction(async (tx) => {
                await tx.platformRuntimeSetting.upsert({
                    where: { key: PLATFORM_AI_RUNTIME_KEY },
                    create: { key: PLATFORM_AI_RUNTIME_KEY, value: { chatModel } },
                    update: { value: { chatModel } },
                });
                await tx.auditLog.create({
                    data: {
                        actorUserId: admin.id,
                        action: "ai_runtime.updated",
                        resourceType: "PlatformRuntimeSetting",
                        resourceId: PLATFORM_AI_RUNTIME_KEY,
                        metadata: { chatModel },
                    },
                });
            });
            return NextResponse.json({ saved: true });
        }

        if (action === "qr-proxy") {
            const tenantId = cleanText(body.tenantId, 100, true);
            const enabled = body.enabled === true;
            const clear = body.clear === true;
            const proxyUrl = cleanText(body.proxyUrl, 2_048);
            if (proxyUrl) {
                let parsed: URL;
                try { parsed = new URL(proxyUrl); }
                catch { throw new Error("La dirección del proxy no es válida."); }
                if (!["http:", "https:", "socks5:"].includes(parsed.protocol) || !parsed.hostname || !parsed.port) {
                    throw new Error("El proxy debe incluir protocolo, host y puerto.");
                }
            }
            const current = await db.tenantQrChannelConfiguration.findUnique({ where: { tenantId } });
            if (enabled && !proxyUrl && (clear || !current?.proxyUrlCiphertext)) throw new Error("Captura la dirección del proxy antes de activarlo.");
            const encrypted = proxyUrl ? encryptChannelSecret(proxyUrl) : null;
            await db.$transaction(async (tx) => {
                await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { id: true } });
                await tx.tenantQrChannelConfiguration.upsert({
                    where: { tenantId },
                    create: {
                        tenantId,
                        proxyEnabled: enabled,
                        proxyUrlCiphertext: encrypted?.ciphertext || null,
                        proxyUrlKeyVersion: encrypted?.keyVersion || null,
                    },
                    update: {
                        proxyEnabled: enabled,
                        ...(encrypted ? { proxyUrlCiphertext: encrypted.ciphertext, proxyUrlKeyVersion: encrypted.keyVersion } : clear ? { proxyUrlCiphertext: null, proxyUrlKeyVersion: null } : {}),
                    },
                });
                await tx.auditLog.create({ data: { tenantId, actorUserId: admin.id, action: "qr_proxy.updated", resourceType: "TenantQrChannelConfiguration", resourceId: tenantId, metadata: { enabled, configured: Boolean(encrypted || (!clear && current?.proxyUrlCiphertext)) } } });
            });
            return NextResponse.json({ saved: true });
        }

        if (action === "policy") {
            const trialDays = integer(body.trialDays, 1, 60);
            const warningHours = integer(body.warningHours, 24, 168);
            const finalWarningHours = integer(body.finalWarningHours, 1, 48);
            const graceDays = integer(body.graceDays, 0, 30);
            if (finalWarningHours >= warningHours) throw new Error("El aviso final debe ocurrir después del primer aviso.");
            await db.$transaction(async (tx) => {
                const current = await tx.trialPolicy.findFirst({ where: { isDefault: true, isActive: true }, orderBy: { version: "desc" } });
                await tx.trialPolicy.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
                const policy = await tx.trialPolicy.create({
                    data: {
                        slug: `default-v${(current?.version || 0) + 1}-${Date.now()}`,
                        name: `Prueba estándar de ${trialDays} días`,
                        version: (current?.version || 0) + 1,
                        trialDays,
                        warningHours,
                        finalWarningHours,
                        graceDays,
                        paymentCollectionMode: "OPTIONAL_AFTER_ONBOARDING",
                        isDefault: true,
                    },
                });
                await tx.auditLog.create({ data: { actorUserId: admin.id, action: "trial_policy.created", resourceType: "TrialPolicy", resourceId: policy.id, metadata: { trialDays, warningHours, finalWarningHours, graceDays } } });
            });
            return NextResponse.json({ saved: true });
        }

        if (action === "plan") {
            const planId = cleanText(body.planId, 100, true);
            const monthlyAmountCents = integer(body.monthlyAmountCents, 0, 100_000_000);
            const stripePriceId = cleanText(body.stripePriceId, 200);
            await db.$transaction(async (tx) => {
                const plan = await tx.plan.update({ where: { id: planId }, data: { monthlyAmountCents, stripeMonthlyPriceId: stripePriceId || null } });
                const existingPrice = await tx.billingPrice.findFirst({ where: { planId, provider: "STRIPE", interval: "MONTHLY", countryCode: null }, select: { id: true } });
                if (stripePriceId) {
                    if (existingPrice) await tx.billingPrice.update({ where: { id: existingPrice.id }, data: { externalPriceId: stripePriceId, currency: plan.currency, isActive: true } });
                    else await tx.billingPrice.create({ data: { planId, provider: "STRIPE", interval: "MONTHLY", externalPriceId: stripePriceId, currency: plan.currency } });
                } else if (existingPrice) {
                    await tx.billingPrice.update({ where: { id: existingPrice.id }, data: { isActive: false } });
                }
                await tx.auditLog.create({ data: { actorUserId: admin.id, action: "billing_plan.updated", resourceType: "Plan", resourceId: planId, metadata: { monthlyAmountCents, stripePriceConfigured: Boolean(stripePriceId) } } });
            });
            return NextResponse.json({ saved: true });
        }

        if (action === "extend-trial") {
            const tenantId = cleanText(body.tenantId, 100, true);
            const days = integer(body.days, 1, 30);
            const reason = cleanText(body.reason, 300, true);
            await db.$transaction(async (tx) => {
                const trial = await tx.trial.findUnique({ where: { tenantId }, select: { id: true, endsAt: true } });
                if (!trial) throw new Error("Este negocio no tiene una prueba que pueda extenderse.");
                const base = trial.endsAt > new Date() ? trial.endsAt : new Date();
                const endsAt = new Date(base.getTime() + days * 24 * 60 * 60 * 1_000);
                await tx.trial.update({ where: { id: trial.id }, data: { endsAt, status: "ACTIVE", expiredAt: null, warningSentAt: null, finalWarningAt: null } });
                await tx.tenant.update({ where: { id: tenantId }, data: { billingStatus: "TRIALING", accessMode: "FULL" } });
                await tx.trialRedemption.updateMany({ where: { tenantReference: tenantId }, data: { overrideCount: { increment: 1 } } });
                await tx.auditLog.create({ data: { tenantId, actorUserId: admin.id, action: "trial.extended", resourceType: "Trial", resourceId: trial.id, metadata: { days, reason, endsAt: endsAt.toISOString() } } });
            });
            return NextResponse.json({ saved: true });
        }

        if (action === "retry-selection") {
            const tenantId = cleanText(body.tenantId, 100, true);
            const reason = cleanText(body.reason, 300, true);
            await db.$transaction(async (tx) => {
                const selection = await tx.billingSelection.findUnique({ where: { tenantId } });
                if (!selection || selection.status !== "FAILED") throw new Error("No existe una activación fallida para reintentar.");
                await tx.billingSelection.update({ where: { id: selection.id }, data: { status: "SCHEDULED", scheduledFor: new Date(), lastError: null } });
                await tx.auditLog.create({ data: { tenantId, actorUserId: admin.id, action: "billing_selection.retried", resourceType: "BillingSelection", resourceId: selection.id, metadata: { reason } } });
            });
            return NextResponse.json({ saved: true });
        }

        return NextResponse.json({ error: "Acción no reconocida." }, { status: 400 });
    } catch (error) {
        return responseForError(error);
    }
}
