import { shiftDateKey } from "./business-hours.ts";
import { validCalendarDateKey } from "./date-key.ts";

/** A complete month grid and adjacent weeks; navigation can request any month. */
export function calendarQueryWindow(day: string) {
    if (!validCalendarDateKey(day)) throw new Error("Fecha de agenda inválida.");
    const first = `${day.slice(0, 7)}-01`;
    const reference = new Date(`${first}T12:00:00Z`);
    reference.setUTCMonth(reference.getUTCMonth() + 1);
    const next = reference.toISOString().slice(0, 10);
    return { start: shiftDateKey(first, -7), end: shiftDateKey(next, 14) };
}
