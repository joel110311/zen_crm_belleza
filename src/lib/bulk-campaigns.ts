import crypto from "crypto";
import { Prisma, type BulkCampaign, type BulkCampaignVariant, type Contact } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
    businessBoundsForDate,
    getNextOpenDate,
    normalizeBusinessHours,
} from "@/lib/calendar/business-hours";
import {
    type OutboundMessageType,
    sendOutboundConversationMessage,
} from "@/lib/outbound-messages";
import { sendMetaTemplateMessage } from "@/lib/meta-whatsapp";
import { findOrCreateActiveConversationForContactSource } from "@/lib/source-conversations";
import {
    MESSAGE_SOURCE_META,
    MESSAGE_SOURCE_WUZAPI,
    normalizeMessageSourceType,
    resolveMessageSourceId,
    type MessageSourceType,
} from "@/lib/message-source";
import { getSystemSettingsOrDefaults } from "@/lib/system-settings";
import { listTemplateVariableKeys, renderTemplateContent } from "@/lib/templates";
import {
    MAX_BULK_CAMPAIGN_AUDIENCE_LIMIT,
    type BulkCampaignAudienceFilters,
    type BulkCampaignAudienceMode,
    type BulkCampaignManualEntry,
    normalizeBulkCampaignAudienceFilters,
} from "@/lib/bulk-campaign-audience";
import {
    classifyBulkCampaignReplyIntent,
    isExplicitBulkStopCommand,
    type BulkCampaignReplyIntent,
} from "@/lib/bulk-campaign-replies";
import { buildPhoneMatchClauses, normalizePhoneDigits } from "@/lib/phone";

const DEFAULT_VARIANT_LABELS = ["A", "B", "C", "D", "E"];
const WORKER_LOCK_TTL_MS = 60_000;
type BulkCampaignMessageType = OutboundMessageType | "template";
const ALLOWED_CAMPAIGN_TYPES = new Set<BulkCampaignMessageType>(["text", "image", "document", "template"]);
const YCLOUD_OPEN_WINDOW_GRACE_MS = 60_000;
const YCLOUD_TEMPLATE_WINDOW_MS = 24 * 60 * 60 * 1000;

export type BulkCampaignVariantInput = {
    label: string;
    content: string;
    weight: number;
    sortOrder: number;
    isActive: boolean;
};

export type BulkCampaignUpsertInput = {
    name: string;
    description: string;
    sourceType: MessageSourceType;
    sourceId: string | null;
    type: BulkCampaignMessageType;
    mediaUrl: string | null;
    mediaType: string | null;
    mediaFileName: string | null;
    ycloudTemplateName: string | null;
    ycloudTemplateLanguage: string | null;
    ycloudTemplateComponents: Prisma.InputJsonValue | null;
    ycloudTemplateVariableValues: Record<string, string>;
    batchSize: number;
    batchDelayMinutes: number;
    randomDelayMinSeconds: number;
    randomDelayMaxSeconds: number;
    scheduledStartAt: Date | null;
    respectBusinessHours: boolean;
    stopOnReply: boolean;
    followUpCount: number;
    followUpDelayDays: number;
    audienceFilters: BulkCampaignAudienceFilters;
    variants: BulkCampaignVariantInput[];
};

export type BulkCampaignRecord = BulkCampaign & {
    variants: BulkCampaignVariant[];
};

export type BulkCampaignReplyHandlingResult = {
    intent: BulkCampaignReplyIntent;
    stoppedCampaignIds: string[];
    activatedBot: boolean;
    optedOut: boolean;
};

function clampInteger(value: unknown, fallback: number, min: number, max: number) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
}

function normalizeOptionalDate(value: unknown) {
    if (typeof value !== "string" || !value.trim()) {
        return null;
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeCampaignType(value: unknown): BulkCampaignMessageType {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "text";
    if (ALLOWED_CAMPAIGN_TYPES.has(normalized as BulkCampaignMessageType)) {
        return normalized as BulkCampaignMessageType;
    }
    return "text";
}

function normalizeCampaignSourceType(value: unknown): MessageSourceType {
    return normalizeMessageSourceType(typeof value === "string" ? value : MESSAGE_SOURCE_WUZAPI);
}

function normalizeCampaignSourceId(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeAudienceWindowDate(value: string) {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeTemplateComponents(value: unknown): Prisma.InputJsonValue | null {
    return Array.isArray(value) ? value as Prisma.InputJsonValue : null;
}

function normalizeTemplateVariableValues(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
            .map(([key, entry]) => [key.trim(), typeof entry === "string" ? entry : ""])
            .filter(([key]) => Boolean(key)),
    );
}

type YCloudTemplateComponentRecord = {
    type?: unknown;
    text?: unknown;
};

type YCloudTemplateSendComponents = NonNullable<Parameters<typeof sendMetaTemplateMessage>[0]["components"]>;

function getYCloudTemplateComponents(value: unknown): YCloudTemplateComponentRecord[] {
    return Array.isArray(value)
        ? value.filter((entry): entry is YCloudTemplateComponentRecord => Boolean(entry) && typeof entry === "object")
        : [];
}

function extractYCloudNumericVariables(text: string) {
    const keys: string[] = [];
    const matches = text.matchAll(/{{\s*(\d+)\s*}}/g);

    for (const match of matches) {
        const key = match[1];
        if (key && !keys.includes(key)) {
            keys.push(key);
        }
    }

    return keys;
}

function getYCloudTemplateVariableKey(componentType: string, variableIndex: string) {
    return `${componentType.toUpperCase()}:${variableIndex}`;
}

function listYCloudTemplateRequiredVariableKeys(components: unknown) {
    return getYCloudTemplateComponents(components)
        .flatMap((component) => {
            const componentType = typeof component.type === "string" ? component.type.toUpperCase() : "";
            const text = typeof component.text === "string" ? component.text : "";

            if (!["HEADER", "BODY"].includes(componentType) || !text) {
                return [];
            }

            return extractYCloudNumericVariables(text).map((variableIndex) =>
                getYCloudTemplateVariableKey(componentType, variableIndex),
            );
        })
        .filter((key, index, array) => array.indexOf(key) === index);
}

function normalizeYCloudTemplateVariableMap(value: Prisma.JsonValue | null | undefined) {
    return normalizeTemplateVariableValues(value);
}

function buildBulkCampaignRenderContext(
    contact: Pick<Contact, "name" | "company" | "phone">,
    agentName: string | null | undefined,
) {
    return {
        contact: {
            name: contact.name,
            company: contact.company,
            phone: contact.phone,
        },
        agentName,
    };
}

function resolveYCloudTemplateParameterText(params: {
    componentType: string;
    variableIndex: string;
    variableValues: Record<string, string>;
    contact: Pick<Contact, "name" | "company" | "phone">;
    agentName: string | null | undefined;
}) {
    const directKey = getYCloudTemplateVariableKey(params.componentType, params.variableIndex);
    const rawValue =
        params.variableValues[directKey] ??
        params.variableValues[params.variableIndex] ??
        params.variableValues[`{{${params.variableIndex}}}`] ??
        "";

    const rendered = renderTemplateContent(
        rawValue,
        buildBulkCampaignRenderContext(params.contact, params.agentName),
    ).trim();

    return rendered || "-";
}

function buildYCloudTemplateComponentsForCampaign(params: {
    components: Prisma.JsonValue | null | undefined;
    variableValues: Prisma.JsonValue | null | undefined;
    contact: Pick<Contact, "name" | "company" | "phone">;
    agentName: string | null | undefined;
}): YCloudTemplateSendComponents {
    const variableValues = normalizeYCloudTemplateVariableMap(params.variableValues);
    const apiComponents: YCloudTemplateSendComponents = [];

    for (const component of getYCloudTemplateComponents(params.components)) {
        const componentType = typeof component.type === "string" ? component.type.toUpperCase() : "";
        const text = typeof component.text === "string" ? component.text : "";

        if (!["HEADER", "BODY"].includes(componentType) || !text) {
            continue;
        }

        const variableIndexes = extractYCloudNumericVariables(text);
        if (variableIndexes.length === 0) {
            continue;
        }

        apiComponents.push({
            type: componentType as "HEADER" | "BODY",
            parameters: variableIndexes.map((variableIndex) => ({
                type: "text" as const,
                text: resolveYCloudTemplateParameterText({
                    componentType,
                    variableIndex,
                    variableValues,
                    contact: params.contact,
                    agentName: params.agentName,
                }),
            })),
        });
    }

    return apiComponents;
}

function renderYCloudTemplatePreviewContent(params: {
    templateName: string;
    components: Prisma.JsonValue | null | undefined;
    variableValues: Prisma.JsonValue | null | undefined;
    contact: Pick<Contact, "name" | "company" | "phone">;
    agentName: string | null | undefined;
}) {
    const variableValues = normalizeYCloudTemplateVariableMap(params.variableValues);
    const body = getYCloudTemplateComponents(params.components)
        .find((component) => typeof component.type === "string" && component.type.toUpperCase() === "BODY");
    const bodyText = typeof body?.text === "string" ? body.text : "";

    const renderedBody = bodyText.replace(/{{\s*(\d+)\s*}}/g, (_match, variableIndex: string) =>
        resolveYCloudTemplateParameterText({
            componentType: "BODY",
            variableIndex,
            variableValues,
            contact: params.contact,
            agentName: params.agentName,
        }),
    ).trim();

    return renderedBody || `[Plantilla: ${params.templateName}]`;
}

function buildDefaultVariant(index = 0): BulkCampaignVariantInput {
    return {
        label: DEFAULT_VARIANT_LABELS[index] || `Variante ${index + 1}`,
        content: "",
        weight: 1,
        sortOrder: index,
        isActive: true,
    };
}

export function normalizeBulkCampaignVariants(
    value: unknown,
    type: BulkCampaignMessageType,
): BulkCampaignVariantInput[] {
    if (!Array.isArray(value) || value.length === 0) {
        return [buildDefaultVariant()];
    }

    const normalized = value
        .map((entry, index) => {
            const record = typeof entry === "object" && entry !== null
                ? (entry as Record<string, unknown>)
                : {};
            const label = typeof record.label === "string" && record.label.trim()
                ? record.label.trim()
                : DEFAULT_VARIANT_LABELS[index] || `Variante ${index + 1}`;
            const content = typeof record.content === "string" ? record.content : "";

            return {
                label,
                content,
                weight: clampInteger(record.weight, 1, 1, 20),
                sortOrder: index,
                isActive: record.isActive !== false,
            } satisfies BulkCampaignVariantInput;
        })
        .filter((variant) => variant.isActive || variant.content.trim() || type !== "text");

    return normalized.length > 0 ? normalized : [buildDefaultVariant()];
}

export function normalizeBulkCampaignPayload(value: unknown): BulkCampaignUpsertInput {
    const record = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
    const type = normalizeCampaignType(record.type);
    const sourceType = normalizeCampaignSourceType(record.sourceType);
    const sourceId = normalizeCampaignSourceId(record.sourceId);
    const isYCloudTemplate = sourceType === MESSAGE_SOURCE_META && type === "template";
    const audienceFilters = normalizeBulkCampaignAudienceFilters(
        record.audienceFilters,
        MAX_BULK_CAMPAIGN_AUDIENCE_LIMIT,
    );
    const ycloudTemplateName = typeof record.ycloudTemplateName === "string" && record.ycloudTemplateName.trim()
        ? record.ycloudTemplateName.trim()
        : null;
    const ycloudTemplateLanguage = typeof record.ycloudTemplateLanguage === "string" && record.ycloudTemplateLanguage.trim()
        ? record.ycloudTemplateLanguage.trim()
        : null;

    const normalizedAudienceFilters = {
        ...audienceFilters,
        sourceType: sourceType === MESSAGE_SOURCE_META && !isYCloudTemplate ? MESSAGE_SOURCE_META : audienceFilters.sourceType,
        sourceId: sourceType === MESSAGE_SOURCE_META && !isYCloudTemplate
            ? (sourceId || audienceFilters.sourceId) || ""
            : audienceFilters.sourceId,
        onlyOpenYCloudWindow: sourceType === MESSAGE_SOURCE_META && !isYCloudTemplate
            ? true
            : audienceFilters.onlyOpenYCloudWindow,
    };

    return {
        name: typeof record.name === "string" ? record.name.trim() : "",
        description: typeof record.description === "string" ? record.description.trim() : "",
        sourceType,
        sourceId,
        type,
        mediaUrl: type === "template"
            ? null
            : typeof record.mediaUrl === "string" && record.mediaUrl.trim()
                ? record.mediaUrl.trim()
                : null,
        mediaType: type === "template"
            ? null
            : typeof record.mediaType === "string" && record.mediaType.trim()
                ? record.mediaType.trim()
                : null,
        mediaFileName: type === "template"
            ? null
            : typeof record.mediaFileName === "string" && record.mediaFileName.trim()
                ? record.mediaFileName.trim()
                : null,
        ycloudTemplateName: type === "template" ? ycloudTemplateName : null,
        ycloudTemplateLanguage: type === "template" ? ycloudTemplateLanguage : null,
        ycloudTemplateComponents: type === "template" ? normalizeTemplateComponents(record.ycloudTemplateComponents) : null,
        ycloudTemplateVariableValues: type === "template" ? normalizeTemplateVariableValues(record.ycloudTemplateVariableValues) : {},
        batchSize: clampInteger(record.batchSize, 3, 1, 100),
        batchDelayMinutes: clampInteger(record.batchDelayMinutes, 5, 0, 24 * 60),
        randomDelayMinSeconds: clampInteger(record.randomDelayMinSeconds, 25, 5, 30 * 60),
        randomDelayMaxSeconds: clampInteger(record.randomDelayMaxSeconds, 75, 5, 30 * 60),
        scheduledStartAt: normalizeOptionalDate(record.scheduledStartAt),
        respectBusinessHours: record.respectBusinessHours !== false,
        stopOnReply: record.stopOnReply !== false,
        followUpCount: type === "template" ? 0 : clampInteger(record.followUpCount, 0, 0, 12),
        followUpDelayDays: clampInteger(record.followUpDelayDays, 2, 1, 30),
        audienceFilters: normalizedAudienceFilters,
        variants: normalizeBulkCampaignVariants(record.variants, type),
    };
}

function ensureCampaignDraftIsValid(input: BulkCampaignUpsertInput) {
    if (!input.name) {
        throw new Error("El nombre de la campaña es obligatorio");
    }

    if (input.type !== "text" && input.type !== "template" && !input.mediaUrl) {
        throw new Error("La campaña requiere un archivo adjunto");
    }

    if (input.type === "template") {
        if (input.sourceType !== MESSAGE_SOURCE_META) {
            throw new Error("Las plantillas Meta solo se pueden enviar por WhatsApp API");
        }

        if (!input.ycloudTemplateName || !input.ycloudTemplateLanguage) {
            throw new Error("Selecciona una plantilla de WhatsApp API aprobada antes de guardar");
        }

        const missingVariables = listYCloudTemplateRequiredVariableKeys(input.ycloudTemplateComponents)
            .filter((key) => !input.ycloudTemplateVariableValues[key]?.trim());

        if (missingVariables.length > 0) {
            throw new Error("Completa las variables de la plantilla antes de guardar");
        }
    }

    if (input.randomDelayMaxSeconds < input.randomDelayMinSeconds) {
        throw new Error("El delay máximo debe ser mayor o igual al mínimo");
    }
}

function ensureCampaignCanLaunch(campaign: BulkCampaignRecord) {
    if (!campaign.name.trim()) {
        throw new Error("La campaña no tiene nombre");
    }

    if (campaign.type !== "text" && campaign.type !== "template" && !campaign.mediaUrl) {
        throw new Error("La campaña necesita un adjunto antes de iniciarse");
    }

    if (campaign.type === "template") {
        if (campaign.sourceType !== MESSAGE_SOURCE_META) {
            throw new Error("Las plantillas Meta solo se pueden enviar por WhatsApp API");
        }

        if (!campaign.ycloudTemplateName || !campaign.ycloudTemplateLanguage) {
            throw new Error("Selecciona una plantilla de WhatsApp API aprobada antes de iniciar");
        }
    }

    const activeVariants = campaign.variants.filter((variant) => variant.isActive);
    if (activeVariants.length === 0) {
        throw new Error("Agrega al menos una variante activa");
    }

    if (campaign.type === "text" && !activeVariants.some((variant) => variant.content.trim())) {
        throw new Error("Agrega contenido a por lo menos una variante antes de iniciar");
    }
}

function needsYCloudAudienceConstraint(filters: BulkCampaignAudienceFilters) {
    return (
        filters.sourceType === MESSAGE_SOURCE_META ||
        filters.onlyOpenYCloudWindow ||
        Boolean(filters.lastInboundFrom || filters.lastInboundTo)
    );
}

async function loadEligibleYCloudContactIds(filters: BulkCampaignAudienceFilters) {
    if (!needsYCloudAudienceConstraint(filters)) {
        return null;
    }

    const createdAt: Prisma.DateTimeFilter = {};
    const from = normalizeAudienceWindowDate(filters.lastInboundFrom);
    const to = normalizeAudienceWindowDate(filters.lastInboundTo);
    if (from) createdAt.gte = from;
    if (to) createdAt.lte = to;

    const conversations = await prisma.conversation.findMany({
        where: {
            sourceType: MESSAGE_SOURCE_META,
            ...(filters.sourceId ? { sourceId: filters.sourceId } : {}),
            ...(filters.onlyOpenYCloudWindow
                ? {
                    sessionExpiresAt: {
                        gt: new Date(Date.now() + YCLOUD_OPEN_WINDOW_GRACE_MS),
                    },
                }
                : {}),
            ...(from || to
                ? {
                    messages: {
                        some: {
                            direction: "inbound",
                            sourceType: MESSAGE_SOURCE_META,
                            createdAt,
                        },
                    },
                }
                : {}),
        },
        select: {
            contactId: true,
        },
    });

    return Array.from(new Set(conversations.map((conversation) => conversation.contactId)));
}

function buildAudienceWhere(
    filters: BulkCampaignAudienceFilters,
    eligibleContactIds?: string[] | null,
): Prisma.ContactWhereInput {
    const query = filters.query.trim();

    return {
        ...(eligibleContactIds ? { id: { in: eligibleContactIds } } : {}),
        phone: {
            not: "",
        },
        bulkCampaignOptOutAt: null,
        ...(filters.statuses.length > 0 ? { status: { in: filters.statuses } } : {}),
        ...(filters.tags.length > 0 ? { tags: { hasEvery: filters.tags } } : {}),
        ...(query
            ? {
                OR: [
                    { name: { contains: query, mode: "insensitive" } },
                    { lastName: { contains: query, mode: "insensitive" } },
                    { company: { contains: query, mode: "insensitive" } },
                    { email: { contains: query, mode: "insensitive" } },
                    { phone: { contains: query, mode: "insensitive" } },
                ],
            }
            : {}),
    };
}

const AUDIENCE_CONTACT_SELECT = {
    id: true,
    name: true,
    lastName: true,
    company: true,
    email: true,
    phone: true,
    status: true,
    tags: true,
    bulkCampaignOptOutAt: true,
    updatedAt: true,
    createdAt: true,
} satisfies Prisma.ContactSelect;

type AudienceContactRecord = Prisma.ContactGetPayload<{
    select: typeof AUDIENCE_CONTACT_SELECT;
}>;

export type BulkCampaignAudiencePreviewRecipient = {
    key: string;
    contactId: string | null;
    name: string;
    company: string;
    phone: string;
    status: string | null;
    source: "crm" | "manual";
    matchedBy: "filters" | "selected" | "manual";
};

export type BulkCampaignAudiencePreview = {
    candidates: AudienceContactRecord[];
    selectedContacts: AudienceContactRecord[];
    finalRecipients: BulkCampaignAudiencePreviewRecipient[];
    totals: {
        candidates: number;
        filterMatches: number;
        selectedContacts: number;
        manualRecipients: number;
        finalRecipients: number;
        crmRecipients: number;
    };
    sourceBreakdown: Array<{
        label: string;
        value: number;
    }>;
    statusBreakdown: Array<{
        status: string;
        value: number;
    }>;
    ycloudWindow: {
        enabled: boolean;
        eligibleContacts: number | null;
        onlyOpenWindow: boolean;
        lastInboundFrom: string | null;
        lastInboundTo: string | null;
    };
};

async function loadFilterAudienceContacts(
    filters: BulkCampaignAudienceFilters,
    take = filters.limit ?? MAX_BULK_CAMPAIGN_AUDIENCE_LIMIT,
    eligibleContactIds?: string[] | null,
) {
    return prisma.contact.findMany({
        where: buildAudienceWhere(filters, eligibleContactIds),
        orderBy: [
            { updatedAt: "desc" },
            { createdAt: "desc" },
        ],
        take,
        select: AUDIENCE_CONTACT_SELECT,
    });
}

async function loadSelectedAudienceContacts(
    selectedContactIds: string[],
    eligibleContactIds?: string[] | null,
) {
    if (selectedContactIds.length === 0) {
        return [] as AudienceContactRecord[];
    }

    const allowedIds = eligibleContactIds
        ? selectedContactIds.filter((id) => eligibleContactIds.includes(id))
        : selectedContactIds;

    if (allowedIds.length === 0) {
        return [] as AudienceContactRecord[];
    }

    const contacts = await prisma.contact.findMany({
        where: {
            id: {
                in: allowedIds,
            },
            phone: {
                not: "",
            },
            bulkCampaignOptOutAt: null,
        },
        select: AUDIENCE_CONTACT_SELECT,
    });

    const orderMap = new Map(allowedIds.map((id, index) => [id, index]));
    return contacts.sort((left, right) => (orderMap.get(left.id) ?? 0) - (orderMap.get(right.id) ?? 0));
}

function buildAudiencePreviewRecipientKey(recipient: {
    contactId?: string | null;
    phone?: string | null;
}) {
    const normalizedPhone = normalizePhoneDigits(recipient.phone);
    if (normalizedPhone) {
        return `phone:${normalizedPhone}`;
    }
    if (recipient.contactId) {
        return `contact:${recipient.contactId}`;
    }
    return crypto.randomUUID();
}

function buildPreviewRecipientFromContact(
    contact: AudienceContactRecord,
    matchedBy: "filters" | "selected",
): BulkCampaignAudiencePreviewRecipient {
    return {
        key: buildAudiencePreviewRecipientKey({ contactId: contact.id, phone: contact.phone }),
        contactId: contact.id,
        name: [contact.name, contact.lastName].filter(Boolean).join(" ").trim() || contact.phone || "Sin nombre",
        company: contact.company || "",
        phone: contact.phone || "",
        status: contact.status || null,
        source: "crm",
        matchedBy,
    };
}

function buildPreviewRecipientFromManualEntry(entry: BulkCampaignManualEntry): BulkCampaignAudiencePreviewRecipient {
    return {
        key: buildAudiencePreviewRecipientKey({ phone: entry.phone }),
        contactId: null,
        name: entry.name || entry.phone,
        company: entry.company || "",
        phone: entry.phone,
        status: null,
        source: "manual",
        matchedBy: "manual",
    };
}

function dedupePreviewRecipients(recipients: BulkCampaignAudiencePreviewRecipient[]) {
    const byKey = new Map<string, BulkCampaignAudiencePreviewRecipient>();

    for (const recipient of recipients) {
        const existing = byKey.get(recipient.key);
        if (!existing) {
            byKey.set(recipient.key, recipient);
            continue;
        }

        if (existing.source === "manual" && recipient.source === "crm") {
            byKey.set(recipient.key, recipient);
        }
    }

    return Array.from(byKey.values());
}

function mergeAudienceContactsByMode(
    mode: BulkCampaignAudienceMode,
    filterContacts: AudienceContactRecord[],
    selectedContacts: AudienceContactRecord[],
) {
    if (mode === "selected") {
        return selectedContacts;
    }

    if (mode === "mixed") {
        const map = new Map<string, AudienceContactRecord>();
        for (const contact of filterContacts) {
            map.set(contact.id, contact);
        }
        for (const contact of selectedContacts) {
            map.set(contact.id, contact);
        }
        return Array.from(map.values());
    }

    return filterContacts;
}

async function countAudienceContacts(filters: BulkCampaignAudienceFilters) {
    const eligibleYCloudContactIds = await loadEligibleYCloudContactIds(filters);
    const [filterMatchesCount, filterContacts, selectedContacts] = await Promise.all([
        prisma.contact.count({
            where: buildAudienceWhere(filters, eligibleYCloudContactIds),
        }),
        filters.mode === "selected"
            ? Promise.resolve([] as AudienceContactRecord[])
            : loadFilterAudienceContacts(filters, filters.limit ?? MAX_BULK_CAMPAIGN_AUDIENCE_LIMIT, eligibleYCloudContactIds),
        loadSelectedAudienceContacts(filters.selectedContactIds, eligibleYCloudContactIds),
    ]);

    const recipients = dedupePreviewRecipients([
        ...mergeAudienceContactsByMode(filters.mode, filterContacts, selectedContacts).map((contact) =>
            buildPreviewRecipientFromContact(contact, "filters"),
        ),
        ...(eligibleYCloudContactIds ? [] : filters.manualEntries.map((entry) => buildPreviewRecipientFromManualEntry(entry))),
    ]);

    return {
        totalRecipients: recipients.length,
        filterMatchesCount,
        selectedContactsCount: selectedContacts.length,
        manualRecipientsCount: recipients.filter((recipient) => recipient.source === "manual").length,
    };
}

async function findExistingContactForPhone(phone: string) {
    const phoneClauses = buildPhoneMatchClauses([phone]);
    if (phoneClauses.length === 0) return null;

    return prisma.contact.findFirst({
        where: {
            OR: phoneClauses,
        },
    });
}

async function materializeManualAudienceContacts(entries: BulkCampaignManualEntry[]) {
    const contacts: Contact[] = [];

    for (const entry of entries) {
        const normalizedPhone = normalizePhoneDigits(entry.phone);
        if (!normalizedPhone) continue;

        const existing = await findExistingContactForPhone(normalizedPhone);
        if (existing) {
            const needsUpdate = (!existing.name && entry.name) || (!existing.company && entry.company);
            const contact = needsUpdate
                ? await prisma.contact.update({
                    where: { id: existing.id },
                    data: {
                        ...(entry.name && !existing.name ? { name: entry.name } : {}),
                        ...(entry.company && !existing.company ? { company: entry.company } : {}),
                    },
                })
                : existing;
            contacts.push(contact);
            continue;
        }

        const createdContact = await prisma.contact.create({
            data: {
                phone: normalizedPhone,
                name: entry.name || null,
                company: entry.company || null,
                status: "lead",
            },
        });

        await prisma.conversation.create({
            data: {
                contactId: createdContact.id,
                status: "active",
                sourceType: "wuzapi",
                botActive: true,
            },
        });

        contacts.push(createdContact);
    }

    return contacts;
}

async function resolveBulkCampaignAudienceContacts(filters: BulkCampaignAudienceFilters) {
    const eligibleYCloudContactIds = await loadEligibleYCloudContactIds(filters);
    const [filterContacts, selectedContacts] = await Promise.all([
        filters.mode === "selected"
            ? Promise.resolve([] as AudienceContactRecord[])
            : loadFilterAudienceContacts(filters, filters.limit ?? MAX_BULK_CAMPAIGN_AUDIENCE_LIMIT, eligibleYCloudContactIds),
        loadSelectedAudienceContacts(filters.selectedContactIds, eligibleYCloudContactIds),
    ]);

    const crmContacts = mergeAudienceContactsByMode(filters.mode, filterContacts, selectedContacts);
    const manualContacts = eligibleYCloudContactIds ? [] : await materializeManualAudienceContacts(filters.manualEntries);
    const deduped = new Map<string, Contact | AudienceContactRecord>();

    for (const contact of crmContacts) {
        deduped.set(buildAudiencePreviewRecipientKey({ contactId: contact.id, phone: contact.phone }), contact);
    }

    for (const contact of manualContacts) {
        const key = buildAudiencePreviewRecipientKey({ contactId: contact.id, phone: contact.phone });
        if (!deduped.has(key)) {
            deduped.set(key, contact);
        }
    }

    return Array.from(deduped.values()).filter((contact) => !contact.bulkCampaignOptOutAt);
}

function buildRecipientQueueRows(
    campaignId: string,
    contactIds: string[],
    followUpCount: number,
    initialPlannedAt: Date,
    followUpDelayDays: number,
) {
    const rows: Array<{
        campaignId: string;
        contactId: string;
        status: "queued";
        sequenceIndex: number;
        attemptNumber: number;
        plannedAt: Date;
    }> = [];

    for (let attemptNumber = 0; attemptNumber <= followUpCount; attemptNumber += 1) {
        const plannedAt = new Date(
            initialPlannedAt.getTime() +
            (attemptNumber * Math.max(1, followUpDelayDays) * 24 * 60 * 60 * 1000),
        );

        for (let index = 0; index < contactIds.length; index += 1) {
            const contactId = contactIds[index];
            if (!contactId) continue;

            rows.push({
                campaignId,
                contactId,
                status: "queued",
                sequenceIndex: attemptNumber * contactIds.length + index,
                attemptNumber,
                plannedAt: new Date(plannedAt),
            });
        }
    }

    return rows;
}

export async function getBulkCampaignAudiencePreview(filters: BulkCampaignAudienceFilters) {
    const eligibleYCloudContactIds = await loadEligibleYCloudContactIds(filters);
    const [candidateContacts, filterContacts, selectedContacts, filterMatchesCount] = await Promise.all([
        loadFilterAudienceContacts(filters, Math.min(120, filters.limit ?? 120), eligibleYCloudContactIds),
        filters.mode === "selected"
            ? Promise.resolve([] as AudienceContactRecord[])
            : loadFilterAudienceContacts(filters, filters.limit ?? MAX_BULK_CAMPAIGN_AUDIENCE_LIMIT, eligibleYCloudContactIds),
        loadSelectedAudienceContacts(filters.selectedContactIds, eligibleYCloudContactIds),
        prisma.contact.count({
            where: buildAudienceWhere(filters, eligibleYCloudContactIds),
        }),
    ]);

    const previewRecipients = dedupePreviewRecipients([
        ...mergeAudienceContactsByMode(filters.mode, filterContacts, selectedContacts).map((contact) =>
            buildPreviewRecipientFromContact(
                contact,
                filterContacts.some((candidate) => candidate.id === contact.id) ? "filters" : "selected",
            ),
        ),
        ...(eligibleYCloudContactIds ? [] : filters.manualEntries.map((entry) => buildPreviewRecipientFromManualEntry(entry))),
    ]);

    const sourceBreakdown = [
        { label: "CRM", value: previewRecipients.filter((recipient) => recipient.source === "crm").length },
        { label: "Manuales", value: previewRecipients.filter((recipient) => recipient.source === "manual").length },
    ].filter((entry) => entry.value > 0);

    const statusMap = new Map<string, number>();
    for (const recipient of previewRecipients) {
        const key = recipient.status || "manual";
        statusMap.set(key, (statusMap.get(key) || 0) + 1);
    }

    const statusBreakdown = Array.from(statusMap.entries())
        .map(([status, value]) => ({ status, value }))
        .sort((left, right) => right.value - left.value);

    return {
        candidates: candidateContacts,
        selectedContacts,
        finalRecipients: previewRecipients.slice(0, 18),
        totals: {
            candidates: candidateContacts.length,
            filterMatches: filterMatchesCount,
            selectedContacts: selectedContacts.length,
            manualRecipients: previewRecipients.filter((recipient) => recipient.source === "manual").length,
            finalRecipients: previewRecipients.length,
            crmRecipients: previewRecipients.filter((recipient) => recipient.source === "crm").length,
        },
        sourceBreakdown,
        statusBreakdown,
        ycloudWindow: {
            enabled: Boolean(eligibleYCloudContactIds),
            eligibleContacts: eligibleYCloudContactIds ? eligibleYCloudContactIds.length : null,
            onlyOpenWindow: filters.onlyOpenYCloudWindow,
            lastInboundFrom: filters.lastInboundFrom || null,
            lastInboundTo: filters.lastInboundTo || null,
        },
    } satisfies BulkCampaignAudiencePreview;
}

export async function refreshBulkCampaignStats(campaignId: string) {
    const [campaign, distinctRecipients, sentCount, failedCount, distinctReplies, skippedCount, queuedCount] = await prisma.$transaction([
        prisma.bulkCampaign.findUnique({
            where: { id: campaignId },
            select: {
                id: true,
                status: true,
                completedAt: true,
            },
        }),
        prisma.bulkCampaignRecipient.findMany({
            where: { campaignId },
            distinct: ["contactId"],
            select: { contactId: true },
        }),
        prisma.bulkCampaignRecipient.count({ where: { campaignId, sentAt: { not: null } } }),
        prisma.bulkCampaignRecipient.count({ where: { campaignId, status: "failed" } }),
        prisma.bulkCampaignRecipient.findMany({
            where: { campaignId, repliedAt: { not: null } },
            distinct: ["contactId"],
            select: { contactId: true },
        }),
        prisma.bulkCampaignRecipient.count({
            where: {
                campaignId,
                status: {
                    in: ["skipped", "cancelled"],
                },
            },
        }),
        prisma.bulkCampaignRecipient.count({ where: { campaignId, status: "queued" } }),
    ]);

    if (!campaign) {
        return null;
    }

    const shouldMarkCompleted = campaign.status === "running" && queuedCount === 0;

    return prisma.bulkCampaign.update({
        where: { id: campaignId },
        data: {
            totalRecipients: distinctRecipients.length,
            sentCount,
            failedCount,
            repliedCount: distinctReplies.length,
            skippedCount,
            ...(shouldMarkCompleted
                ? {
                    status: "completed",
                    completedAt: campaign.completedAt || new Date(),
                    nextRunAt: null,
                }
                : {}),
        },
        include: {
            variants: {
                orderBy: { sortOrder: "asc" },
            },
        },
    });
}

export async function listBulkCampaigns() {
    return prisma.bulkCampaign.findMany({
        include: {
            variants: {
                orderBy: { sortOrder: "asc" },
            },
        },
        orderBy: [
            { updatedAt: "desc" },
            { createdAt: "desc" },
        ],
    });
}

export async function getBulkCampaignById(id: string) {
    return prisma.bulkCampaign.findUnique({
        where: { id },
        include: {
            variants: {
                orderBy: { sortOrder: "asc" },
            },
        },
    });
}

export async function createBulkCampaign(input: BulkCampaignUpsertInput, createdById?: string | null) {
    ensureCampaignDraftIsValid(input);
    const estimatedRecipients = await countAudienceContacts(input.audienceFilters);

    return prisma.bulkCampaign.create({
        data: {
            name: input.name,
            description: input.description || null,
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            type: input.type,
            mediaUrl: input.mediaUrl,
            mediaType: input.mediaType,
            mediaFileName: input.mediaFileName,
            ycloudTemplateName: input.type === "template" ? input.ycloudTemplateName : null,
            ycloudTemplateLanguage: input.type === "template" ? input.ycloudTemplateLanguage : null,
            ycloudTemplateComponents: input.type === "template" && input.ycloudTemplateComponents
                ? input.ycloudTemplateComponents
                : Prisma.JsonNull,
            ycloudTemplateVariableValues: input.type === "template"
                ? input.ycloudTemplateVariableValues
                : Prisma.JsonNull,
            batchSize: input.batchSize,
            batchDelayMinutes: input.batchDelayMinutes,
            randomDelayMinSeconds: input.randomDelayMinSeconds,
            randomDelayMaxSeconds: input.randomDelayMaxSeconds,
            scheduledStartAt: input.scheduledStartAt,
            respectBusinessHours: input.respectBusinessHours,
            stopOnReply: input.stopOnReply,
            followUpCount: input.followUpCount,
            followUpDelayDays: input.followUpDelayDays,
            audienceFilters: input.audienceFilters,
            totalRecipients: estimatedRecipients.totalRecipients,
            createdById: createdById || null,
            variants: {
                create: input.variants.map((variant) => ({
                    label: variant.label,
                    content: variant.content,
                    weight: variant.weight,
                    sortOrder: variant.sortOrder,
                    isActive: variant.isActive,
                    variables: listTemplateVariableKeys(variant.content),
                })),
            },
        },
        include: {
            variants: {
                orderBy: { sortOrder: "asc" },
            },
        },
    });
}

export async function updateBulkCampaign(id: string, input: BulkCampaignUpsertInput) {
    ensureCampaignDraftIsValid(input);
    const existing = await prisma.bulkCampaign.findUnique({
        where: { id },
        include: {
            variants: true,
        },
    });

    if (!existing) {
        throw new Error("Campaña no encontrada");
    }

    if (existing.status === "running" || existing.status === "paused") {
        throw new Error("Pausa o termina la campaña antes de editar su configuración");
    }

    const estimatedRecipients = await countAudienceContacts(input.audienceFilters);

    await prisma.$transaction(async (tx) => {
        await tx.bulkCampaign.update({
            where: { id },
            data: {
                name: input.name,
                description: input.description || null,
                sourceType: input.sourceType,
                sourceId: input.sourceId,
                type: input.type,
                mediaUrl: input.mediaUrl,
                mediaType: input.mediaType,
                mediaFileName: input.mediaFileName,
                ycloudTemplateName: input.type === "template" ? input.ycloudTemplateName : null,
                ycloudTemplateLanguage: input.type === "template" ? input.ycloudTemplateLanguage : null,
                ycloudTemplateComponents: input.type === "template" && input.ycloudTemplateComponents
                    ? input.ycloudTemplateComponents
                    : Prisma.JsonNull,
                ycloudTemplateVariableValues: input.type === "template"
                    ? input.ycloudTemplateVariableValues
                    : Prisma.JsonNull,
                batchSize: input.batchSize,
                batchDelayMinutes: input.batchDelayMinutes,
                randomDelayMinSeconds: input.randomDelayMinSeconds,
                randomDelayMaxSeconds: input.randomDelayMaxSeconds,
                scheduledStartAt: input.scheduledStartAt,
                respectBusinessHours: input.respectBusinessHours,
                stopOnReply: input.stopOnReply,
                followUpCount: input.followUpCount,
                followUpDelayDays: input.followUpDelayDays,
                audienceFilters: input.audienceFilters,
                totalRecipients: estimatedRecipients.totalRecipients,
                completedAt: null,
            },
        });

        await tx.bulkCampaignVariant.deleteMany({
            where: { campaignId: id },
        });

        if (input.variants.length > 0) {
            await tx.bulkCampaignVariant.createMany({
                data: input.variants.map((variant) => ({
                    campaignId: id,
                    label: variant.label,
                    content: variant.content,
                    weight: variant.weight,
                    sortOrder: variant.sortOrder,
                    isActive: variant.isActive,
                    variables: listTemplateVariableKeys(variant.content),
                })),
            });
        }
    });

    return getBulkCampaignById(id);
}

export async function startBulkCampaign(id: string) {
    const campaign = await prisma.bulkCampaign.findUnique({
        where: { id },
        include: {
            variants: {
                orderBy: { sortOrder: "asc" },
            },
        },
    });

    if (!campaign) {
        throw new Error("Campaña no encontrada");
    }

    ensureCampaignCanLaunch(campaign);

    const filters = normalizeBulkCampaignAudienceFilters(
        campaign.audienceFilters,
        MAX_BULK_CAMPAIGN_AUDIENCE_LIMIT,
    );
    const contacts = await resolveBulkCampaignAudienceContacts(filters);

    if (contacts.length === 0) {
        throw new Error("No hay contactos que coincidan con la audiencia seleccionada");
    }

    const now = new Date();
    const nextRunAt = campaign.scheduledStartAt && campaign.scheduledStartAt.getTime() > now.getTime()
        ? campaign.scheduledStartAt
        : now;

    await prisma.$transaction(async (tx) => {
        await tx.bulkCampaignRecipient.deleteMany({
            where: { campaignId: id },
        });

        await tx.bulkCampaignRecipient.createMany({
            data: buildRecipientQueueRows(
                id,
                contacts.map((contact) => contact.id),
                Math.max(0, campaign.followUpCount || 0),
                nextRunAt,
                Math.max(1, campaign.followUpDelayDays || 1),
            ),
        });

        await tx.bulkCampaign.update({
            where: { id },
            data: {
                status: "running",
                totalRecipients: contacts.length,
                sentCount: 0,
                failedCount: 0,
                repliedCount: 0,
                skippedCount: 0,
                startedAt: now,
                completedAt: null,
                lastProcessedAt: null,
                nextRunAt,
                workerLockId: null,
                workerLockExpiresAt: null,
            },
        });
    });

    return getBulkCampaignById(id);
}

export async function pauseBulkCampaign(id: string) {
    return prisma.bulkCampaign.update({
        where: { id },
        data: {
            status: "paused",
            nextRunAt: null,
            workerLockId: null,
            workerLockExpiresAt: null,
        },
        include: {
            variants: {
                orderBy: { sortOrder: "asc" },
            },
        },
    });
}

export async function resumeBulkCampaign(id: string) {
    const existing = await prisma.bulkCampaign.findUnique({
        where: { id },
        select: {
            status: true,
            scheduledStartAt: true,
        },
    });

    if (!existing) {
        throw new Error("Campaña no encontrada");
    }

    if (existing.status === "draft") {
        return startBulkCampaign(id);
    }

    return prisma.bulkCampaign.update({
        where: { id },
        data: {
            status: "running",
            completedAt: null,
            nextRunAt: existing.scheduledStartAt && existing.scheduledStartAt.getTime() > Date.now()
                ? existing.scheduledStartAt
                : new Date(),
            workerLockId: null,
            workerLockExpiresAt: null,
        },
        include: {
            variants: {
                orderBy: { sortOrder: "asc" },
            },
        },
    });
}

export async function cancelBulkCampaign(id: string) {
    await prisma.$transaction(async (tx) => {
        await tx.bulkCampaignRecipient.updateMany({
            where: {
                campaignId: id,
                status: "queued",
            },
            data: {
                status: "cancelled",
            },
        });

        await tx.bulkCampaign.update({
            where: { id },
            data: {
                status: "cancelled",
                nextRunAt: null,
                workerLockId: null,
                workerLockExpiresAt: null,
                completedAt: new Date(),
            },
        });
    });

    return getBulkCampaignById(id);
}

export async function deleteBulkCampaign(id: string) {
    await prisma.bulkCampaign.delete({
        where: { id },
    });
}

function chooseVariant(variants: BulkCampaignVariant[], campaignType: BulkCampaignMessageType) {
    const activeVariants = variants.filter((variant) =>
        variant.isActive && (campaignType !== "text" || variant.content.trim()),
    );
    const totalWeight = activeVariants.reduce((sum, variant) => sum + Math.max(1, variant.weight), 0);
    if (totalWeight <= 0) {
        return activeVariants[0] || null;
    }

    let cursor = Math.random() * totalWeight;

    for (const variant of activeVariants) {
        cursor -= Math.max(1, variant.weight);
        if (cursor <= 0) {
            return variant;
        }
    }

    return activeVariants[0] || null;
}

function resolveBulkCampaignRandomDelayMs(
    campaign: Pick<BulkCampaign, "randomDelayMinSeconds" | "randomDelayMaxSeconds">,
) {
    const minSeconds = Math.max(1, campaign.randomDelayMinSeconds || 0);
    const maxSeconds = Math.max(minSeconds, campaign.randomDelayMaxSeconds || minSeconds);

    if (minSeconds === maxSeconds) {
        return minSeconds * 1000;
    }

    const offset = Math.floor(Math.random() * (maxSeconds - minSeconds + 1));
    return (minSeconds + offset) * 1000;
}

async function releaseCampaignLock(campaignId: string, lockId: string, data?: Prisma.BulkCampaignUpdateInput) {
    await prisma.bulkCampaign.updateMany({
        where: {
            id: campaignId,
            workerLockId: lockId,
        },
        data: {
            workerLockId: null,
            workerLockExpiresAt: null,
            ...(data || {}),
        },
    });
}

async function resolveNextCampaignRunAt(campaign: Pick<BulkCampaign, "respectBusinessHours">, now: Date) {
    if (!campaign.respectBusinessHours) {
        return now;
    }

    const settings = await getSystemSettingsOrDefaults();
    const config = normalizeBusinessHours(settings);
    const bounds = businessBoundsForDate(now, config);

    if (!bounds.isOpen) {
        const nextOpenDate = getNextOpenDate(now, config);
        return businessBoundsForDate(nextOpenDate, config).start;
    }

    if (now < bounds.start) {
        return bounds.start;
    }

    if (now >= bounds.end) {
        const tomorrow = new Date(now);
        tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
        const nextOpenDate = getNextOpenDate(tomorrow, config);
        return businessBoundsForDate(nextOpenDate, config).start;
    }

    return now;
}

async function moveContactDealsToClosedLostStage(contactId: string) {
    const closedLostStage = await prisma.pipelineStage.findFirst({
        where: { isClosedLost: true },
        select: { id: true },
    });

    if (!closedLostStage) {
        return false;
    }

    const openDeals = await prisma.deal.findMany({
        where: {
            contactId,
            stage: {
                isClosedWon: false,
                isClosedLost: false,
            },
        },
        select: { id: true },
    });

    if (openDeals.length === 0) {
        return false;
    }

    await prisma.deal.updateMany({
        where: {
            id: {
                in: openDeals.map((deal) => deal.id),
            },
        },
        data: {
            stageId: closedLostStage.id,
        },
    });

    return true;
}

async function moveContactIncomingDealsToThirdStage(contactId: string) {
    const pipelineStages = await prisma.pipelineStage.findMany({
        where: {
            isClosedWon: false,
            isClosedLost: false,
        },
        orderBy: { order: "asc" },
        select: {
            id: true,
            isIncoming: true,
        },
    });

    const thirdStage = pipelineStages[2];
    if (!thirdStage || thirdStage.isIncoming) {
        return false;
    }

    const incomingDeals = await prisma.deal.findMany({
        where: {
            contactId,
            stage: {
                isIncoming: true,
            },
        },
        select: { id: true },
    });

    if (incomingDeals.length === 0) {
        return false;
    }

    await prisma.deal.updateMany({
        where: {
            id: {
                in: incomingDeals.map((deal) => deal.id),
            },
        },
        data: {
            stageId: thirdStage.id,
        },
    });

    return true;
}

async function getNextQueuedRecipientForCampaign(campaignId: string) {
    return prisma.bulkCampaignRecipient.findFirst({
        where: {
            campaignId,
            status: "queued",
        },
        orderBy: [
            { plannedAt: "asc" },
            { sequenceIndex: "asc" },
        ],
        select: {
            id: true,
            plannedAt: true,
            sequenceIndex: true,
        },
    });
}

async function releaseCampaignLockForNextRecipient(
    campaign: Pick<BulkCampaign, "id" | "batchSize" | "batchDelayMinutes" | "randomDelayMinSeconds" | "randomDelayMaxSeconds" | "totalRecipients">,
    lockId: string,
    processedSequenceIndex: number | null,
    now = new Date(),
) {
    const nextQueuedRecipient = await getNextQueuedRecipientForCampaign(campaign.id);

    if (!nextQueuedRecipient) {
        const refreshed = await refreshBulkCampaignStats(campaign.id);
        await releaseCampaignLock(campaign.id, lockId, {
            status: "completed",
            completedAt: refreshed?.completedAt || now,
            nextRunAt: null,
            lastProcessedAt: now,
        });
        return;
    }

    if (nextQueuedRecipient.plannedAt.getTime() > now.getTime()) {
        await releaseCampaignLock(campaign.id, lockId, {
            nextRunAt: nextQueuedRecipient.plannedAt,
            lastProcessedAt: now,
        });
        return;
    }

    const perWaveRecipientCount = Math.max(1, campaign.totalRecipients || 1);
    const currentWaveOffset = processedSequenceIndex === null
        ? null
        : processedSequenceIndex % perWaveRecipientCount;
    const processedBoundary = currentWaveOffset !== null &&
        (currentWaveOffset + 1) % Math.max(1, campaign.batchSize) === 0;
    const usesBatchPause = processedBoundary && Math.max(0, campaign.batchDelayMinutes) > 0;

    await releaseCampaignLock(campaign.id, lockId, {
        nextRunAt: new Date(
            now.getTime() + (
                usesBatchPause
                    ? Math.max(0, campaign.batchDelayMinutes) * 60_000
                    : resolveBulkCampaignRandomDelayMs(campaign)
            ),
        ),
        lastProcessedAt: now,
    });
}

async function processClaimedCampaign(campaignId: string, lockId: string) {
    const campaign = await prisma.bulkCampaign.findUnique({
        where: { id: campaignId },
        include: {
            variants: {
                where: {
                    isActive: true,
                },
                orderBy: { sortOrder: "asc" },
            },
        },
    });

    if (!campaign || campaign.workerLockId !== lockId || campaign.status !== "running") {
        return;
    }

    try {
        if (campaign.variants.length === 0) {
            await releaseCampaignLock(campaignId, lockId, {
                status: "failed",
                nextRunAt: null,
                lastProcessedAt: new Date(),
            });
            return;
        }

        const now = new Date();
        const nextAllowedRunAt = await resolveNextCampaignRunAt(campaign, now);
        if (nextAllowedRunAt.getTime() > now.getTime()) {
            await releaseCampaignLock(campaignId, lockId, {
                nextRunAt: nextAllowedRunAt,
                lastProcessedAt: now,
            });
            return;
        }

        const recipients = await prisma.bulkCampaignRecipient.findMany({
            where: {
                campaignId,
                status: "queued",
                plannedAt: {
                    lte: now,
                },
            },
            include: {
                contact: true,
            },
            orderBy: [
                { plannedAt: "asc" },
                { sequenceIndex: "asc" },
            ],
            take: 1,
        });

        if (recipients.length === 0) {
            const nextQueuedRecipient = await getNextQueuedRecipientForCampaign(campaignId);
            if (!nextQueuedRecipient) {
                await refreshBulkCampaignStats(campaignId);
                await releaseCampaignLock(campaignId, lockId, {
                    status: "completed",
                    completedAt: new Date(),
                    nextRunAt: null,
                    lastProcessedAt: now,
                });
                return;
            }

            await releaseCampaignLock(campaignId, lockId, {
                nextRunAt: nextQueuedRecipient.plannedAt,
                lastProcessedAt: now,
            });
            return;
        }

        const recipient = recipients[0];
        if (!recipient) {
            await releaseCampaignLock(campaignId, lockId, {
                status: "completed",
                completedAt: new Date(),
                nextRunAt: null,
                lastProcessedAt: now,
            });
            return;
        }

        let skipReason: string | null = null;

        if (recipient.contact.bulkCampaignOptOutAt) {
            skipReason = "Contacto bloqueado para envios masivos por solicitud STOP";
            await prisma.bulkCampaignRecipient.updateMany({
                where: {
                    contactId: recipient.contactId,
                    status: "queued",
                },
                data: {
                    status: "skipped",
                    lastError: skipReason,
                },
            });
        } else if (recipient.attemptNumber > 0) {
            const previousAttempt = await prisma.bulkCampaignRecipient.findUnique({
                where: {
                    campaignId_contactId_attemptNumber: {
                        campaignId,
                        contactId: recipient.contactId,
                        attemptNumber: recipient.attemptNumber - 1,
                    },
                },
                select: {
                    status: true,
                    sentAt: true,
                    repliedAt: true,
                },
            });

            if (!previousAttempt?.sentAt || previousAttempt.status !== "sent" || previousAttempt.repliedAt) {
                skipReason = previousAttempt?.status === "replied" || previousAttempt?.repliedAt
                    ? "Seguimiento detenido porque el lead ya respondio"
                    : "Seguimiento omitido porque el intento anterior no se envio correctamente";

                await prisma.bulkCampaignRecipient.updateMany({
                    where: {
                        campaignId,
                        contactId: recipient.contactId,
                        status: "queued",
                        attemptNumber: {
                            gte: recipient.attemptNumber,
                        },
                    },
                    data: {
                        status: "skipped",
                        lastError: skipReason,
                    },
                });
            }
        }

        if (skipReason) {
            await refreshBulkCampaignStats(campaignId);
            await releaseCampaignLockForNextRecipient(
                campaign,
                lockId,
                recipient.sequenceIndex,
                new Date(),
            );
            return;
        }

        const settings = await getSystemSettingsOrDefaults();
        const campaignSourceType = normalizeMessageSourceType(campaign.sourceType);
        const campaignSourceId = campaign.sourceId || resolveMessageSourceId(campaignSourceType, settings);
        const campaignMessageType = normalizeCampaignType(campaign.type);
        const variant = chooseVariant(campaign.variants, campaignMessageType);

        if (!variant) {
            await prisma.bulkCampaignRecipient.update({
                where: { id: recipient.id },
                data: {
                    status: "failed",
                    lastError: "No hay variantes activas disponibles",
                },
            });
        } else {
            try {
                const conversation = recipient.conversationId
                    ? await prisma.conversation.findUnique({ where: { id: recipient.conversationId } })
                    : null;
                const activeConversation = conversation?.sourceType === campaignSourceType &&
                    (conversation.sourceId || null) === (campaignSourceId || null)
                    ? conversation
                    : await findOrCreateActiveConversationForContactSource({
                        contactId: recipient.contactId,
                        sourceType: campaignSourceType,
                        sourceId: campaignSourceId,
                        defaults: {
                            botActive: true,
                        },
                    });

                if (campaignMessageType === "template") {
                    if (campaignSourceType !== MESSAGE_SOURCE_META) {
                        throw new Error("Las plantillas Meta solo se pueden enviar por WhatsApp API");
                    }

                    if (!recipient.contact.phone) {
                        throw new Error("El contacto no tiene telefono destino");
                    }

                    const renderedContent = renderYCloudTemplatePreviewContent({
                        templateName: campaign.ycloudTemplateName || "plantilla_ycloud",
                        components: campaign.ycloudTemplateComponents,
                        variableValues: campaign.ycloudTemplateVariableValues,
                        contact: recipient.contact,
                        agentName: settings.agentName,
                    });

                    const ycloudResult = await sendMetaTemplateMessage({
                        to: recipient.contact.phone,
                        templateName: campaign.ycloudTemplateName || "",
                        languageCode: campaign.ycloudTemplateLanguage || "es",
                        components: buildYCloudTemplateComponentsForCampaign({
                            components: campaign.ycloudTemplateComponents,
                            variableValues: campaign.ycloudTemplateVariableValues,
                            contact: recipient.contact,
                            agentName: settings.agentName,
                        }),
                    });

                    const message = await prisma.message.create({
                        data: {
                            conversationId: activeConversation.id,
                            content: renderedContent,
                            direction: "outbound",
                            status: "sent",
                            type: "template",
                            senderType: "human",
                            sourceType: MESSAGE_SOURCE_META,
                            sourceId: campaignSourceId,
                            providerMessageId: ycloudResult.Id || null,
                        },
                    });

                    await prisma.conversation.update({
                        where: { id: activeConversation.id },
                        data: {
                            updatedAt: new Date(),
                            sessionExpiresAt: new Date(Date.now() + YCLOUD_TEMPLATE_WINDOW_MS),
                            botActive: true,
                        },
                    });

                    await prisma.bulkCampaignRecipient.update({
                        where: { id: recipient.id },
                        data: {
                            status: "sent",
                            conversationId: activeConversation.id,
                            variantId: variant.id,
                            renderedContent,
                            providerMessageId: message.providerMessageId || null,
                            sentAt: new Date(),
                            lastError: null,
                        },
                    });

                    if (recipient.attemptNumber === 0) {
                        try {
                            await moveContactIncomingDealsToThirdStage(recipient.contactId);
                        } catch (stageMoveError) {
                            console.warn(
                                "[BulkCampaigns] Failed to move incoming deals to third stage after initial bulk template send",
                                stageMoveError,
                            );
                        }
                    }

                    await refreshBulkCampaignStats(campaignId);
                    await releaseCampaignLockForNextRecipient(
                        campaign,
                        lockId,
                        recipient.sequenceIndex,
                        new Date(),
                    );
                    return;
                }

                if (
                    campaignSourceType === MESSAGE_SOURCE_META &&
                    (!activeConversation.sessionExpiresAt ||
                        activeConversation.sessionExpiresAt.getTime() <= Date.now() + YCLOUD_OPEN_WINDOW_GRACE_MS)
                ) {
                    await prisma.bulkCampaignRecipient.update({
                        where: { id: recipient.id },
                        data: {
                            status: "skipped",
                            conversationId: activeConversation.id,
                            lastError: "Ventana de WhatsApp API cerrada; usa una plantilla aprobada para este contacto.",
                        },
                    });

                    await refreshBulkCampaignStats(campaignId);
                    await releaseCampaignLockForNextRecipient(
                        campaign,
                        lockId,
                        recipient.sequenceIndex,
                        new Date(),
                    );
                    return;
                }
                const renderedContent = renderTemplateContent(variant.content || "", {
                    contact: {
                        name: recipient.contact.name,
                        company: recipient.contact.company,
                        phone: recipient.contact.phone,
                    },
                    agentName: settings.agentName,
                });

                const result = await sendOutboundConversationMessage({
                    conversationId: activeConversation.id,
                    content: renderedContent,
                    type: campaignMessageType as OutboundMessageType,
                    sourceType: campaignSourceType,
                    sourceId: campaignSourceId,
                    mediaUrl: campaignMessageType === "text" ? null : campaign.mediaUrl,
                    mediaType: campaignMessageType === "text" ? null : campaign.mediaType,
                    mediaFileName: campaignMessageType === "text" ? null : campaign.mediaFileName,
                    senderType: "human",
                    botActiveOverride: true,
                });

                await prisma.bulkCampaignRecipient.update({
                    where: { id: recipient.id },
                    data: {
                        status: "sent",
                        conversationId: activeConversation.id,
                        variantId: variant.id,
                        renderedContent,
                        providerMessageId: result.message.providerMessageId || null,
                        sentAt: new Date(),
                        lastError: null,
                    },
                });

                if (recipient.attemptNumber === 0) {
                    try {
                        await moveContactIncomingDealsToThirdStage(recipient.contactId);
                    } catch (stageMoveError) {
                        console.warn(
                            "[BulkCampaigns] Failed to move incoming deals to third stage after initial bulk send",
                            stageMoveError,
                        );
                    }
                }
            } catch (error) {
                await prisma.bulkCampaignRecipient.update({
                    where: { id: recipient.id },
                    data: {
                        status: "failed",
                        lastError: error instanceof Error ? error.message : "No se pudo enviar el mensaje",
                    },
                });
            }
        }

        await refreshBulkCampaignStats(campaignId);
        await releaseCampaignLockForNextRecipient(
            campaign,
            lockId,
            recipient.sequenceIndex,
            new Date(),
        );
    } catch (error) {
        console.error("[BulkCampaigns] Failed to process campaign", campaignId, error);
        await releaseCampaignLock(campaignId, lockId, {
            status: "failed",
            nextRunAt: null,
            lastProcessedAt: new Date(),
        });
    }
}

export async function processDueBulkCampaigns(limit = 3) {
    const now = new Date();
    const candidates = await prisma.bulkCampaign.findMany({
        where: {
            status: "running",
            nextRunAt: {
                lte: now,
            },
            OR: [
                { workerLockExpiresAt: null },
                { workerLockExpiresAt: { lt: now } },
            ],
        },
        orderBy: { nextRunAt: "asc" },
        take: Math.max(1, limit),
    });

    for (const campaign of candidates) {
        const lockId = crypto.randomUUID();
        const claimed = await prisma.bulkCampaign.updateMany({
            where: {
                id: campaign.id,
                status: "running",
                OR: [
                    { workerLockExpiresAt: null },
                    { workerLockExpiresAt: { lt: now } },
                ],
            },
            data: {
                workerLockId: lockId,
                workerLockExpiresAt: new Date(Date.now() + WORKER_LOCK_TTL_MS),
            },
        });

        if (claimed.count === 1) {
            await processClaimedCampaign(campaign.id, lockId);
        }
    }
}

export async function markBulkCampaignReplyForContact(
    contactId: string,
    conversationId: string | null,
    rawText: string,
    repliedAt = new Date(),
) {
    const classifiedIntent = classifyBulkCampaignReplyIntent(rawText);
    const explicitStop = isExplicitBulkStopCommand(rawText);
    const intent: BulkCampaignReplyIntent =
        classifiedIntent === "stop" && !explicitStop
            ? "neutral"
            : classifiedIntent;
    const shouldStopAllQueued = intent === "stop" || intent === "interest";

    const sentRecipients = await prisma.bulkCampaignRecipient.findMany({
        where: {
            contactId,
            sentAt: { not: null },
            repliedAt: null,
            ...(intent !== "neutral"
                ? {}
                : {
                    campaign: {
                        stopOnReply: true,
                    },
                }),
        },
        select: {
            id: true,
            campaignId: true,
        },
    });

    const queuedRecipients = await prisma.bulkCampaignRecipient.findMany({
        where: {
            contactId,
            status: "queued",
            ...(shouldStopAllQueued
                ? {}
                : {
                    campaignId: {
                        in: sentRecipients.map((recipient) => recipient.campaignId),
                    },
                }),
        },
        select: {
            id: true,
            campaignId: true,
        },
    });

    const hasCampaignContext = sentRecipients.length > 0 || queuedRecipients.length > 0;
    if (!hasCampaignContext) {
        return {
            intent: "neutral",
            stoppedCampaignIds: [],
            activatedBot: false,
            optedOut: false,
        } satisfies BulkCampaignReplyHandlingResult;
    }

    await prisma.$transaction(async (tx) => {
        if (sentRecipients.length > 0) {
            await tx.bulkCampaignRecipient.updateMany({
                where: {
                    id: {
                        in: sentRecipients.map((recipient) => recipient.id),
                    },
                },
                data: {
                    status: "replied",
                    repliedAt,
                    lastInboundAt: repliedAt,
                    conversationId: conversationId || undefined,
                },
            });
        }

        if (queuedRecipients.length > 0) {
            await tx.bulkCampaignRecipient.updateMany({
                where: {
                    id: {
                        in: queuedRecipients.map((recipient) => recipient.id),
                    },
                },
                data: {
                    status: "skipped",
                    lastError: intent === "stop"
                        ? "Seguimiento cancelado por solicitud STOP del lead"
                        : intent === "interest"
                            ? "Seguimiento cancelado porque el lead mostro interes"
                            : "Seguimiento cancelado porque el lead respondio",
                    lastInboundAt: repliedAt,
                },
            });
        }

        if (intent === "stop") {
            await tx.contact.update({
                where: { id: contactId },
                data: {
                    bulkCampaignOptOutAt: repliedAt,
                    bulkCampaignOptOutReason: rawText.trim().slice(0, 160) || "stop",
                },
            });
        }
    });

    if (intent === "stop") {
        await moveContactDealsToClosedLostStage(contactId);
        console.warn("[BulkCampaigns] Contact moved to closed-lost by explicit STOP", {
            contactId,
            reason: rawText.trim().slice(0, 160),
            sentRecipients: sentRecipients.length,
            queuedRecipients: queuedRecipients.length,
        });
    }

    const campaignIds = [...sentRecipients, ...queuedRecipients]
        .map((recipient) => recipient.campaignId)
        .filter((campaignId, index, array) => array.indexOf(campaignId) === index);

    for (const campaignId of campaignIds) {
        await refreshBulkCampaignStats(campaignId);
    }

    return {
        intent,
        stoppedCampaignIds: campaignIds,
        activatedBot: false,
        optedOut: intent === "stop",
    } satisfies BulkCampaignReplyHandlingResult;
}
