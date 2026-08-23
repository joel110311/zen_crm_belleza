import { prisma } from "@/lib/db";
import type { SystemSettings } from "@prisma/client";
import { DEFAULT_CHAT_MODEL_ID } from "@/lib/ai/models";
import {
    DEFAULT_BUSINESS_HOURS_END,
    DEFAULT_BUSINESS_HOURS_START,
    DEFAULT_BUSINESS_TIME_ZONE,
    buildUniformBusinessWeeklySchedule,
} from "@/lib/calendar/business-hours";
import { getOperationCountry } from "@/lib/operation-context";
import { DEFAULT_BRAND_NAME } from "@/lib/branding";
import { DEFAULT_BEAUTY_AGENT_PROMPT } from "@/lib/ai/default-agent-prompt";
import { EMPTY_BUSINESS_POLICIES } from "@/lib/ai/business-policies";

const DEFAULT_COUNTRY = getOperationCountry("MX");

export const SYSTEM_SETTINGS_DEFAULTS = {
    openaiModel: DEFAULT_CHAT_MODEL_ID,
    whatsappBaseUrl: process.env.WHATSAPP_GATEWAY_URL || "",
    whatsappAdminToken: process.env.WUZAPI_ADMIN_TOKEN || "",
    whatsappUserToken: process.env.WUZAPI_USER_TOKEN || "",
    whatsappInstanceName: process.env.WHATSAPP_INSTANCE_NAME || "zen-crm",
    whatsappMetaAppId: process.env.META_APP_ID || "",
    whatsappMetaAppSecret: process.env.META_APP_SECRET || "",
    whatsappEmbeddedSignupConfigId: process.env.META_EMBEDDED_SIGNUP_CONFIG_ID || "",
    whatsappTechProviderSolutionId: process.env.META_TECH_PROVIDER_SOLUTION_ID || "",
    whatsappGraphApiVersion: process.env.META_GRAPH_API_VERSION || "v26.0",
    whatsappRegistrationPin: process.env.META_WHATSAPP_REGISTRATION_PIN || "",
    whatsappWebhookVerifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN || "",
    whatsappWebhookBaseUrl: process.env.META_WEBHOOK_BASE_URL || process.env.APP_BASE_URL || process.env.AUTH_URL || "",
    whatsappProxyEnabled: process.env.WHATSAPP_PROXY_ENABLED === "true",
    whatsappProxyUrl: process.env.WHATSAPP_PROXY_URL || "",
    agentName: "Asistente Zen",
    agentPrompt: DEFAULT_BEAUTY_AGENT_PROMPT,
    welcomeMessage: `👋 ¡Hola! Gracias por contactarnos.\n\n¿En qué te podemos ayudar hoy?`,
    welcomeRepeatHours: 24,
    agentTemperature: 0.3,
    knowledgeTopK: 6,
    autoReplyDelayMs: 4000,
    botReplyDelayMinMs: 4000,
    botReplyDelayMaxMs: 8000,
    isBotEnabled: false,
    operationCountry: DEFAULT_COUNTRY.code,
    phoneDefaultCountry: DEFAULT_COUNTRY.code,
    businessHoursStart: DEFAULT_BUSINESS_HOURS_START,
    businessHoursEnd: DEFAULT_BUSINESS_HOURS_END,
    businessTimeZone: DEFAULT_COUNTRY.timeZone || DEFAULT_BUSINESS_TIME_ZONE,
    businessWeeklySchedule: buildUniformBusinessWeeklySchedule(
        DEFAULT_BUSINESS_HOURS_START,
        DEFAULT_BUSINESS_HOURS_END,
        true,
    ),
    businessPolicies: EMPTY_BUSINESS_POLICIES,
    brandName: DEFAULT_BRAND_NAME,
    brandLogoUrl: "",
    brandFaviconUrl: "",
    clinicName: "Zen CRM Belleza",
    clinicSubtitle: "Servicios de belleza",
    clinicAddress: "Direccion del negocio",
    clinicLogoUrl: "",
    clinicLogoScale: 100,
    doctorName: "Joel Venegas",
    doctorTitle: "Profesional de belleza",
    doctorProfessionalLicense: "",
    googleCalendarId: "primary",
    portalEnabled: true,
    portalSlug: "belleza",
    portalClinicName: "Zen CRM Belleza",
    portalIntro: "Aparta el horario para tu proximo servicio.",
    portalPrimaryColor: "#4B5F25",
    portalPaymentInstructions: "Puedes pagar en recepcion o solicitar una liga de pago antes de tu cita.",
    paymentDefaultCurrency: DEFAULT_COUNTRY.defaultCurrency,
    paymentEnabledCurrencies: DEFAULT_COUNTRY.currencies,
    posTaxEnabled: false,
    posTaxRate: 16,
    posTicketEnabled: true,
    posTicketShowUnitPrice: true,
    posTicketFullDescription: false,
    posTicketHeader: "Zen CRM Belleza\nServicios de belleza\nDireccion del negocio",
    posTicketFooter: "Gracias por su compra\nRegrese pronto",
    mercadoPagoAccessToken: "",
    googleMeetEnabled: true,
    googleMeetDefaultVirtual: false,
    reminderWhatsAppEnabled: true,
    reminderEmailEnabled: false,
    reminderHoursBefore: 24,
    appointmentRemindersEnabled: true,
    appointmentReminderOffsets: [1440, 240],
    appointmentReminderProvider: "wuzapi",
    appointmentReminderSendOnlyConfirmed: true,
    appointmentReminderWuzapiTemplate: `Hola {{paciente}}, te recordamos tu cita en {{clinica}}.\n\nFecha y hora: {{fecha}} a las {{hora}}.\n{{especialista}}\n\nSi necesitas cambiar tu cita, responde a este WhatsApp.`,
    appointmentReminderMetaTemplate24h: "",
    appointmentReminderMetaTemplate4h: "",
    appointmentReminderMetaLanguage: "es",
    confirmationLinkEnabled: true,
    waitingRoomEnabled: true,
    leadScoringEnabled: true,
    captureLeadName: false,
    captureLeadEmail: false,
    leadInterestThreshold: 45,
    escalationEnabled: false,
    escalationPhone: "",
    catalogOfferImages: false,
    catalogOfferPdf: false,
    catalogAskBeforeSending: false,
    catalogMaxImagesToSend: 1,
    catalogIncludeLink: false,
} as const;

export type AppSystemSettings = SystemSettings & typeof SYSTEM_SETTINGS_DEFAULTS;

export function withSettingsDefaults(
    settings: SystemSettings | null | undefined,
): AppSystemSettings {
    const sanitizedSettings = settings
        ? Object.fromEntries(
              Object.entries(settings).filter(([, value]) => value !== null && value !== undefined),
          )
        : {};

    return {
        ...(settings ?? { id: "default", updatedAt: new Date() }),
        ...SYSTEM_SETTINGS_DEFAULTS,
        ...sanitizedSettings,
    } as AppSystemSettings;
}

export async function getSystemSettingsOrDefaults(): Promise<AppSystemSettings> {
    const settings = await prisma.systemSettings.findFirst();
    return withSettingsDefaults(settings);
}
