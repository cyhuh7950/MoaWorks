const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildMonthGrid,
  filterSchedulesForMonth,
  selectDefaultCalendar,
  buildSchedulePayload,
} = require("../schedule-api.js");

test("월간 grid는 일요일 선행 빈 칸과 해당 월 날짜를 만든다", () => {
  const grid = buildMonthGrid(new Date("2026-08-01T00:00:00Z"));
  assert.equal(grid[0].dateKey, "");
  assert.equal(grid[6].dateKey, "2026-08-01");
  assert.equal(grid.filter((cell) => cell.dateKey).length, 31);
});

test("서버 일정은 현재 월에만 배치하고 잘못된 날짜는 제외한다", () => {
  const items = filterSchedulesForMonth([
    { id: "in", starts_at: "2026-08-03T01:00:00Z" },
    { id: "out", starts_at: "2026-09-01T00:00:00Z" },
    { id: "bad", starts_at: "not-a-date" },
  ], "2026-08", "Asia/Seoul");
  assert.deepEqual(items.map((item) => item.id), ["in"]);
  assert.equal(filterSchedulesForMonth([{ id: "boundary", starts_at: "2026-08-31T15:30:00Z" }], "2026-09", "Asia/Seoul")[0].id, "boundary");
});

test("기본 owned 달력과 서버 생성 payload를 검증한다", () => {
  assert.equal(selectDefaultCalendar({ owned: [{ id: "a" }, { id: "b", isDefault: true }] }).id, "b");
  const payload = buildSchedulePayload({ title: "회의", startsAt: "2026-08-03T09:00:00+09:00", endsAt: "2026-08-03T10:00:00+09:00", calendarId: "b", timezone: "Asia/Seoul" });
  assert.deepEqual(payload, { title: "회의", startsAt: "2026-08-03T09:00:00+09:00", endsAt: "2026-08-03T10:00:00+09:00", description: "", location: "", attendeeUserIds: [], repeatType: "none", repeatUntil: null, alertMinutes: [10], timezone: "Asia/Seoul", calendarId: "b" });
  assert.throws(() => buildSchedulePayload({ title: "", startsAt: "x", endsAt: "x", calendarId: "", timezone: "Asia/Seoul" }));
});
