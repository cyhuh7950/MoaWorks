import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const app = await readFile(resolve(root, "src/App.tsx"), "utf8");
const api = await readFile(resolve(root, "src/api.ts"), "utf8");

const expectedCategories = [
  '["primary", "기본"]',
  '["promotions", "프로모션"]',
  '["social", "소셜"]',
  '["updates", "업데이트"]',
  '["forums", "포럼"]',
];

const categoryFunctionStart = app.indexOf("async function changeSelectedMailCategory");
const categoryFunctionEnd = app.indexOf("async function refreshUiContract", categoryFunctionStart);
const categoryFunction = app.slice(categoryFunctionStart, categoryFunctionEnd);

const checks = [
  ["분류 key와 label 순서", expectedCategories.every((entry) => app.includes(entry))],
  ["받은편지함 전용 탭", app.includes('activeMailFolder === "inbox"')],
  ["탭 접근성", app.includes("aria-pressed={mailCategory === category}")],
  ["현재 상세 선택 대상", categoryFunction.includes("selectedMailId") && !categoryFunction.includes("selectedMailIds[0]")],
  ["서버 category select", app.includes('selectedMailSummary?.category || "primary"')],
  ["독립 저장 busy", app.includes("mailCategoryBusy") && categoryFunction.includes("setMailCategoryBusy(true)")],
  ["중복 요청 차단", categoryFunction.includes("mailCategoryBusy")],
  ["성공 후 inbox 재조회", categoryFunction.includes("await fetchInbox(token)")],
  ["대상 탭 이동", categoryFunction.includes("setMailCategoryFilter(category)")],
  ["저장 실패 구분", categoryFunction.includes("메일 분류 변경에 실패했습니다.")],
  ["재조회 실패 구분", categoryFunction.includes("저장은 완료됐지만 목록을 다시 불러오지 못했습니다.")],
  ["same-origin category API", api.includes('request<MailStatusResponse>(`/mail/${mailId}/category`')],
  ["금지 API 절대주소 없음", !/setMailCategory[\s\S]{0,500}https?:\/\//.test(api)],
];

const failures = checks.filter(([, passed]) => !passed);
for (const [name, passed] of checks) console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
console.log(JSON.stringify({ passed: checks.length - failures.length, total: checks.length, failures: failures.map(([name]) => name) }));
if (failures.length) process.exitCode = 1;
