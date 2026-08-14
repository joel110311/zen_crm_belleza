export const DEFAULT_BUSINESS_TIME_ZONE = "America/Mexico_City";
export const DEFAULT_BUSINESS_HOURS_START = "09:00";
export const DEFAULT_BUSINESS_HOURS_END = "18:00";
export const DEFAULT_APPOINTMENT_DURATION_MINUTES = 30;

export const BUSINESS_DAY_KEYS = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
] as const;

export type BusinessDayKey = (typeof BUSINESS_DAY_KEYS)[number];

export const BUSINESS_DAY_LABELS: Record<BusinessDayKey, string> = {
    monday: "Lunes",
    tuesday: "Martes",
    wednesday: "Miercoles",
    thursday: "Jueves",
    friday: "Viernes",
    saturday: "Sabado",
    sunday: "Domingo",
};

export const BUSINESS_DAY_SHORT_LABELS: Record<BusinessDayKey, string> = {
    monday: "Lun",
    tuesday: "Mar",
    wednesday: "Mie",
    thursday: "Jue",
    friday: "Vie",
    saturday: "Sab",
    sunday: "Dom",
};

type SettingsLike = {
    businessHoursStart?: string | null;
    businessHoursEnd?: string | null;
    businessTimeZone?: string | null;
    appointmentDurationMinutes?: number | null;
    businessWeeklySchedule?: unknown;
};

export type BusinessDaySchedule = {
    enabled: boolean;
    start: string;
    end: string;
};

export type BusinessWeeklySchedule = Record<BusinessDayKey, BusinessDaySchedule>;

export type BusinessHoursConfig = {
    start: string;
    end: string;
    timeZone: string;
    defaultDurationMinutes: number;
    weeklySchedule: BusinessWeeklySchedule;
};

type TimeParts = {
    hours: number;
    minutes: number;
};

type DateParts = {
    year: number;
    month: number;
    day: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseTimeParts(value: string | null | undefined): TimeParts | null {
    if (!value) return null;

    const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

    return { hours, minutes };
}

function normalizeTime(value: string | null | undefined, fallback: string) {
    const parts = parseTimeParts(value);
    if (!parts) return fallback;
    return `${String(parts.hours).padStart(2, "0")}:${String(parts.minutes).padStart(2, "0")}`;
}

export function buildUniformBusinessWeeklySchedule(
    start = DEFAULT_BUSINESS_HOURS_START,
    end = DEFAULT_BUSINESS_HOURS_END,
    enabled = true,
): BusinessWeeklySchedule {
    const safeStart = normalizeTime(start, DEFAULT_BUSINESS_HOURS_START);
    const safeEnd = normalizeTime(end, DEFAULT_BUSINESS_HOURS_END);

    return BUSINESS_DAY_KEYS.reduce((schedule, dayKey) => {
        schedule[dayKey] = {
            enabled,
            start: safeStart,
            end: safeEnd,
        };
        return schedule;
    }, {} as BusinessWeeklySchedule);
}

function normalizeDaySchedule(
    value: unknown,
    fallback: BusinessDaySchedule,
): BusinessDaySchedule {
    if (!isRecord(value)) {
        return { ...fallback };
    }

    const enabled = typeof value.enabled === "boolean" ? value.enabled : fallback.enabled;
    const start = normalizeTime(typeof value.start === "string" ? value.start : null, fallback.start);
    const end = normalizeTime(typeof value.end === "string" ? value.end : null, fallback.end);

    if (timeToMinutes(end) <= timeToMinutes(start)) {
        return { ...fallback, enabled };
    }

    return {
        enabled,
        start,
        end,
    };
}

export function normalizeBusinessWeeklySchedule(
    value: unknown,
    fallbackStart = DEFAULT_BUSINESS_HOURS_START,
    fallbackEnd = DEFAULT_BUSINESS_HOURS_END,
): BusinessWeeklySchedule {
    const fallback = buildUniformBusinessWeeklySchedule(fallbackStart, fallbackEnd, true);

    if (!isRecord(value)) {
        return fallback;
    }

    return BUSINESS_DAY_KEYS.reduce((schedule, dayKey) => {
        schedule[dayKey] = normalizeDaySchedule(value[dayKey], fallback[dayKey]);
        return schedule;
    }, {} as BusinessWeeklySchedule);
}

function deriveSummaryRange(weeklySchedule: BusinessWeeklySchedule) {
    const enabledDays = BUSINESS_DAY_KEYS
        .map((dayKey) => weeklySchedule[dayKey])
        .filter((day) => day.enabled);

    if (enabledDays.length === 0) {
        return {
            start: DEFAULT_BUSINESS_HOURS_START,
            end: DEFAULT_BUSINESS_HOURS_END,
        };
    }

    const start = enabledDays.reduce((earliest, day) =>
        timeToMinutes(day.start) < timeToMinutes(earliest) ? day.start : earliest,
    enabledDays[0].start);

    const end = enabledDays.reduce((latest, day) =>
        timeToMinutes(day.end) > timeToMinutes(latest) ? day.end : latest,
    enabledDays[0].end);

    return { start, end };
}

export function normalizeBusinessHours(settings?: SettingsLike | null): BusinessHoursConfig {
    const fallbackStart = normalizeTime(settings?.businessHoursStart, DEFAULT_BUSINESS_HOURS_START);
    const fallbackEnd = normalizeTime(settings?.businessHoursEnd, DEFAULT_BUSINESS_HOURS_END);
    const weeklySchedule = normalizeBusinessWeeklySchedule(
        settings?.businessWeeklySchedule,
        fallbackStart,
        fallbackEnd,
    );
    const summaryRange = deriveSummaryRange(weeklySchedule);
    const safeDuration = Number.isFinite(settings?.appointmentDurationMinutes)
        ? Math.min(Math.max(Math.round(settings?.appointmentDurationMinutes || DEFAULT_APPOINTMENT_DURATION_MINUTES), 15), 180)
        : DEFAULT_APPOINTMENT_DURATION_MINUTES;

    return {
        start: summaryRange.start,
        end: summaryRange.end,
        timeZone: settings?.businessTimeZone?.trim() || DEFAULT_BUSINESS_TIME_ZONE,
        defaultDurationMinutes: safeDuration,
        weeklySchedule,
    };
}

export function timeToMinutes(value: string): number {
    const parts = parseTimeParts(value);
    if (!parts) return 0;
    return parts.hours * 60 + parts.minutes;
}

export function buildLocalTime(date: Date, value: string) {
    const parts = parseTimeParts(value);
    const target = new Date(date);

    if (!parts) {
        target.setHours(0, 0, 0, 0);
        return target;
    }

    target.setHours(parts.hours, parts.minutes, 0, 0);
    return target;
}

function getFormatter(timeZone: string) {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
    });
}

function partsFromDate(date: Date, timeZone: string): DateParts & TimeParts & { second: number } {
    const formatter = getFormatter(timeZone);
    const raw = formatter.formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
        Number(raw.find((entry) => entry.type === type)?.value || "0");

    return {
        year: part("year"),
        month: part("month"),
        day: part("day"),
        hours: part("hour"),
        minutes: part("minute"),
        second: part("second"),
    };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
    const parts = partsFromDate(date, timeZone);
    const asUtc = Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hours,
        parts.minutes,
        parts.second,
    );
    return asUtc - date.getTime();
}

export function getBusinessDateKey(date: Date, timeZone: string) {
    const parts = partsFromDate(date, timeZone);
    return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function normalizeBusinessDateKey(value?: string | Date | null, timeZone = DEFAULT_BUSINESS_TIME_ZONE) {
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
            return trimmed;
        }

        const parsed = new Date(trimmed);
        if (!Number.isNaN(parsed.getTime())) {
            return getBusinessDateKey(parsed, timeZone);
        }
    }

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return getBusinessDateKey(value, timeZone);
    }

    return getBusinessDateKey(new Date(), timeZone);
}

export function getBusinessDayKey(date: Date, timeZone: string): BusinessDayKey {
    const weekday = new Intl.DateTimeFormat("en-US", {
        timeZone,
        weekday: "long",
    }).format(date).toLowerCase();

    if (BUSINESS_DAY_KEYS.includes(weekday as BusinessDayKey)) {
        return weekday as BusinessDayKey;
    }

    return "monday";
}

export function shiftDateKey(dateKey: string, days: number) {
    const [year, month, day] = dateKey.split("-").map(Number);
    const base = new Date(Date.UTC(year, month - 1, day + days));
    return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, "0")}-${String(base.getUTCDate()).padStart(2, "0")}`;
}

export function businessDayBounds(date?: string | Date | null, timeZone = DEFAULT_BUSINESS_TIME_ZONE) {
    const dateKey = normalizeBusinessDateKey(date, timeZone);

    return {
        start: zonedDateTimeToUtc(dateKey, "00:00", timeZone),
        end: zonedDateTimeToUtc(shiftDateKey(dateKey, 1), "00:00", timeZone),
        dateKey,
        timeZone,
    };
}

export function businessDateRangeBounds(
    from?: string | Date | null,
    to?: string | Date | null,
    timeZone = DEFAULT_BUSINESS_TIME_ZONE,
) {
    const fromKey = normalizeBusinessDateKey(from, timeZone);
    const toKey = normalizeBusinessDateKey(to || fromKey, timeZone);
    const startKey = fromKey <= toKey ? fromKey : toKey;
    const endKey = fromKey <= toKey ? toKey : fromKey;

    return {
        start: zonedDateTimeToUtc(startKey, "00:00", timeZone),
        end: zonedDateTimeToUtc(shiftDateKey(endKey, 1), "00:00", timeZone),
        fromKey: startKey,
        toKey: endKey,
        timeZone,
    };
}

export function zonedDateTimeToUtc(dateKey: string, time: string, timeZone: string) {
    const [year, month, day] = dateKey.split("-").map(Number);
    const parsedTime = parseTimeParts(time) || parseTimeParts(DEFAULT_BUSINESS_HOURS_START)!;

    const guess = new Date(Date.UTC(year, month - 1, day, parsedTime.hours, parsedTime.minutes, 0, 0));
    const initialOffset = getTimeZoneOffsetMs(guess, timeZone);
    const adjusted = new Date(guess.getTime() - initialOffset);
    const correctedOffset = getTimeZoneOffsetMs(adjusted, timeZone);

    if (correctedOffset !== initialOffset) {
        return new Date(guess.getTime() - correctedOffset);
    }

    return adjusted;
}

export function formatTimeLabel(value: string, locale = "es-MX") {
    const parts = parseTimeParts(value);
    if (!parts) return value;

    const sampleDate = new Date(Date.UTC(2026, 0, 1, parts.hours, parts.minutes));
    return new Intl.DateTimeFormat(locale, {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZone: "UTC",
    }).format(sampleDate);
}

export function formatDateTimeInZone(
    date: Date,
    timeZone: string,
    locale = "es-MX",
    options?: Intl.DateTimeFormatOptions,
) {
    const formatterOptions = options
        ? { timeZone, ...options }
        : {
            timeZone,
            dateStyle: "full" as const,
            timeStyle: "short" as const,
        };

    return new Intl.DateTimeFormat(locale, formatterOptions).format(date);
}

export function getBusinessDayScheduleForDate(date: Date, config: BusinessHoursConfig) {
    const dayKey = getBusinessDayKey(date, config.timeZone);
    return {
        dayKey,
        schedule: config.weeklySchedule[dayKey],
    };
}

export function isBusinessDayOpen(date: Date, config: BusinessHoursConfig) {
    return getBusinessDayScheduleForDate(date, config).schedule.enabled;
}

export function businessBoundsForDate(date: Date, config: BusinessHoursConfig) {
    const dateKey = getBusinessDateKey(date, config.timeZone);
    const { dayKey, schedule } = getBusinessDayScheduleForDate(date, config);
    const startValue = schedule.enabled ? schedule.start : config.start;
    const endValue = schedule.enabled ? schedule.end : config.end;

    return {
        start: zonedDateTimeToUtc(dateKey, startValue, config.timeZone),
        end: zonedDateTimeToUtc(dateKey, endValue, config.timeZone),
        dateKey,
        dayKey,
        schedule,
        isOpen: schedule.enabled,
    };
}

export function isSameBusinessDate(a: Date, b: Date, timeZone: string) {
    return getBusinessDateKey(a, timeZone) === getBusinessDateKey(b, timeZone);
}

export function getCalendarVisibleRange(
    config: BusinessHoursConfig,
    currentDate: Date,
    scope: "day" | "week" = "week",
) {
    if (scope === "day") {
        const { schedule } = getBusinessDayScheduleForDate(currentDate, config);
        return {
            start: schedule.enabled ? schedule.start : config.start,
            end: schedule.enabled ? schedule.end : config.end,
            isClosed: !schedule.enabled,
        };
    }

    return {
        start: config.start,
        end: config.end,
        isClosed: false,
    };
}

export function formatBusinessScheduleLines(
    config: BusinessHoursConfig,
    locale = "es-MX",
) {
    return BUSINESS_DAY_KEYS.map((dayKey) => {
        const schedule = config.weeklySchedule[dayKey];
        if (!schedule.enabled) {
            return `- ${BUSINESS_DAY_LABELS[dayKey]}: cerrado`;
        }

        return `- ${BUSINESS_DAY_LABELS[dayKey]}: ${formatTimeLabel(schedule.start, locale)} - ${formatTimeLabel(schedule.end, locale)}`;
    }).join("\n");
}

export function formatBusinessScheduleSummary(
    config: BusinessHoursConfig,
    locale = "es-MX",
) {
    const groups: Array<{
        startDay: BusinessDayKey;
        endDay: BusinessDayKey;
        signature: string;
        schedule: BusinessDaySchedule;
    }> = [];

    for (const dayKey of BUSINESS_DAY_KEYS) {
        const schedule = config.weeklySchedule[dayKey];
        const signature = `${schedule.enabled ? "1" : "0"}:${schedule.start}:${schedule.end}`;
        const lastGroup = groups[groups.length - 1];

        if (lastGroup && lastGroup.signature === signature) {
            lastGroup.endDay = dayKey;
            continue;
        }

        groups.push({
            startDay: dayKey,
            endDay: dayKey,
            signature,
            schedule,
        });
    }

    return groups
        .map((group) => {
            const label =
                group.startDay === group.endDay
                    ? BUSINESS_DAY_SHORT_LABELS[group.startDay]
                    : `${BUSINESS_DAY_SHORT_LABELS[group.startDay]}-${BUSINESS_DAY_SHORT_LABELS[group.endDay]}`;

            if (!group.schedule.enabled) {
                return `${label} cerrado`;
            }

            return `${label} ${formatTimeLabel(group.schedule.start, locale)} - ${formatTimeLabel(group.schedule.end, locale)}`;
        })
        .join(" | ");
}

export function getNextOpenDate(
    fromDate: Date,
    config: BusinessHoursConfig,
    maxDaysToCheck = 14,
) {
    for (let offset = 0; offset < maxDaysToCheck; offset += 1) {
        const candidate = new Date(fromDate);
        candidate.setDate(candidate.getDate() + offset);
        if (isBusinessDayOpen(candidate, config)) {
            return candidate;
        }
    }

    return new Date(fromDate);
}
