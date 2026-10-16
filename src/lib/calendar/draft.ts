import {
  getOperationDateKey,
  operationDateTimeToUtc,
  timeToOperationInputValue,
} from "../operation-dates.ts";

import { validCalendarDateKey } from "./date-key.ts";
export { validCalendarDateKey } from "./date-key.ts";

export function resolveDraftTimes({
  dateKey,
  time,
  duration,
  timeZone,
  original,
}: {
  dateKey: string;
  time: string;
  duration: number;
  timeZone: string;
  original?: { start: Date; end: Date } | null;
}) {
  if (
    !validCalendarDateKey(dateKey) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > 1440
  ) {
    throw new Error("Revisa la fecha, hora y duración de la cita.");
  }
  const unchanged = Boolean(
    original &&
      getOperationDateKey(original.start, timeZone) === dateKey &&
      timeToOperationInputValue(original.start, timeZone) === time &&
      (original.end.getTime() - original.start.getTime()) / 60000 === duration,
  );
  const start =
    unchanged && original
      ? original.start
      : operationDateTimeToUtc(dateKey, time, timeZone);
  const end =
    unchanged && original
      ? original.end
      : new Date(start.getTime() + duration * 60000);
  return { start, end, unchanged };
}

export function appointmentsOnDay<T extends { startTime: Date | string }>(
  appointments: T[],
  dateKey: string,
  timeZone: string,
) {
  return appointments
    .filter(
      (appointment) =>
        getOperationDateKey(appointment.startTime, timeZone) === dateKey,
    )
    .sort(
      (a, b) =>
        new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
    );
}
