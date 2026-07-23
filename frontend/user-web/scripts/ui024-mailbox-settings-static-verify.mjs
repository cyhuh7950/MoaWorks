import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync("src/App.tsx", "utf8");
const api = readFileSync("src/api.ts", "utf8");
const css = readFileSync("src/global.css", "utf8");

assert.match(app, /function MailboxSettingsPanel/);
for (const heading of ["메일함", "보관기간", "안 읽음/전체", "사용량", "관리"]) {
  assert.match(app, new RegExp(`<th>${heading.replace("/", "\\/")}<\\/th>`));
}
for (const mailbox of ["받은편지함", "보낸편지함", "임시보관함", "예약메일함", "스팸함", "휴지통"]) {
  assert.match(app, new RegExp(mailbox));
}
assert.match(app, /휴지통 비우기는 복구할 수 없음을 확인했습니다\./);
assert.match(app, /aria-live="polite"/);
assert.match(app, /setInterval\([^,]+,\s*3_000\)/s);
assert.match(app, /clearInterval/);
assert.match(app, /title="보관기간이 지난 메일은[^"]+사용량은 사용자 보기 기준[^"]+"/);
assert.match(app, /<caption>메일함별 보관기간[^<]+<\/caption>/);
assert.match(app, /error\.currentCount/);
assert.match(app, /loadMailboxSettings\(token, false\)/);
assert.doesNotMatch(app, /mailbox-settings-explanation/);

const apiStart = api.indexOf("// UI-024 mailbox settings");
assert.ok(apiStart >= 0, "UI-024 API block is missing");
const ui024Api = api.slice(apiStart);
for (const marker of [
  'request<MailMailboxSettingsResponse>("/mail/mailbox-settings"',
  "updateMailboxPolicy",
  "emptyMailbox",
  "createMailboxBackup",
  "fetchMailboxBackups",
  "retryMailboxBackup",
  'return `/api/v1/mail/mailbox-backups/${encodeURIComponent(jobId)}/download`',
]) {
  assert.ok(ui024Api.includes(marker), `missing API marker: ${marker}`);
}
assert.doesNotMatch(ui024Api, /https?:\/\/|localhost|127\.0\.0\.1|NEXT_PUBLIC_/);
assert.match(api, /currentCount: number \| null/);
assert.match(api, /source\.currentCount/);

for (const marker of [
  ".user-mail-mailbox-settings",
  "overflow: hidden",
  "overflow-y: auto",
  "font-size: 12px",
  "min-height: 36px",
  ":focus-visible",
]) {
  assert.ok(css.includes(marker), `missing CSS marker: ${marker}`);
}

console.log("UI-024 mailbox settings static verification OK");
