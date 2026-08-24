const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildMonthGrid,
  createSubmissionGate,
  filterSchedulesForMonth,
  monthKeyForDate,
  shiftMonthKey,
  selectDefaultCalendar,
  scheduleErrorMessage,
  scheduleItems,
  buildSchedulePayload,
} = require("../schedule-api.js");
const { requestJson } = require("../auth-session.js");

test("월간 grid는 일요일 선행 빈 칸과 해당 월 날짜를 만든다", () => {
  const grid = buildMonthGrid(new Date("2026-08-01T00:00:00Z"));
  assert.equal(grid[0].dateKey, "");
  assert.equal(grid[6].dateKey, "2026-08-01");
  assert.equal(grid.filter((cell) => cell.dateKey).length, 31);
});

test("표시 월은 앱 시간대 dateKey에서 만들고 UTC 기준 month key로만 이동한다", () => {
  assert.equal(monthKeyForDate("2026-08-31T15:30:00Z", "Asia/Seoul"), "2026-09");
  assert.equal(shiftMonthKey("2026-01", -1), "2025-12");
  assert.equal(shiftMonthKey("2026-12", 1), "2027-01");
  assert.equal(buildMonthGrid("2026-09")[0].dateKey, "");
  assert.equal(buildMonthGrid("2026-09").at(-1).dateKey, "2026-09-30");
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

test("{items} reader와 production submission gate는 reset 뒤 새 세션 요청만 허용한다", () => {
  assert.deepEqual(scheduleItems({ items: [{ id: "schedule-1" }] }), [{ id: "schedule-1" }]);
  assert.deepEqual(scheduleItems({ schedules: [{ id: "legacy" }] }), []);
  const gate = createSubmissionGate();
  assert.equal(gate.tryEnter(), true);
  assert.equal(gate.tryEnter(), false);
  gate.reset();
  assert.equal(gate.tryEnter(), true);
  gate.release();
  assert.equal(gate.isLocked(), false);
});

test("FastAPI 배열 detail은 requestJson에서 보존되어 일정 오류 문구로 표시된다", async () => {
  await assert.rejects(
    requestJson({
      apiBase: "https://api.example.test",
      path: "/workspace/schedules",
      fetchImpl: async () => ({ ok: false, status: 422, text: async () => JSON.stringify({ detail: [{ msg: "endsAt must be after startsAt" }] }) }),
    }),
    (error) => Array.isArray(error.detail) && scheduleErrorMessage(error) === "endsAt must be after startsAt",
  );
});
