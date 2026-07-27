import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const [styles, popup, ui013Verifier] = await Promise.all([
  readFile(resolve(root, "src/global.css"), "utf8"),
  readFile(resolve(root, "src/components/CommonPopup.tsx"), "utf8"),
  readFile(resolve(root, "scripts/ui013-notification-preferences-static-verify.mjs"), "utf8"),
]);

const sourceFiles = [
  "src/App.tsx",
  "src/NotificationCenter.tsx",
  "src/api.ts",
  "src/components/CommonPopup.tsx",
];
const sources = (await Promise.all(sourceFiles.map(file => readFile(resolve(root, file), "utf8")))).join("\n");

const checks = [
  ["본문 12px 토큰", styles.includes("--mw-font-body: 12px")],
  ["메뉴 14px 토큰", styles.includes("--mw-font-menu: 14px")],
  ["화면 제목 16px 토큰", styles.includes("--mw-font-title: 16px")],
  ["전역 화면 제목 16px", /#root\s+:where\(h1,\s*h2\)\s*\{[^}]*font-size:\s*16px\s*!important;/s.test(styles)],
  ["배지 9px 토큰", styles.includes("--mw-font-badge: 9px")],
  ["Shell viewport 고정", /\.user-shell\s*\{[^}]*height:\s*100dvh;[^}]*overflow:\s*hidden;/s.test(styles)],
  ["Shell 본문 외부 overflow 차단", /\.user-shell-content\s*\{[^}]*overflow:\s*hidden\s*!important;/s.test(styles)],
  ["메일 compact 136px", /\.user-mail-workbench\s*\{[^}]*grid-template-columns:\s*136px\s+minmax\(0,\s*1fr\)/s.test(styles)],
  ["split 기본 50대50", styles.includes("--split-primary-ratio: 50%")],
  ["split pane overflow 차단", /\.user-split-view__pane\s*\{[^}]*min-width:\s*0;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s.test(styles)],
  ["popup 내부 스크롤", /\.common-popup\s*\{[^}]*max-height:\s*82vh;[^}]*overflow:\s*auto;/s.test(styles)],
  ["popup 초기 focus", popup.includes("initialFocusRef?.current ?? editable ?? close.current")],
  ["popup Escape와 focus trap", popup.includes('event.key === "Escape"') && popup.includes('event.key !== "Tab"')],
  ["popup dirty close", popup.includes("if (!dirty) return onClose()") && popup.includes("setConfirm(true)")],
  ["popup 저장 중 닫기 방지", popup.includes("if (saving) return") && popup.includes("disabled={saving}")],
  ["UI-013 검증기 현재 저장 계약", ui013Verifier.includes("저장 중 닫기 방지 계약") && ui013Verifier.includes('popup.includes("if (saving) return")')],
  ["협업 3열 화면", [".ui040-messenger", ".ui041-address-book", ".ui042-workspace", ".ui043-files"].every(selector => styles.includes(selector))],
  ["브라우저 내부주소 fetch 없음", !/(?:fetch|request)\s*(?:<[^>]+>)?\s*\(\s*[`'\"]https?:\/\/(?:localhost|127\.0\.0\.1|[^/'\"]+:\d+)/.test(sources)],
  ["공개 환경변수 API 호출 없음", !/NEXT_PUBLIC_[A-Z0-9_]*(?:API|URL|HOST)/.test(sources)],
];

const failures = checks.filter(([, passed]) => !passed);
for (const [name, passed] of checks) console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
console.log(JSON.stringify({ passed: checks.length - failures.length, total: checks.length, failures: failures.map(([name]) => name) }));
if (failures.length) process.exitCode = 1;
