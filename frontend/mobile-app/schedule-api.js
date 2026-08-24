function dateKey(value, timezone) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function buildMonthGrid(month) {
  const year = month.getUTCFullYear();
  const monthIndex = month.getUTCMonth();
  const firstDay = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return Array.from({ length: firstDay + days }, (_, index) => {
    if (index < firstDay) return { dateKey: "", day: null };
    const day = index - firstDay + 1;
    return { dateKey: `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`, day };
  });
}

function filterSchedulesForMonth(schedules, monthKey, timezone) {
  return (Array.isArray(schedules) ? schedules : []).filter((schedule) => dateKey(schedule.starts_at, timezone).startsWith(monthKey));
}

function selectDefaultCalendar(body) {
  const owned = Array.isArray(body?.owned) ? body.owned : [];
  return owned.find((calendar) => calendar.isDefault) || owned[0] || null;
}

function buildSchedulePayload(input) {
  const title = String(input.title || "").trim();
  if (!title || !input.calendarId || !input.timezone) throw new Error("일정 제목, 기본 달력, 시간대가 필요합니다.");
  const start = new Date(input.startsAt);
  const end = new Date(input.endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) throw new Error("종료 시간은 시작 시간보다 늦어야 합니다.");
  return { title, startsAt: input.startsAt, endsAt: input.endsAt, description: String(input.description || ""), location: String(input.location || ""), attendeeUserIds: Array.isArray(input.attendeeUserIds) ? input.attendeeUserIds.filter(Boolean) : [], repeatType: input.repeatType || "none", repeatUntil: input.repeatUntil || null, alertMinutes: Number.isInteger(input.alertMinutes) ? input.alertMinutes : 10, timezone: input.timezone, calendarId: input.calendarId };
}

module.exports = { buildMonthGrid, filterSchedulesForMonth, selectDefaultCalendar, buildSchedulePayload, dateKey };
