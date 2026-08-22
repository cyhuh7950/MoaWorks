import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../src");
const helperPath = resolve(src, "scheduleForm.ts");
const popupPath = resolve(src, "ScheduleComposePopup.tsx");
const [popup, workspace, calendar, api, app, css] = await Promise.all([
  readFile(popupPath, "utf8"),
  readFile(resolve(src, "WorkspacePanels.tsx"), "utf8"),
  readFile(resolve(src, "CalendarPanel.tsx"), "utf8"),
  readFile(resolve(src, "api.ts"), "utf8"),
  readFile(resolve(src, "App.tsx"), "utf8"),
  readFile(resolve(src, "global.css"), "utf8"),
]);
const form = await import(`${pathToFileURL(helperPath).href}?ui038=${Date.now()}`);

const utc = form.localDateTimeToUtc("2026-03-08T01:30", "America/New_York");
assert.equal(utc, "2026-03-08T06:30:00.000Z");
assert.equal(form.utcToLocalDateTime(utc, "America/New_York"), "2026-03-08T01:30");
assert.throws(() => form.localDateTimeToUtc("2026-03-08T02:30", "America/New_York"));

const defaults = form.createScheduleDraft(null, "Asia/Seoul", new Date("2026-07-27T00:07:00Z"));
assert.equal(defaults.scheduleId, null);
assert.equal(defaults.startsAt, "2026-07-27T09:30");
assert.equal(defaults.endsAt, "2026-07-27T10:30");
assert.equal(defaults.repeatType, "none");
assert.equal(defaults.repeatUntil, "2026-10-27");
const monthEndDefaults = form.createScheduleDraft(null, "UTC", new Date("2026-01-31T01:07:00Z"));
assert.equal(monthEndDefaults.repeatUntil, "2026-04-30");

const movedRange = form.moveScheduleStart(
  { ...defaults, startsAt: "2026-08-20T10:00", endsAt: "2026-08-20T12:00" },
  "2026-08-27T22:00",
);
assert.equal(movedRange.startsAt, "2026-08-27T22:00");
assert.equal(movedRange.endsAt, "2026-08-28T00:00");

const partialRange = form.moveScheduleStart(movedRange, "");
assert.equal(partialRange.startsAt, "");
assert.equal(partialRange.endsAt, movedRange.endsAt);

const monthly = form.expandScheduleOccurrences({
  id: "schedule_1", title: "월말", description: "", starts_at: "2026-01-31T01:00:00Z", ends_at: "2026-01-31T02:00:00Z",
  location: "회의실 A", attendees: [], repeatType: "monthly", repeatUntil: "2026-04-30", alertMinutes: [10], timezone: "UTC", status: "active", created_at: "", updated_at: "",
}, { start: new Date("2026-01-01T00:00:00Z"), end: new Date("2026-05-01T00:00:00Z") });
assert.deepEqual(monthly.map((item) => [item.id, item.occurrence_key, new Date(item.starts_at).getUTCDate()]), [
  ["schedule_1", "schedule_1:2026-01-31T01:00:00.000Z", 31],
  ["schedule_1", "schedule_1:2026-02-28T01:00:00.000Z", 28],
  ["schedule_1", "schedule_1:2026-03-31T01:00:00.000Z", 31],
  ["schedule_1", "schedule_1:2026-04-30T01:00:00.000Z", 30],
]);

for (const text of ["CommonPopup", "일정 만들기", "일정 수정", "위치", "참석자", "반복", "반복 종료일", "알림", "설명", "이름, 이메일, 부서 검색", "최대 3개"])
  assert.ok(popup.includes(text), `missing popup contract: ${text}`);
assert.ok(popup.includes("scheduleId === null"), "create/edit id boundary missing");
assert.ok(popup.includes('moveScheduleStart(current, event.target.value)'), "start changes must preserve the existing duration");
assert.ok(popup.includes("initialFocusRef") && popup.includes("closeRequestRef") && popup.includes("dirty=") && popup.includes("saving="), "CommonPopup behavior missing");
assert.ok(workspace.includes("fetchWorkspaceDirectory") && workspace.includes("ownerUserId") && workspace.includes("ScheduleComposePopup"), "attendee loading/owner exclusion missing");
assert.ok(app.includes("ownerUserId={me?.userId ?? \"\"}"), "App owner id wiring missing");
for (const field of ["location", "attendeeUserIds", "repeatType", "repeatUntil", "alertMinutes", "timezone"])
  assert.ok(api.includes(field), `API field missing: ${field}`);
for (const detail of ["위치", "참석자", "반복", "알림"])
  assert.ok(calendar.includes(detail), `calendar detail missing: ${detail}`);
assert.ok(calendar.includes("expandScheduleOccurrences"), "recurring occurrences are not rendered");
assert.match(css, /\.ui038-schedule-popup\s*\{[^}]*width:\s*720px[^}]*font-size:\s*12px/s);
assert.doesNotMatch(popup + workspace + api, /https?:\/\/(?:localhost|127\.0\.0\.1)|NEXT_PUBLIC_API_BASE_URL|host\.docker\.internal/);

console.log("UI-038 calendar compose popup verifier: 18/18 passed");
