import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = path => readFileSync(resolve(root, path), "utf8");
const panel = read("src/SettingsHelpPanel.tsx");
const api = read("src/api.ts");
const shell = read("src/WorkspacePanels.tsx");
const app = read("src/App.tsx");
const calendar = read("src/CalendarPanel.tsx");
const i18n = read("src/i18n.ts");
const css = read("src/global.css");

for (const marker of ["프로필", "일반 설정", "알림 설정", "보안", "업무별 설정", "설정 변경", "비밀번호 변경", "메일 환경설정", "결재 환경설정", "캘린더 환경설정"]) assert.ok(panel.includes(marker), marker);
for (const marker of ["전체", "사용자 가이드", "정책", "오류 안내", "Help 검색", "300", "다시 시도", "검색 결과가 없습니다", "CommonPopup"]) assert.ok(panel.includes(marker), marker);
for (const endpoint of ["/workspace/profile", "/workspace/preferences", "/workspace/help-policies", "/notifications/preferences", "/auth/change-password"]) assert.ok(api.includes(endpoint), endpoint);
for (const marker of ["startPage", "expectedVersion", "ko-KR", "en-US", "ja-JP", "zh-CN", "es-ES", "fr-FR", "de-DE"]) assert.ok(`${panel}\n${api}\n${i18n}`.includes(marker), marker);
assert.ok(shell.includes("<SettingsHelpPanel"));
for (const legacyOwner of [
  "fetchWorkspacePreferences", "fetchWorkspaceHelpPolicies", "saveWorkspacePreferences",
  "WorkspaceHelpPolicy", "WorkspacePreferences", "helpPolicies", "preferenceForm",
  "selectedHelp", "submitPreferences", 'modal === "settings"',
]) assert.ok(!shell.includes(legacyOwner), `WorkspacePanels must not own ${legacyOwner}`);
assert.ok(app.includes("onOpenWorkspaceSettings"));
assert.ok(calendar.includes("settingsRequestKey"));
assert.match(css, /\.ui044-settings-help[^}]*font-size:\s*12px/s);
assert.match(css, /grid-template-columns:\s*220px\s+minmax\(0,\s*1fr\)/);
assert.match(css, /\.ui044-settings-help__title[^}]*font-size:\s*16px/);
assert.match(css, /#root\s+\.ui044-settings-help__section-title[^}]*font-size:\s*14px\s*!important/);
assert.match(css, /#root\s+\.ui044-settings-help__helper[^}]*font-size:\s*10px\s*!important/);
assert.ok(panel.includes('label="개인 설정 설명"') && panel.includes("aria-label={label}") && panel.includes("title={title}"));
assert.ok(!`${panel}\n${api}`.match(/https?:\/\/|localhost|127\.0\.0\.1|NEXT_PUBLIC_|VITE_API_BASE_URL\s*=/));
assert.ok(!panel.includes("dangerouslySetInnerHTML"));
console.log("UI-044 personal settings and Help static verification passed");
