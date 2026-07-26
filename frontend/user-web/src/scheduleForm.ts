import type { WorkspaceSchedule } from "./api";

export type RepeatType = "none" | "daily" | "weekly" | "monthly";
export type ScheduleDraft = {
  scheduleId: string | null;
  title: string;
  startsAt: string;
  endsAt: string;
  location: string;
  attendeeUserIds: string[];
  repeatType: RepeatType;
  repeatUntil: string;
  alertMinutes: number[];
  description: string;
  timezone: string;
};

const localPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function localParts(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(value);
  const take = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: take("year"), month: take("month"), day: take("day"), hour: take("hour"), minute: take("minute"), second: take("second") };
}

export function utcToLocalDateTime(value: string | Date, timezone: string): string {
  const date = value instanceof Date ? value : new Date(value);
  const part = localParts(date, timezone);
  return `${part.year}-${String(part.month).padStart(2, "0")}-${String(part.day).padStart(2, "0")}T${String(part.hour).padStart(2, "0")}:${String(part.minute).padStart(2, "0")}`;
}

export function localDateTimeToUtc(value: string, timezone: string): string {
  const match = localPattern.exec(value);
  if (!match) throw new Error("날짜와 시간을 확인하세요.");
  const expected = match.slice(1).map(Number);
  const wallClock = Date.UTC(expected[0], expected[1] - 1, expected[2], expected[3], expected[4]);
  let candidate = wallClock;
  for (let index = 0; index < 3; index += 1) {
    const part = localParts(new Date(candidate), timezone);
    const rendered = Date.UTC(part.year, part.month - 1, part.day, part.hour, part.minute, part.second);
    candidate += wallClock - rendered;
  }
  const result = new Date(candidate);
  const roundTrip = utcToLocalDateTime(result, timezone);
  if (roundTrip !== value) throw new Error("선택한 시간대에 존재하지 않는 현지 시각입니다.");
  return result.toISOString();
}

function localDate(value: string): string { return value.slice(0, 10); }

function addMonthsClamped(value: string, months: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const monthIndex = month - 1 + months;
  const targetYear = year + Math.floor(monthIndex / 12);
  const targetMonth = monthIndex % 12 + 1;
  const targetDay = Math.min(day, daysInMonth(targetYear, targetMonth));
  return `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
}

export function createScheduleDraft(schedule: WorkspaceSchedule | null, timezone: string, now = new Date()): ScheduleDraft {
  if (schedule) return {
    scheduleId: schedule.id, title: schedule.title,
    startsAt: utcToLocalDateTime(schedule.starts_at, schedule.timezone || timezone),
    endsAt: utcToLocalDateTime(schedule.ends_at, schedule.timezone || timezone),
    location: schedule.location ?? "", attendeeUserIds: schedule.attendees.map((item) => item.userId),
    repeatType: schedule.repeatType, repeatUntil: schedule.repeatUntil ?? "",
    alertMinutes: [...schedule.alertMinutes], description: schedule.description, timezone: schedule.timezone || timezone,
  };
  const rounded = new Date(Math.ceil(now.getTime() / 1_800_000) * 1_800_000);
  const end = new Date(rounded.getTime() + 3_600_000);
  const startsAt = utcToLocalDateTime(rounded, timezone);
  return { scheduleId: null, title: "", startsAt, endsAt: utcToLocalDateTime(end, timezone), location: "", attendeeUserIds: [], repeatType: "none", repeatUntil: addMonthsClamped(localDate(startsAt), 3), alertMinutes: [], description: "", timezone };
}

export function scheduleDraftPayload(draft: ScheduleDraft) {
  if (!draft.title.trim()) throw new Error("일정 제목을 입력하세요.");
  const startsAt = localDateTimeToUtc(draft.startsAt, draft.timezone);
  const endsAt = localDateTimeToUtc(draft.endsAt, draft.timezone);
  if (new Date(endsAt) <= new Date(startsAt)) throw new Error("종료 시각은 시작 시각보다 뒤여야 합니다.");
  if (draft.repeatType !== "none" && (!draft.repeatUntil || draft.repeatUntil < localDate(draft.startsAt))) throw new Error("반복 종료일을 확인하세요.");
  return { title: draft.title.trim(), startsAt, endsAt, description: draft.description.trim(), location: draft.location.trim(), attendeeUserIds: draft.attendeeUserIds, repeatType: draft.repeatType, repeatUntil: draft.repeatType === "none" ? null : draft.repeatUntil, alertMinutes: [...draft.alertMinutes].sort((a, b) => a - b), timezone: draft.timezone };
}

function daysInMonth(year: number, month: number): number { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }

export type ScheduleOccurrence = WorkspaceSchedule & { occurrence_key: string };
export function expandScheduleOccurrences(schedule: WorkspaceSchedule, range: { start: Date; end: Date }): ScheduleOccurrence[] {
  const firstStart = new Date(schedule.starts_at);
  const duration = new Date(schedule.ends_at).getTime() - firstStart.getTime();
  const originalLocal = utcToLocalDateTime(firstStart, schedule.timezone);
  const match = localPattern.exec(originalLocal);
  if (!match) return [];
  const original = match.slice(1).map(Number);
  const until = schedule.repeatType === "none" ? originalLocal.slice(0, 10) : schedule.repeatUntil;
  const result: ScheduleOccurrence[] = [];
  for (let index = 0; index < 3700; index += 1) {
    let year = original[0], month = original[1], day = original[2];
    if (schedule.repeatType === "daily") {
      const shifted = new Date(Date.UTC(year, month - 1, day + index)); year = shifted.getUTCFullYear(); month = shifted.getUTCMonth() + 1; day = shifted.getUTCDate();
    } else if (schedule.repeatType === "weekly") {
      const shifted = new Date(Date.UTC(year, month - 1, day + index * 7)); year = shifted.getUTCFullYear(); month = shifted.getUTCMonth() + 1; day = shifted.getUTCDate();
    } else if (schedule.repeatType === "monthly") {
      const monthIndex = month - 1 + index; year += Math.floor(monthIndex / 12); month = monthIndex % 12 + 1; day = Math.min(day, daysInMonth(year, month));
    } else if (index > 0) break;
    const dateOnly = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (until && dateOnly > until) break;
    const local = `${dateOnly}T${String(original[3]).padStart(2, "0")}:${String(original[4]).padStart(2, "0")}`;
    const startsAt = new Date(localDateTimeToUtc(local, schedule.timezone));
    const endsAt = new Date(startsAt.getTime() + duration);
    if (startsAt >= range.end && schedule.repeatType !== "none") break;
    if (endsAt > range.start && startsAt < range.end) result.push({ ...schedule, starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), occurrence_key: `${schedule.id}:${startsAt.toISOString()}` });
  }
  return result;
}
