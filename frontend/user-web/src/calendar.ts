import type { WorkspaceSchedule } from "./api";

export type CalendarView = "month" | "week" | "day" | "list";
export type CalendarRange = { start: Date; end: Date };

type DateParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function partsInTimeZone(date: Date, timezone: string): DateParts {
  const values = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(values.find((item) => item.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

function timezoneOffsetMs(date: Date, timezone: string): number {
  const parts = partsInTimeZone(date, timezone);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - date.getTime();
}

export function zonedDate(parts: Omit<DateParts, "hour" | "minute" | "second"> & Partial<Pick<DateParts, "hour" | "minute" | "second">>, timezone = "Asia/Seoul"): Date {
  const target = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour ?? 0, parts.minute ?? 0, parts.second ?? 0);
  let candidate = new Date(target);
  for (let index = 0; index < 3; index += 1) candidate = new Date(target - timezoneOffsetMs(candidate, timezone));
  return candidate;
}

function shiftedParts(date: Date, amount: number, unit: "day" | "month", timezone: string): DateParts {
  const parts = partsInTimeZone(date, timezone);
  if (unit === "month") {
    const targetMonthIndex = parts.year * 12 + (parts.month - 1) + amount;
    const year = Math.floor(targetMonthIndex / 12);
    const monthIndex = ((targetMonthIndex % 12) + 12) % 12;
    const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
    return { ...parts, year, month: monthIndex + 1, day: Math.min(parts.day, lastDay) };
  }
  const carrier = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second));
  carrier.setUTCDate(carrier.getUTCDate() + amount);
  return { year: carrier.getUTCFullYear(), month: carrier.getUTCMonth() + 1, day: carrier.getUTCDate(), hour: carrier.getUTCHours(), minute: carrier.getUTCMinutes(), second: carrier.getUTCSeconds() };
}

export function addZonedDays(date: Date, amount: number, timezone = "Asia/Seoul"): Date {
  return zonedDate(shiftedParts(date, amount, "day", timezone), timezone);
}

export function getCalendarRange(view: CalendarView, baseDate: Date, timezone = "Asia/Seoul"): CalendarRange {
  const parts = partsInTimeZone(baseDate, timezone);
  if (view === "month" || view === "list") {
    const start = zonedDate({ year: parts.year, month: parts.month, day: 1 }, timezone);
    return { start, end: zonedDate({ year: parts.month === 12 ? parts.year + 1 : parts.year, month: parts.month === 12 ? 1 : parts.month + 1, day: 1 }, timezone) };
  }
  const dayStart = zonedDate({ year: parts.year, month: parts.month, day: parts.day }, timezone);
  if (view === "day") return { start: dayStart, end: addZonedDays(dayStart, 1, timezone) };
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  const start = addZonedDays(dayStart, -weekday, timezone);
  return { start, end: addZonedDays(start, 7, timezone) };
}

export function navigateCalendarDate(baseDate: Date, view: CalendarView, direction: -1 | 1, timezone = "Asia/Seoul"): Date {
  const unit = view === "month" || view === "list" ? "month" : "day";
  const amount = view === "week" ? direction * 7 : direction;
  return zonedDate(shiftedParts(baseDate, amount, unit, timezone), timezone);
}

export function eventIntersectsRange(event: WorkspaceSchedule, range: CalendarRange): boolean {
  const start = new Date(event.starts_at).getTime();
  const end = new Date(event.ends_at).getTime();
  return Number.isFinite(start) && Number.isFinite(end) && start < range.end.getTime() && end > range.start.getTime();
}

export function filterCalendarEvents(events: WorkspaceSchedule[], range: CalendarRange, query = ""): WorkspaceSchedule[] {
  const needle = query.trim().toLocaleLowerCase();
  return events
    .filter((event) => eventIntersectsRange(event, range))
    .filter((event) => !needle || `${event.title} ${event.description}`.trim().toLocaleLowerCase().includes(needle))
    .sort((left, right) => new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime());
}

export function formatCalendarRangeTitle(view: CalendarView, baseDate: Date, locale = "ko-KR", timezone = "Asia/Seoul"): string {
  if (view === "month" || view === "list") return new Intl.DateTimeFormat(locale, { timeZone: timezone, year: "numeric", month: "long" }).format(baseDate);
  if (view === "day") return new Intl.DateTimeFormat(locale, { timeZone: timezone, year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(baseDate);
  const range = getCalendarRange("week", baseDate, timezone);
  const end = new Date(range.end.getTime() - 1);
  const startLabel = new Intl.DateTimeFormat(locale, { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(range.start);
  const endLabel = new Intl.DateTimeFormat(locale, { timeZone: timezone, month: "2-digit", day: "2-digit" }).format(end);
  return `${startLabel} – ${endLabel}`;
}

export function calendarDays(view: CalendarView, baseDate: Date, timezone = "Asia/Seoul"): Date[] {
  const range = getCalendarRange(view, baseDate, timezone);
  if (view === "day") return [range.start];
  if (view === "week") return Array.from({ length: 7 }, (_, index) => addZonedDays(range.start, index, timezone));
  const parts = partsInTimeZone(range.start, timezone);
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, 1)).getUTCDay();
  const gridStart = addZonedDays(range.start, -weekday, timezone);
  return Array.from({ length: 42 }, (_, index) => addZonedDays(gridStart, index, timezone));
}

export function eventsForDay(events: WorkspaceSchedule[], day: Date, timezone = "Asia/Seoul"): WorkspaceSchedule[] {
  return events.filter((event) => eventIntersectsRange(event, { start: day, end: addZonedDays(day, 1, timezone) }));
}

export function dateKey(date: Date, timezone = "Asia/Seoul"): string {
  const parts = partsInTimeZone(date, timezone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}
