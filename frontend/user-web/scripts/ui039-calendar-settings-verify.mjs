import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../src");
const helperPath = resolve(src, "calendarSettings.ts");
const [panel, calendar, workspace, popup, api, css] = await Promise.all([
  readFile(resolve(src, "CalendarSettingsPanel.tsx"), "utf8"),
  readFile(resolve(src, "CalendarPanel.tsx"), "utf8"),
  readFile(resolve(src, "WorkspacePanels.tsx"), "utf8"),
  readFile(resolve(src, "ScheduleComposePopup.tsx"), "utf8"),
  readFile(resolve(src, "api.ts"), "utf8"),
  readFile(resolve(src, "global.css"), "utf8"),
]);
const helper = await import(`${pathToFileURL(helperPath).href}?ui039=${Date.now()}`);

const owned = [
  { id: "a", name: "내 일정", color: "#0f766e", sortOrder: 0, isDefault: true, visibility: "private", version: 0, ownerUserId: "me", ownerUserName: "나", activeScheduleCount: 1 },
  { id: "b", name: "업무", color: "#2563eb", sortOrder: 1, isDefault: false, visibility: "public", version: 2, ownerUserId: "me", ownerUserName: "나", activeScheduleCount: 3 },
];
const subscriptions = [{ subscriptionId: "s1", status: "active", version: 1, calendar: { ...owned[1], id: "c", ownerUserId: "other", ownerUserName: "동료" } }];
assert.deepEqual(helper.initialSelectedCalendarIds({ owned, subscriptions, incomingRequests: [] }), ["a", "b", "c"]);
assert.deepEqual(helper.moveOwnedCalendar(owned, "b", -1).map((item) => item.id), ["b", "a"]);
assert.deepEqual(helper.moveOwnedCalendar(owned, "a", -1).map((item) => item.id), ["a", "b"]);
assert.equal(helper.canEditSchedule({ ownerUserId: "me", canEdit: true }, "me"), true);
assert.equal(helper.canEditSchedule({ ownerUserId: "other", canEdit: false }, "me"), false);

for (const text of ["내 캘린더 관리", "내 캘린더", "관심 캘린더", "캘린더로 돌아가기", "캘린더 추가", "기본 캘린더", "공개", "수락 후 공개", "비공개", "위로", "아래로", "해당 일정도 함께 삭제되어 화면에서 복구할 수 없음", "내 일정을 보고 있는 동료", "수락", "거절", "해제"])
  assert.ok(panel.includes(text), `settings UI missing: ${text}`);
for (const token of ["fetchCalendars", "discoverCalendars", "createCalendar", "updateCalendar", "reorderCalendars", "deleteCalendar", "createCalendarSubscription", "cancelCalendarSubscription", "decideCalendarSubscription"])
  assert.ok(api.includes(token), `calendar API missing: ${token}`);
assert.ok(calendar.includes("캘린더 환경설정") && calendar.includes("CalendarSettingsPanel") && calendar.includes("selectedCalendarIds"), "calendar settings/filter wiring missing");
assert.ok(calendar.includes("calendarColor") && calendar.includes("canEdit") && calendar.includes("calendarName") && calendar.includes("ownerUserName"), "calendar color/read-only detail missing");
assert.ok(workspace.includes("fetchCalendars") && workspace.includes("calendarData") && workspace.includes("defaultCalendar"), "workspace calendar loading/default missing");
assert.ok(popup.includes("캘린더") && popup.includes("ownedCalendars") && popup.includes('update("calendarId"'), "schedule calendar selector missing");
assert.match(css, /\.ui039-calendar-settings\s*\{[^}]*font-size:\s*12px/s);
assert.doesNotMatch(panel + calendar + workspace + popup + api, /https?:\/\/(?:localhost|127\.0\.0\.1)|NEXT_PUBLIC_API_BASE_URL|host\.docker\.internal/);

console.log("UI-039 calendar settings verifier: 21/21 passed");
