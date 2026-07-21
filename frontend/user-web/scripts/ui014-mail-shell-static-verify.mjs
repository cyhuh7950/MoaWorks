import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const app = await readFile(resolve(root, "src/App.tsx"), "utf8");
const api = await readFile(resolve(root, "src/api.ts"), "utf8");
const css = await readFile(resolve(root, "src/global.css"), "utf8");
const route = await readFile(resolve(root, "../../backend/app/api/routes/mail.py"), "utf8");
const service = await readFile(resolve(root, "../../backend/app/services/mail_messenger_service.py"), "utf8");

const labels = ["메일쓰기", "즐겨찾기", "받은편지함", "보낸편지함", "임시보관함", "예약메일함", "스팸메일함", "휴지통", "사용자 메일함", "태그", "빠른 검색", "환경설정"];
const checks = [
  ["전체 shell 항목", labels.every((label) => app.includes(label))],
  ["기존 안 읽은 메일 유지", app.includes("안 읽은 메일")],
  ["136px compact", css.includes("grid-template-columns: 136px minmax(0, 1fr)")],
  ["미지원 aria-disabled", app.includes('aria-disabled="true"')],
  ["툴팁 hover와 focus", css.includes("[data-tooltip]:hover::after") && css.includes("[data-tooltip]:focus-visible::after")],
  ["독립 용량 오류", app.includes("mailStorageError") && app.includes("mailStorageLoading")],
  ["빠른 검색 mail 필터", app.includes('setSearchFilter("mail")') && app.includes("searchInputRef.current?.focus()")],
  ["환경설정 이동", app.includes('setPortalMenu("settings")')],
  ["same-origin storage", api.includes('request<MailStorageResponse>("/mail/storage"')],
  ["금지 절대주소 없음", !/request<MailStorageResponse>\(\s*[`"]https?:\/\//.test(api)],
  ["정적 라우트 우선", route.indexOf('@router.get("/storage"') < route.indexOf('@router.get("/{mail_id}"')],
  ["중복 제거와 회사 격리", service.includes("SELECT DISTINCT") && service.includes("u.company_id = %s")],
];

const failures = checks.filter(([, passed]) => !passed);
for (const [name, passed] of checks) console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
console.log(JSON.stringify({ passed: checks.length - failures.length, total: checks.length, failures: failures.map(([name]) => name) }));
if (failures.length) process.exitCode = 1;
