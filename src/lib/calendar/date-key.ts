export function validCalendarDateKey(value: string | null | undefined, minYear = 2000, maxYear = 2100) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= minYear &&
    year <= maxYear &&
    date.toISOString().slice(0, 10) === value
    ? value
    : null;
}
