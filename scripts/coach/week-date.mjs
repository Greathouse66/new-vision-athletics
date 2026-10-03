// Use Minot's named zone rather than the coach's browser zone or a fixed GMT offset.
export function currentOrNextMondayChicago(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const local = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const date = new Date(Date.UTC(Number(local.year), Number(local.month) - 1, Number(local.day)));
  const isoWeekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + ((8 - isoWeekday) % 7));
  return date.toISOString().slice(0, 10);
}

export function isMondayDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day && date.getUTCDay() === 1;
}

export function classDatesForWeek(monday) {
  if (!isMondayDate(monday)) return [];
  const start = new Date(`${monday}T00:00:00Z`);
  return Array.from({ length: 5 }, (_, offset) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  });
}
