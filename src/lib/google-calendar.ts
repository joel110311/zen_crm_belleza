import { prisma } from "@/lib/db";
import { getSystemSettingsOrDefaults, withSettingsDefaults } from "@/lib/system-settings";
import type { GoogleCalendarSource } from "@prisma/client";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";
const SYNC_THROTTLE_MS = 60 * 1000;
const MAX_SPECIALISTS = 5;
const WRITABLE_ACCESS_ROLES = new Set(["writer", "owner"]);
const CALENDAR_COLOR_FALLBACK = "#3B82F6";

type TokenResponse = {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
};

type GoogleEventDateTime = {
    dateTime?: string;
    date?: string;
    timeZone?: string;
};

type GoogleCalendarEvent = {
    id: string;
    status?: string;
    summary?: string;
    description?: string;
    updated?: string;
    hangoutLink?: string;
    start?: GoogleEventDateTime;
    end?: GoogleEventDateTime;
    conferenceData?: {
        entryPoints?: Array<{
            entryPointType?: string;
            uri?: string;
        }>;
    };
    extendedProperties?: {
        private?: Record<string, string>;
    };
};

type GoogleCalendarListEntry = {
    id: string;
    summary?: string;
    description?: string;
    backgroundColor?: string;
    foregroundColor?: string;
    accessRole?: string;
    primary?: boolean;
    selected?: boolean;
    hidden?: boolean;
    deleted?: boolean;
};

type SettingsWithSources = Awaited<ReturnType<typeof getGoogleSettingsWithSources>>;

export type GoogleCalendarSourceSummary = {
    id: string;
    calendarId: string;
    summary: string;
    description?: string | null;
    backgroundColor?: string | null;
    foregroundColor?: string | null;
    accessRole?: string | null;
    isPrimary: boolean;
    isSelected: boolean;
    blocksAvailability: boolean;
    importToCrm: boolean;
    isWriteTarget: boolean;
    isSpecialist: boolean;
    specialistName?: string | null;
    sortOrder: number;
    lastSyncedAt?: string | null;
    writable: boolean;
};

export type GoogleCalendarSourceInput = {
    calendarId: string;
    isSelected: boolean;
    blocksAvailability: boolean;
    importToCrm: boolean;
    isWriteTarget: boolean;
    isSpecialist: boolean;
    specialistName?: string | null;
    sortOrder?: number;
};

export type GoogleCalendarStatus = {
    configured: boolean;
    connected: boolean;
    connectedEmail?: string | null;
    calendarId?: string | null;
    lastSyncedAt?: string | null;
    sources: GoogleCalendarSourceSummary[];
    specialistCount: number;
    maxSpecialists: number;
};

export type GoogleCalendarBookingContext = {
    connected: boolean;
    writeTarget: GoogleCalendarSourceSummary | null;
    specialists: GoogleCalendarSourceSummary[];
    availabilitySources: GoogleCalendarSourceSummary[];
    allSources: GoogleCalendarSourceSummary[];
};

function getCalendarId(value?: string | null) {
    return (value || "primary").trim() || "primary";
}

function normalizeHexColor(value?: string | null) {
    if (!value) return CALENDAR_COLOR_FALLBACK;
    const trimmed = value.trim();
    return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed : CALENDAR_COLOR_FALLBACK;
}

function normalizeSpecialistName(value?: string | null, fallback?: string | null) {
    const candidate = (value || "").trim();
    if (candidate) return candidate;
    const fallbackValue = (fallback || "").trim();
    return fallbackValue || null;
}

function normalizeSearchValue(value?: string | null) {
    return (value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
}

function isCalendarWritable(accessRole?: string | null) {
    return WRITABLE_ACCESS_ROLES.has((accessRole || "").toLowerCase());
}

function hasGoogleConfig(settings: Awaited<ReturnType<typeof getSystemSettingsOrDefaults>>) {
    return Boolean(settings.googleClientId && settings.googleClientSecret);
}

function hasGoogleConnection(settings: Awaited<ReturnType<typeof getSystemSettingsOrDefaults>>) {
    return Boolean(
        hasGoogleConfig(settings) &&
        settings.googleAccessToken &&
        settings.googleRefreshToken,
    );
}

function mapSourceSummary(source: GoogleCalendarSource): GoogleCalendarSourceSummary {
    return {
        id: source.id,
        calendarId: source.calendarId,
        summary: source.summary,
        description: source.description,
        backgroundColor: normalizeHexColor(source.backgroundColor),
        foregroundColor: source.foregroundColor,
        accessRole: source.accessRole,
        isPrimary: source.isPrimary,
        isSelected: source.isSelected,
        blocksAvailability: source.blocksAvailability,
        importToCrm: source.importToCrm,
        isWriteTarget: source.isWriteTarget,
        isSpecialist: source.isSpecialist,
        specialistName: normalizeSpecialistName(source.specialistName, source.summary),
        sortOrder: source.sortOrder,
        lastSyncedAt: source.lastSyncedAt?.toISOString() || null,
        writable: isCalendarWritable(source.accessRole),
    };
}

async function ensureSystemSettingsRecord() {
    const existing = await prisma.systemSettings.findFirst();
    if (existing) {
        return existing;
    }

    return prisma.systemSettings.create({ data: {} });
}

async function getGoogleSettingsWithSources() {
    const settings = await prisma.systemSettings.findFirst({
        include: {
            googleCalendars: {
                orderBy: [{ sortOrder: "asc" }, { summary: "asc" }],
            },
        },
    });

    const base = withSettingsDefaults(settings);
    return {
        ...base,
        googleCalendars: settings?.googleCalendars || [],
    };
}

function resolveWriteTargetSource(
    sources: GoogleCalendarSource[],
    legacyCalendarId?: string | null,
) {
    const selectedWritable = sources.filter((source) => source.isSelected && isCalendarWritable(source.accessRole));
    const preferredId = getCalendarId(legacyCalendarId);

    return (
        selectedWritable.find((source) => source.isWriteTarget) ||
        selectedWritable.find((source) => source.calendarId === preferredId) ||
        selectedWritable.find((source) => source.isPrimary) ||
        selectedWritable[0] ||
        null
    );
}

async function updateGoogleTokens(
    settingsId: string,
    tokens: TokenResponse,
) {
    const expiresAt = new Date(Date.now() + Math.max(tokens.expires_in - 60, 60) * 1000);

    return prisma.systemSettings.update({
        where: { id: settingsId },
        data: {
            googleAccessToken: tokens.access_token,
            googleRefreshToken: tokens.refresh_token || undefined,
            googleTokenExpiresAt: expiresAt,
        },
    });
}

async function fetchGoogleJson<T>(
    url: string,
    init: RequestInit,
) {
    const response = await fetch(url, init);
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Google Calendar API error (${response.status}): ${body}`);
    }
    return response.json() as Promise<T>;
}

async function getValidGoogleAccessToken() {
    const settings = await getSystemSettingsOrDefaults();
    if (!hasGoogleConnection(settings) || !settings.id) {
        throw new Error("Google Calendar no esta conectado.");
    }

    if (
        settings.googleAccessToken &&
        settings.googleTokenExpiresAt &&
        settings.googleTokenExpiresAt.getTime() > Date.now() + 30_000
    ) {
        return {
            accessToken: settings.googleAccessToken,
            settings,
        };
    }

    const body = new URLSearchParams({
        client_id: settings.googleClientId || "",
        client_secret: settings.googleClientSecret || "",
        refresh_token: settings.googleRefreshToken || "",
        grant_type: "refresh_token",
    });

    const tokens = await fetchGoogleJson<TokenResponse>(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
    });

    const updated = await updateGoogleTokens(settings.id, tokens);

    return {
        accessToken: updated.googleAccessToken || tokens.access_token,
        settings: {
            ...settings,
            ...updated,
        },
    };
}

async function googleCalendarRequest<T>(
    path: string,
    init: RequestInit = {},
) {
    const { accessToken, settings } = await getValidGoogleAccessToken();
    const response = await fetch(`${GOOGLE_CALENDAR_API}${path}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            ...(init.headers || {}),
        },
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Google Calendar API error (${response.status}): ${body}`);
    }

    if (response.status === 204) {
        return {
            data: null as T | null,
            settings,
        };
    }

    return {
        data: (await response.json()) as T,
        settings,
    };
}

async function listGoogleCalendarEntries() {
    const { data } = await googleCalendarRequest<{
        items?: GoogleCalendarListEntry[];
    }>("/users/me/calendarList?showHidden=true&showDeleted=false");

    return (data?.items || []).filter((item) => !item.deleted);
}

function getGoogleEventLocalId(event: GoogleCalendarEvent) {
    return event.extendedProperties?.private?.crmAppointmentId || null;
}

function getGoogleEventContactId(event: GoogleCalendarEvent) {
    return event.extendedProperties?.private?.crmContactId || null;
}

function parseTimedEventDate(value?: GoogleEventDateTime) {
    if (value?.dateTime) {
        return new Date(value.dateTime);
    }
    return null;
}

function buildGoogleCalendarEventPayload(
    appointment: {
        id: string;
        title: string;
        notes: string | null;
        startTime: Date;
        endTime: Date;
        visitMode?: string | null;
        meetStatus?: string | null;
        meetLink?: string | null;
        contactId?: string | null;
        patientId?: string | null;
    },
    timeZone: string,
) {
    const requestMeet = ["virtual", "hibrida"].includes(appointment.visitMode || "") && appointment.meetStatus === "requested" && !appointment.meetLink;
    const notes = [
        appointment.notes || "",
        appointment.meetLink ? `Google Meet: ${appointment.meetLink}` : "",
    ].filter(Boolean).join("\n\n");

    return {
        summary: appointment.title,
        description: notes,
        ...(appointment.meetLink ? { location: appointment.meetLink } : {}),
        start: {
            dateTime: appointment.startTime.toISOString(),
            timeZone,
        },
        end: {
            dateTime: appointment.endTime.toISOString(),
            timeZone,
        },
        extendedProperties: {
            private: {
                crmAppointmentId: appointment.id,
                ...(appointment.contactId ? { crmContactId: appointment.contactId } : {}),
                ...(appointment.patientId ? { crmPatientId: appointment.patientId } : {}),
            },
        },
        ...(requestMeet
            ? {
                conferenceData: {
                    createRequest: {
                        requestId: `zen-${appointment.id}-${Date.now()}`,
                    },
                },
            }
            : {}),
    };
}

function extractMeetLink(event?: GoogleCalendarEvent | null) {
    return event?.hangoutLink ||
        event?.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "video" && entry.uri)?.uri ||
        null;
}

async function applyGoogleEventToCrm(
    event: GoogleCalendarEvent,
    source: GoogleCalendarSource,
) {
    const localId = getGoogleEventLocalId(event);
    const existing =
        (localId
            ? await prisma.appointment.findUnique({ where: { id: localId } })
            : null) ||
        (event.id
            ? await prisma.appointment.findFirst({
                where: {
                    googleCalendarId: source.calendarId,
                    googleEventId: event.id,
                },
            })
            : null);

    if (event.status === "cancelled") {
        if (existing) {
            await prisma.appointment.delete({ where: { id: existing.id } });
        }
        return;
    }

    const startTime = parseTimedEventDate(event.start);
    const endTime = parseTimedEventDate(event.end);
    if (!startTime || !endTime) {
        return;
    }

    const linkedSpecialist = source.isSpecialist
        ? await prisma.specialist.findFirst({
            where: {
                googleCalendarSourceId: source.id,
                isActive: true,
            },
            select: {
                id: true,
                name: true,
            },
        })
        : null;

    const data = {
        title: event.summary || "Evento de Google Calendar",
        notes: event.description || null,
        startTime,
        endTime,
        status: "scheduled",
        source: "google",
        googleEventId: event.id,
        googleCalendarId: source.calendarId,
        googleCalendarName: source.summary,
        googleCalendarColor: normalizeHexColor(source.backgroundColor),
        meetLink: extractMeetLink(event) || existing?.meetLink || null,
        meetStatus: extractMeetLink(event) ? "generated" : existing?.meetStatus || "none",
        visitMode: extractMeetLink(event) ? "virtual" : existing?.visitMode || "presencial",
        specialistName: source.isSpecialist
            ? normalizeSpecialistName(source.specialistName, source.summary)
            : null,
        specialistId: linkedSpecialist?.id || existing?.specialistId || null,
        googleEventUpdatedAt: event.updated ? new Date(event.updated) : null,
        contactId: getGoogleEventContactId(event) || existing?.contactId || undefined,
        userId: existing?.userId || undefined,
    };

    if (existing) {
        await prisma.appointment.update({
            where: { id: existing.id },
            data,
        });
        return;
    }

    await prisma.appointment.create({
        data,
    });
}

async function listGoogleCalendarEvents(source: GoogleCalendarSource) {
    const calendarId = encodeURIComponent(source.calendarId);
    let nextPageToken: string | null = null;
    const events: GoogleCalendarEvent[] = [];
    let nextSyncToken = source.syncToken || null;

    do {
        const params = new URLSearchParams({
            singleEvents: "true",
            showDeleted: "true",
            maxResults: "250",
        });

        if (nextPageToken) {
            params.set("pageToken", nextPageToken);
        }

        if (source.syncToken) {
            params.set("syncToken", source.syncToken);
        } else {
            params.set("timeMin", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
            params.set("timeMax", new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString());
            params.set("orderBy", "startTime");
        }

        const { data } = await googleCalendarRequest<{
            items?: GoogleCalendarEvent[];
            nextPageToken?: string;
            nextSyncToken?: string;
        }>(`/calendars/${calendarId}/events?${params.toString()}`);

        events.push(...(data?.items || []));
        nextPageToken = data?.nextPageToken || null;
        nextSyncToken = data?.nextSyncToken || nextSyncToken;
    } while (nextPageToken);

    return { events, nextSyncToken };
}

async function deleteGoogleEventFromCalendar(calendarId: string, eventId: string) {
    try {
        await googleCalendarRequest<null>(
            `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
            { method: "DELETE" },
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (!message.includes("(404)")) {
            throw error;
        }
    }
}

async function persistCalendarDiscovery(
    settings: SettingsWithSources,
    entries: GoogleCalendarListEntry[],
) {
    const systemSettingsId = settings.id;
    if (!systemSettingsId) {
        throw new Error("No existe la configuracion del sistema para guardar calendarios.");
    }

    const existingByCalendarId = new Map(
        settings.googleCalendars.map((source) => [source.calendarId, source] as const),
    );
    const knownCalendarIds = entries.map((entry) => entry.id);
    const legacyCalendarId = getCalendarId(settings.googleCalendarId);
    const existingWriteTargetId =
        settings.googleCalendars.find((source) => source.isWriteTarget)?.calendarId || legacyCalendarId;

    await prisma.$transaction(async (tx) => {
        await tx.googleCalendarSource.deleteMany({
            where: {
                systemSettingsId,
                ...(knownCalendarIds.length > 0
                    ? { calendarId: { notIn: knownCalendarIds } }
                    : {}),
            },
        });

        for (const [index, entry] of entries.entries()) {
            const existing = existingByCalendarId.get(entry.id);
            const writable = isCalendarWritable(entry.accessRole);
            const isPrimary = Boolean(entry.primary);
            const defaultSelected = entry.id === legacyCalendarId || isPrimary;

            await tx.googleCalendarSource.upsert({
                where: {
                    systemSettingsId_calendarId: {
                        systemSettingsId,
                        calendarId: entry.id,
                    },
                },
                create: {
                    systemSettingsId,
                    calendarId: entry.id,
                    summary: entry.summary || entry.id,
                    description: entry.description || null,
                    backgroundColor: normalizeHexColor(entry.backgroundColor),
                    foregroundColor: entry.foregroundColor || null,
                    accessRole: entry.accessRole || null,
                    isPrimary,
                    isSelected: defaultSelected,
                    blocksAvailability: defaultSelected,
                    importToCrm: defaultSelected,
                    isWriteTarget: writable && (entry.id === existingWriteTargetId || (defaultSelected && isPrimary)),
                    isSpecialist: false,
                    specialistName: null,
                    sortOrder: existing?.sortOrder ?? index,
                    syncToken: null,
                    lastSyncedAt: null,
                },
                update: {
                    summary: entry.summary || existing?.summary || entry.id,
                    description: entry.description || null,
                    backgroundColor: normalizeHexColor(entry.backgroundColor),
                    foregroundColor: entry.foregroundColor || null,
                    accessRole: entry.accessRole || null,
                    isPrimary,
                    sortOrder: existing?.sortOrder ?? index,
                },
            });
        }
    });

    const refreshed = await getGoogleSettingsWithSources();
    const writeTarget = resolveWriteTargetSource(refreshed.googleCalendars, refreshed.googleCalendarId);

    await prisma.$transaction(async (tx) => {
        await tx.googleCalendarSource.updateMany({
            where: { systemSettingsId },
            data: { isWriteTarget: false },
        });

        if (writeTarget) {
            await tx.googleCalendarSource.update({
                where: { id: writeTarget.id },
                data: {
                    isSelected: true,
                    isWriteTarget: true,
                    importToCrm: true,
                    blocksAvailability: true,
                },
            });
        }

        await tx.systemSettings.update({
            where: { id: systemSettingsId },
            data: {
                googleCalendarId: writeTarget?.calendarId || legacyCalendarId,
            },
        });
    });
}

export async function discoverGoogleCalendarSources() {
    const settings = await getGoogleSettingsWithSources();
    if (!hasGoogleConnection(settings)) {
        throw new Error("Google Calendar no esta conectado.");
    }

    const entries = await listGoogleCalendarEntries();
    await persistCalendarDiscovery(settings, entries);
    return getGoogleCalendarStatus();
}

export async function getGoogleCalendarStatus(): Promise<GoogleCalendarStatus> {
    const settings = await getGoogleSettingsWithSources();
    const writeTarget = resolveWriteTargetSource(settings.googleCalendars, settings.googleCalendarId);
    const sources = settings.googleCalendars.map(mapSourceSummary);

    return {
        configured: hasGoogleConfig(settings),
        connected: hasGoogleConnection(settings),
        connectedEmail: settings.googleConnectedEmail || null,
        calendarId: writeTarget?.calendarId || getCalendarId(settings.googleCalendarId),
        lastSyncedAt: settings.googleLastSyncedAt?.toISOString() || null,
        sources,
        specialistCount: sources.filter((source) => source.isSpecialist).length,
        maxSpecialists: MAX_SPECIALISTS,
    };
}

export async function saveGoogleCalendarSources(inputs: GoogleCalendarSourceInput[]) {
    const settingsRecord = await ensureSystemSettingsRecord();
    const settings = await prisma.systemSettings.findUnique({
        where: { id: settingsRecord.id },
        include: {
            googleCalendars: {
                orderBy: [{ sortOrder: "asc" }, { summary: "asc" }],
            },
        },
    });

    if (!settings) {
        throw new Error("No se pudo cargar la configuracion de calendarios.");
    }

    if (settings.googleCalendars.length === 0) {
        throw new Error("Primero carga los calendarios de Google.");
    }

    const inputByCalendarId = new Map(inputs.map((input) => [input.calendarId, input] as const));
    const updates = settings.googleCalendars.map((source, index) => {
        const input = inputByCalendarId.get(source.calendarId);
        const writable = isCalendarWritable(source.accessRole);
        const isSelected = Boolean(input?.isSelected);
        const blocksAvailability = isSelected && Boolean(input?.blocksAvailability);
        const importToCrm = isSelected && Boolean(input?.importToCrm);
        const isWriteTarget = isSelected && writable && Boolean(input?.isWriteTarget);
        const isSpecialist = isSelected && writable && Boolean(input?.isSpecialist);

        return {
            id: source.id,
            calendarId: source.calendarId,
            writable,
            isSelected,
            blocksAvailability,
            importToCrm,
            isWriteTarget,
            isSpecialist,
            specialistName: isSpecialist
                ? normalizeSpecialistName(input?.specialistName, source.summary)
                : null,
            sortOrder: input?.sortOrder ?? index,
        };
    });

    const specialistCount = updates.filter((source) => source.isSpecialist).length;
    if (specialistCount > MAX_SPECIALISTS) {
        throw new Error(`Solo puedes activar hasta ${MAX_SPECIALISTS} especialistas.`);
    }

    const writeTargets = updates.filter((source) => source.isWriteTarget);
    if (writeTargets.length > 1) {
        throw new Error("Solo puedes elegir un calendario de escritura.");
    }

    const resolvedWriteTarget =
        writeTargets[0] ||
        updates.find((source) => source.isSelected && source.writable) ||
        null;

    await prisma.$transaction(async (tx) => {
        for (const source of updates) {
            await tx.googleCalendarSource.update({
                where: { id: source.id },
                data: {
                    isSelected: source.isSelected,
                    blocksAvailability: source.isSelected ? source.blocksAvailability : false,
                    importToCrm: source.isSelected ? source.importToCrm : false,
                    isWriteTarget: resolvedWriteTarget?.id === source.id,
                    isSpecialist: source.isSelected ? source.isSpecialist : false,
                    specialistName: source.isSelected ? source.specialistName : null,
                    sortOrder: source.sortOrder,
                },
            });
        }

        await tx.systemSettings.update({
            where: { id: settings.id },
            data: {
                googleCalendarId: resolvedWriteTarget?.calendarId || settings.googleCalendarId || "primary",
            },
        });
    });

    await syncSpecialistsFromGoogleSources();
    await syncGoogleCalendarToCrm(true);
    return getGoogleCalendarStatus();
}

export async function syncSpecialistsFromGoogleSources() {
    const settings = await getGoogleSettingsWithSources();
    const specialistSources = settings.googleCalendars
        .filter((source) => source.isSelected && source.isSpecialist && isCalendarWritable(source.accessRole))
        .slice(0, MAX_SPECIALISTS);
    const activeSourceIds = specialistSources.map((source) => source.id);

    await prisma.$transaction(async (tx) => {
        await tx.specialist.updateMany({
            where: activeSourceIds.length > 0
                ? {
                    AND: [
                        { googleCalendarSourceId: { not: null } },
                        { googleCalendarSourceId: { notIn: activeSourceIds } },
                    ],
                }
                : {
                    googleCalendarSourceId: { not: null },
                },
            data: { isActive: false },
        });

        for (const [index, source] of specialistSources.entries()) {
            const name = normalizeSpecialistName(source.specialistName, source.summary) || source.summary;
            await tx.specialist.upsert({
                where: { googleCalendarSourceId: source.id },
                create: {
                    name,
                    displayName: name,
                    specialty: "Oftalmologia",
                    color: normalizeHexColor(source.backgroundColor),
                    sortOrder: index,
                    isActive: true,
                    googleCalendarSourceId: source.id,
                },
                update: {
                    name,
                    displayName: name,
                    color: normalizeHexColor(source.backgroundColor),
                    sortOrder: index,
                    isActive: true,
                },
            });
        }
    });

    return prisma.specialist.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: { googleCalendarSource: true },
    });
}

export async function getGoogleCalendarBookingContext(): Promise<GoogleCalendarBookingContext> {
    const settings = await getGoogleSettingsWithSources();
    const summaries = settings.googleCalendars.map(mapSourceSummary);
    const selected = summaries.filter((source) => source.isSelected);
    const specialists = selected.filter((source) => source.isSpecialist && source.writable);
    const writeTarget =
        selected.find((source) => source.isWriteTarget && source.writable) ||
        selected.find((source) => source.isPrimary && source.writable) ||
        selected.find((source) => source.writable) ||
        null;
    const availabilitySources = selected.filter((source) => source.blocksAvailability);

    return {
        connected: hasGoogleConnection(settings),
        writeTarget,
        specialists,
        availabilitySources: availabilitySources.length > 0
            ? availabilitySources
            : writeTarget
                ? [writeTarget]
                : [],
        allSources: summaries,
    };
}

export async function findGoogleSpecialistByMention(text: string) {
    const bookingContext = await getGoogleCalendarBookingContext();
    const normalizedText = normalizeSearchValue(text);
    if (!normalizedText) return null;

    return (
        bookingContext.specialists.find((source) => {
            const summary = normalizeSearchValue(source.summary);
            const specialistName = normalizeSearchValue(source.specialistName);
            return Boolean(summary && normalizedText.includes(summary)) ||
                Boolean(specialistName && normalizedText.includes(specialistName));
        }) || null
    );
}

export function getPublicAppBaseUrl(fallbackOrigin?: string) {
    const candidates = [process.env.APP_BASE_URL, process.env.AUTH_URL, fallbackOrigin];

    for (const candidate of candidates) {
        if (!candidate) continue;
        try {
            return new URL(candidate).toString();
        } catch {
            continue;
        }
    }

    throw new Error("No se pudo resolver la URL publica del CRM para Google Calendar.");
}

export function getGoogleCalendarRedirectUri(fallbackOrigin?: string) {
    return new URL("/api/google-calendar/callback", getPublicAppBaseUrl(fallbackOrigin)).toString();
}

export async function getGoogleCalendarAuthUrl(redirectUri: string, state?: string) {
    const settings = await getSystemSettingsOrDefaults();
    if (!hasGoogleConfig(settings)) {
        throw new Error("Primero configura Google Client ID y Google Client Secret.");
    }

    const params = new URLSearchParams({
        client_id: settings.googleClientId || "",
        redirect_uri: redirectUri,
        response_type: "code",
        scope: `${GOOGLE_CALENDAR_SCOPE} openid email`,
        access_type: "offline",
        include_granted_scopes: "true",
        prompt: "select_account consent",
    });

    if (state) {
        params.set("state", state);
    }

    return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export async function completeGoogleCalendarOAuth(code: string, redirectUri: string) {
    const settings = await getSystemSettingsOrDefaults();
    if (!settings.id || !hasGoogleConfig(settings)) {
        throw new Error("Faltan las credenciales de Google Calendar.");
    }

    const body = new URLSearchParams({
        code,
        client_id: settings.googleClientId || "",
        client_secret: settings.googleClientSecret || "",
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
    });

    const tokens = await fetchGoogleJson<TokenResponse>(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
    });

    await updateGoogleTokens(settings.id, tokens);

    const profileResponse = await fetch(GOOGLE_USERINFO_URL, {
        headers: {
            Authorization: `Bearer ${tokens.access_token}`,
        },
    });
    const profile = profileResponse.ok
        ? await profileResponse.json() as { email?: string }
        : {};

    await prisma.$transaction(async (tx) => {
        await tx.systemSettings.update({
            where: { id: settings.id },
            data: {
                googleConnectedEmail: profile.email || null,
                googleSyncToken: null,
                googleLastSyncedAt: null,
            },
        });

        await tx.googleCalendarSource.updateMany({
            where: { systemSettingsId: settings.id },
            data: {
                syncToken: null,
                lastSyncedAt: null,
            },
        });
    });

    await discoverGoogleCalendarSources();

    return {
        email: profile.email || null,
    };
}

export async function disconnectGoogleCalendar() {
    const settings = await prisma.systemSettings.findFirst();
    if (!settings?.id) return;

    await prisma.$transaction(async (tx) => {
        await tx.googleCalendarSource.deleteMany({
            where: { systemSettingsId: settings.id },
        });

        await tx.systemSettings.update({
            where: { id: settings.id },
            data: {
                googleAccessToken: null,
                googleRefreshToken: null,
                googleTokenExpiresAt: null,
                googleConnectedEmail: null,
                googleSyncToken: null,
                googleLastSyncedAt: null,
            },
        });
    });
}

export async function syncAppointmentToGoogleCalendar(appointmentId: string) {
    const settings = await getGoogleSettingsWithSources();
    if (!hasGoogleConnection(settings)) return;

    const appointment = await prisma.appointment.findUnique({
        where: { id: appointmentId },
        include: {
            specialist: {
                include: {
                    googleCalendarSource: true,
                },
            },
        },
    });
    if (!appointment) return;

    const targetSource =
        (appointment.specialist?.googleCalendarSource &&
        appointment.specialist.googleCalendarSource.isSelected &&
        isCalendarWritable(appointment.specialist.googleCalendarSource.accessRole)
            ? appointment.specialist.googleCalendarSource
            : null) ||
        (appointment.googleCalendarId
            ? settings.googleCalendars.find((source) => source.calendarId === appointment.googleCalendarId)
            : null) ||
        (appointment.specialistName
            ? settings.googleCalendars.find((source) =>
                source.isSelected &&
                source.isSpecialist &&
                isCalendarWritable(source.accessRole) &&
                normalizeSearchValue(source.specialistName || source.summary) === normalizeSearchValue(appointment.specialistName),
            )
            : null) ||
        resolveWriteTargetSource(settings.googleCalendars, settings.googleCalendarId);

    const targetCalendarId = targetSource?.calendarId || getCalendarId(settings.googleCalendarId);
    const payload = buildGoogleCalendarEventPayload(appointment, settings.businessTimeZone);
    const wantsMeet = ["virtual", "hibrida"].includes(appointment.visitMode || "") && appointment.meetStatus === "requested" && !appointment.meetLink;
    const shouldMoveEvent =
        Boolean(appointment.googleEventId) &&
        Boolean(appointment.googleCalendarId) &&
        appointment.googleCalendarId !== targetCalendarId;

    if (shouldMoveEvent && appointment.googleCalendarId && appointment.googleEventId) {
        await deleteGoogleEventFromCalendar(appointment.googleCalendarId, appointment.googleEventId);
    }

    const { data } = appointment.googleEventId && !shouldMoveEvent
        ? await googleCalendarRequest<GoogleCalendarEvent>(
            `/calendars/${encodeURIComponent(targetCalendarId)}/events/${encodeURIComponent(appointment.googleEventId)}${wantsMeet ? "?conferenceDataVersion=1" : ""}`,
            {
                method: "PUT",
                body: JSON.stringify(payload),
            },
        )
        : await googleCalendarRequest<GoogleCalendarEvent>(
            `/calendars/${encodeURIComponent(targetCalendarId)}/events${wantsMeet ? "?conferenceDataVersion=1" : ""}`,
            {
                method: "POST",
                body: JSON.stringify(payload),
            },
        );

    if (data?.id) {
        const linkedSpecialist = targetSource?.isSpecialist
            ? await prisma.specialist.findFirst({
                where: {
                    googleCalendarSourceId: targetSource.id,
                    isActive: true,
                },
                select: { id: true },
            })
            : null;

        const meetLink = extractMeetLink(data) || appointment.meetLink || null;
        await prisma.appointment.update({
            where: { id: appointment.id },
            data: {
                googleEventId: data.id,
                googleCalendarId: targetCalendarId,
                googleCalendarName: targetSource?.summary || appointment.googleCalendarName || targetCalendarId,
                googleCalendarColor: normalizeHexColor(targetSource?.backgroundColor),
                specialistName: targetSource?.isSpecialist
                    ? normalizeSpecialistName(targetSource.specialistName, targetSource.summary)
                    : appointment.specialistName || null,
                specialistId: linkedSpecialist?.id || appointment.specialistId || null,
                meetLink,
                meetStatus: meetLink ? "generated" : appointment.meetStatus,
                googleEventUpdatedAt: data.updated ? new Date(data.updated) : null,
            },
        });
    }
}

export async function deleteAppointmentFromGoogleCalendar(appointmentId: string) {
    const settings = await getGoogleSettingsWithSources();
    if (!hasGoogleConnection(settings)) return;

    const appointment = await prisma.appointment.findUnique({
        where: { id: appointmentId },
        select: { googleEventId: true, googleCalendarId: true },
    });

    if (!appointment?.googleEventId) return;

    const calendarId = appointment.googleCalendarId || getCalendarId(settings.googleCalendarId);
    await deleteGoogleEventFromCalendar(calendarId, appointment.googleEventId);
}

export async function syncGoogleCalendarToCrm(force = false) {
    const settings = await getGoogleSettingsWithSources();
    if (!hasGoogleConnection(settings) || !settings.id) {
        return { synced: false, imported: 0 };
    }

    if (settings.googleCalendars.length === 0) {
        await discoverGoogleCalendarSources();
    }

    const refreshedSettings = await getGoogleSettingsWithSources();
    const importSources = refreshedSettings.googleCalendars.filter(
        (source) => source.isSelected && source.importToCrm,
    );

    if (importSources.length === 0) {
        return { synced: false, imported: 0 };
    }

    if (
        !force &&
        refreshedSettings.googleLastSyncedAt &&
        refreshedSettings.googleLastSyncedAt.getTime() > Date.now() - SYNC_THROTTLE_MS
    ) {
        return { synced: false, imported: 0 };
    }

    let imported = 0;

    for (const source of importSources) {
        let result;
        try {
            result = await listGoogleCalendarEvents(source);
        } catch (error) {
            const message = error instanceof Error ? error.message : "";
            if (source.syncToken && message.includes("(410)")) {
                await prisma.googleCalendarSource.update({
                    where: { id: source.id },
                    data: { syncToken: null },
                });

                result = await listGoogleCalendarEvents({
                    ...source,
                    syncToken: null,
                });
            } else {
                throw error;
            }
        }

        for (const event of result.events) {
            await applyGoogleEventToCrm(event, source);
        }

        imported += result.events.length;

        await prisma.googleCalendarSource.update({
            where: { id: source.id },
            data: {
                syncToken: result.nextSyncToken || source.syncToken,
                lastSyncedAt: new Date(),
            },
        });
    }

    await prisma.systemSettings.update({
        where: { id: refreshedSettings.id },
        data: {
            googleLastSyncedAt: new Date(),
        },
    });

    return {
        synced: true,
        imported,
    };
}
