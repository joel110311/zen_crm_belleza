import {
    DEFAULT_BUSINESS_TIME_ZONE,
    getBusinessDateKey,
    shiftDateKey,
    zonedDateTimeToUtc,
} from "@/lib/calendar/business-hours";

export const DEFAULT_OPERATION_TIME_ZONE = DEFAULT_BUSINESS_TIME_ZONE;
export const DEFAULT_OPERATION_LOCALE = "es-MX";

export function getOperationDateKey(
    value: Date | string | null | undefined = new Date(),
    timeZone = DEFAULT_OPERATION_TIME_ZONE,
) {
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
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

export function getOperationTodayKey(timeZone = DEFAULT_OPERATION_TIME_ZONE) {
    return getOperationDateKey(new Date(), timeZone);
}

export function formatDateInOperationZone(
    value: Date | string | null | undefined,
    locale = DEFAULT_OPERATION_LOCALE,
    timeZone = DEFAULT_OPERATION_TIME_ZONE,
    options?: Intl.DateTimeFormatOptions,
) {
    if (!value) return "";
    const date = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
        ? operationDateReference(value.trim(), timeZone)
        : value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";

    return new Intl.DateTimeFormat(locale, {
        timeZone,
        day: "numeric",
        month: "long",
        year: "numeric",
        ...options,
    }).format(date);
}

export function formatTimeInOperationZone(
    value: Date | string | null | undefined,
    locale = DEFAULT_OPERATION_LOCALE,
    timeZone = DEFAULT_OPERATION_TIME_ZONE,
    options?: Intl.DateTimeFormatOptions,
) {
    if (!value) return "";
    const date = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
        ? operationDateReference(value.trim(), timeZone)
        : value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";

    return new Intl.DateTimeFormat(locale, {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
        ...options,
    }).format(date);
}

export function formatDateTimeInOperationZone(
    value: Date | string | null | undefined,
    locale = DEFAULT_OPERATION_LOCALE,
    timeZone = DEFAULT_OPERATION_TIME_ZONE,
    options?: Intl.DateTimeFormatOptions,
) {
    if (!value) return "";
    const date = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
        ? operationDateReference(value.trim(), timeZone)
        : value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";

    return new Intl.DateTimeFormat(locale, {
        timeZone,
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        ...options,
    }).format(date);
}

export function getLocalCalendarDateKey(date: Date) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0"),
    ].join("-");
}

export function dateKeyToLocalNoonDate(dateKey: string) {
    const [year, month, day] = dateKey.split("-").map(Number);
    return new Date(year, month - 1, day, 12, 0, 0, 0);
}

export function operationDateReference(dateKey: string, timeZone = DEFAULT_OPERATION_TIME_ZONE) {
    return zonedDateTimeToUtc(dateKey, "12:00", timeZone);
}

export function dateToOperationInputValue(
    value: Date | string | null | undefined,
    timeZone = DEFAULT_OPERATION_TIME_ZONE,
) {
    if (!value) return "";
    return getOperationDateKey(value, timeZone);
}

export function dateTimeToOperationInputValue(
    value: Date | string | null | undefined,
    timeZone = DEFAULT_OPERATION_TIME_ZONE,
) {
    if (!value) return "";
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";

    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
        parts.find((entry) => entry.type === type)?.value || "";

    return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

export function timeToOperationInputValue(
    value: Date | string | null | undefined,
    timeZone = DEFAULT_OPERATION_TIME_ZONE,
) {
    if (!value) return "";
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";

    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
        parts.find((entry) => entry.type === type)?.value || "";

    return `${part("hour")}:${part("minute")}`;
}

export function operationInstantToLocalWallDate(
    value: Date | string,
    timeZone = DEFAULT_OPERATION_TIME_ZONE,
) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return new Date();

    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
    }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
        Number(parts.find((entry) => entry.type === type)?.value || "0");

    return new Date(
        part("year"),
        part("month") - 1,
        part("day"),
        part("hour"),
        part("minute"),
        part("second"),
        0,
    );
}

export function localWallDateToOperationUtc(
    value: Date,
    timeZone = DEFAULT_OPERATION_TIME_ZONE,
) {
    return operationDateTimeToUtc(getLocalCalendarDateKey(value), localTimeInputValue(value), timeZone);
}

function localTimeInputValue(date: Date) {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function operationInputValueToUtc(
    value: string,
    timeZone = DEFAULT_OPERATION_TIME_ZONE,
) {
    const [dateKey, time = "00:00"] = value.split("T");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey || "")) return null;
    if (!/^\d{2}:\d{2}/.test(time || "")) return null;
    return zonedDateTimeToUtc(dateKey, time.slice(0, 5), timeZone);
}

export function operationDateTimeToUtc(
    dateKey: string,
    time: string,
    timeZone = DEFAULT_OPERATION_TIME_ZONE,
) {
    return zonedDateTimeToUtc(dateKey, time, timeZone);
}

export function formatRelativeOperationDate(
    value: Date | string | null | undefined,
    locale = DEFAULT_OPERATION_LOCALE,
    timeZone = DEFAULT_OPERATION_TIME_ZONE,
) {
    if (!value) return "";
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";

    const targetKey = getOperationDateKey(date, timeZone);
    const todayKey = getOperationTodayKey(timeZone);
    const yesterdayKey = shiftDateKey(todayKey, -1);

    if (targetKey === todayKey) {
        return formatTimeInOperationZone(date, locale, timeZone, {
            hour: "numeric",
            minute: "2-digit",
        });
    }

    if (targetKey === yesterdayKey) return "Ayer";

    const sixDaysAgo = shiftDateKey(todayKey, -6);
    if (targetKey >= sixDaysAgo && targetKey < todayKey) {
        return formatDateInOperationZone(date, locale, timeZone, { weekday: "long" }).toLowerCase();
    }

    return formatDateInOperationZone(date, locale, timeZone, {
        day: "numeric",
        month: "numeric",
        year: "numeric",
    });
}

export function formatOperationDayLabel(
    dateKey: string,
    locale = DEFAULT_OPERATION_LOCALE,
    timeZone = DEFAULT_OPERATION_TIME_ZONE,
    options?: Intl.DateTimeFormatOptions,
) {
    return formatDateInOperationZone(
        operationDateReference(dateKey, timeZone),
        locale,
        timeZone,
        options || { weekday: "long", day: "numeric", month: "long" },
    );
}
