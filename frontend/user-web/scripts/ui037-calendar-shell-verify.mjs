import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../src");
const helperPath = resolve(src, "calendar.ts");
const componentPath = resolve(src, "CalendarPanel.tsx");
const workspacePath = resolve(src, "WorkspacePanels.tsx");
const apiPath = resolve(src, "api.ts");
const cssPath = resolve(src, "global.css");

const [component, workspace, api, css] = await Promise.all([
  readFile(componentPath, "utf8"),
  readFile(workspacePath, "utf8"),
  readFile(apiPath, "utf8"),
  readFile(cssPath, "utf8"),
]);
const calendar = await import(`${pathToFileURL(helperPath).href}?ui037=${Date.now()}`);

const event = (id, startsAt, endsAt, title = id, description = "") => ({
  id, title, description, starts_at: startsAt, ends_at: endsAt, status: "active", created_at: startsAt, updated_at: startsAt,
});
const base = new Date("2026-07-27T00:00:00+09:00");

assert.deepEqual(calendar.getCalendarRange("month", base), {
  start: new Date("2026-07-01T00:00:00+09:00"),
  end: new Date("2026-08-01T00:00:00+09:00"),
});
assert.deepEqual(calendar.getCalendarRange("week", base), {
  start: new Date("2026-07-26T00:00:00+09:00"),
  end: new Date("2026-08-02T00:00:00+09:00"),
});
assert.deepEqual(calendar.getCalendarRange("day", base), {
  start: new Date("2026-07-27T00:00:00+09:00"),
  end: new Date("2026-07-28T00:00:00+09:00"),
});

const range = calendar.getCalendarRange("month", base);
const visible = calendar.filterCalendarEvents([
  event("before", "2026-06-30T14:00:00Z", "2026-06-30T15:00:00Z"),
  event("cross", "2026-06-30T14:30:00Z", "2026-07-01T01:00:00Z", "교차 회의", "설명"),
  event("edge", "2026-07-31T15:00:00Z", "2026-07-31T16:00:00Z"),
], range, " 회의 ");
assert.deepEqual(visible.map((item) => item.id), ["cross"]);
assert.equal(calendar.eventIntersectsRange(event("ends-at-start", "2026-06-30T14:00:00Z", "2026-06-30T15:00:00Z"), range), false);

assert.equal(calendar.navigateCalendarDate(base, "month", 1).getMonth(), 7);
assert.equal(calendar.navigateCalendarDate(base, "week", -1).getDate(), 20);
assert.equal(calendar.navigateCalendarDate(base, "day", 1).getDate(), 28);
assert.match(calendar.formatCalendarRangeTitle("month", base, "ko-KR", "Asia/Seoul"), /2026년 7월/);

for (const text of ["일정 만들기", "내 캘린더", "관심 캘린더", "부서 캘린더", "전사 캘린더", "등록된 캘린더 없음", "오늘", "월", "주", "일", "목록", "일정을 선택하세요.", "검색 결과가 없습니다.", "다시 시도"])
  assert.ok(component.includes(text), `missing UI contract: ${text}`);
for (const view of ["month", "week", "day", "list"])
  assert.ok(component.includes(`key: "${view}"`), `missing calendar view: ${view}`);
assert.ok(component.includes("aria-pressed={view === item.key}"), "selected view must expose aria-pressed");
assert.ok(workspace.includes("<CalendarPanel"), "schedule branch must delegate to CalendarPanel");
assert.ok(workspace.includes("openSchedule") && workspace.includes("submitSchedule") && workspace.includes("confirmDelete"), "existing CRUD wiring missing");
assert.ok(api.includes('request<{ items: WorkspaceSchedule[] }>("/workspace/schedules"'), "same-origin schedule request missing");
assert.doesNotMatch(component + workspace + api, /https?:\/\/(?:localhost|127\.0\.0\.1)|NEXT_PUBLIC_API_BASE_URL|host\.docker\.internal/);
assert.match(css, /\.ui037-calendar-shell\s*\{[^}]*grid-template-columns:\s*208px minmax\(0,\s*1fr\) 296px/s);
assert.match(css, /\.ui037-calendar-shell[^}]*font-size:\s*12px/s);
assert.match(css, /\.ui037-calendar-(?:source|main|detail)[^}]*overflow:\s*auto/s);

console.log("UI-037 calendar shell verifier: 16/16 passed");
