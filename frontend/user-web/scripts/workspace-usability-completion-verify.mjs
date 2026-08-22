import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const messenger = fs.readFileSync(path.join(root, "src", "MessengerPanel.tsx"), "utf8");
const calendar = fs.readFileSync(path.join(root, "src", "CalendarPanel.tsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src", "global.css"), "utf8");

const checks = [
  ["메신저 이름 열", /ui040-room-name/.test(messenger)],
  ["메신저 미리보기 열", /ui040-room-preview/.test(messenger)],
  ["메신저 시간 참여자 열", /ui040-room-meta/.test(messenger)],
  ["메신저 별도 더보기", /ui040-room-more/.test(messenger)],
  ["메신저 고정 열 레이아웃", /\.ui040-room-group > article\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) 28px 28px/s.test(css)],
  ["빈 월간 달력 유지", /!loading && !error && view === "month"/.test(calendar)],
  ["빈 주간 일간 달력 유지", /!loading && !error && \(view === "week" \|\| view === "day"\)/.test(calendar)],
  ["빈 달력 안내 오버레이", /ui037-state is-calendar-empty/.test(calendar) && /\.ui037-state\.is-calendar-empty/.test(css)],
];

for (const [name, passed] of checks) {
  assert.equal(passed, true, name);
  console.log(`PASS ${name}`);
}
console.log(`Workspace usability verifier: ${checks.length}/${checks.length} passed`);
