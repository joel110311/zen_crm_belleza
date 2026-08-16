"use server";

import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { withSettingsDefaults } from "@/lib/system-settings";
import { getSessionAccessSubject, requireAuthenticated, requirePermission } from "@/lib/authz";
import { hasPermission } from "@/lib/permissions";

export async function getSystemSettings() {
    try {
        const session = await requireAuthenticated();
        const settings = await prisma.systemSettings.findFirst();
        const resolved = withSettingsDefaults(settings);
        const subject = getSessionAccessSubject(session);
        const canManageAi = hasPermission(subject, "ai.manage");
        const canManageIntegrations = hasPermission(subject, "integrations.manage");

        return {
            ...resolved,
            openaiApiKey: canManageAi ? resolved.openaiApiKey : null,
            geminiApiKey: canManageAi ? resolved.geminiApiKey : null,
            n8nWebhookUrl: canManageAi ? resolved.n8nWebhookUrl : null,
            whatsappAccessToken: canManageIntegrations ? resolved.whatsappAccessToken : null,
            whatsappMetaAppSecret: canManageIntegrations ? resolved.whatsappMetaAppSecret : null,
            whatsappRegistrationPin: canManageIntegrations ? resolved.whatsappRegistrationPin : null,
            whatsappWebhookVerifyToken: canManageIntegrations ? resolved.whatsappWebhookVerifyToken : null,
            whatsappAdminToken: canManageIntegrations ? resolved.whatsappAdminToken : null,
            whatsappUserToken: canManageIntegrations ? resolved.whatsappUserToken : null,
            whatsappProxyUrl: canManageIntegrations ? resolved.whatsappProxyUrl : null,
            googleClientId: null,
            googleClientSecret: null,
            googleAccessToken: null,
            googleRefreshToken: null,
            googleSyncToken: null,
            mercadoPagoAccessToken: canManageIntegrations ? resolved.mercadoPagoAccessToken : null,
        };
    } catch (error) {
        console.error("Failed to fetch settings:", error);
        return withSettingsDefaults(null);
    }
}

export async function updateSystemSettings(data: {
    openaiApiKey?: string;
    openaiModel?: string;
    geminiApiKey?: string;
    whatsappBaseUrl?: string;
    whatsappAdminToken?: string;
    whatsappUserToken?: string;
    whatsappInstanceName?: string;
    whatsappProxyEnabled?: boolean;
    whatsappProxyUrl?: string;
    isBotEnabled?: boolean;
    n8nWebhookUrl?: string;
    agentName?: string;
    agentPrompt?: string;
    welcomeMessage?: string;
    welcomeRepeatHours?: number;
    agentTemperature?: number;
    knowledgeTopK?: number;
    autoReplyDelayMs?: number;
    botReplyDelayMinMs?: number;
    botReplyDelayMaxMs?: number;
    businessHoursStart?: string;
    businessHoursEnd?: string;
    businessTimeZone?: string;
    businessWeeklySchedule?: Prisma.InputJsonValue;
    appointmentDurationMinutes?: number;
    brandName?: string;
    brandLogoUrl?: string;
    brandFaviconUrl?: string;
    googleCalendarId?: string;
    leadScoringEnabled?: boolean;
    captureLeadName?: boolean;
    captureLeadEmail?: boolean;
    leadInterestThreshold?: number;
    escalationEnabled?: boolean;
    escalationPhone?: string;
    catalogOfferImages?: boolean;
    catalogOfferPdf?: boolean;
    catalogAskBeforeSending?: boolean;
    catalogMaxImagesToSend?: number;
    catalogIncludeLink?: boolean;
}) {
    try {
        await requirePermission("ai.manage");

        const first = await prisma.systemSettings.findFirst();

        if (first) {
            await prisma.systemSettings.update({
                where: { id: first.id },
                data,
            });
        } else {
            await prisma.systemSettings.create({
                data,
            });
        }

        revalidatePath("/dashboard/settings");
        revalidatePath("/dashboard/brain");
        revalidatePath("/dashboard/calendar");
        return { success: true };
    } catch (error) {
        console.error("Failed to update settings:", error);
        const prismaLikeError = error as { code?: string; meta?: unknown };
        if (prismaLikeError.code) console.error("Prisma Error Code:", prismaLikeError.code);
        if (prismaLikeError.meta) console.error("Prisma Error Meta:", prismaLikeError.meta);

        return { success: false, error: "Failed to update settings" };
    }
}
