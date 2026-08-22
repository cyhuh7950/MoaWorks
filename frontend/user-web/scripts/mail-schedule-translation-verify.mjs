import fs from "node:fs";

const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const api = fs.readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");

const checks = [
  ["예약메일함 활성 메뉴", app.includes('openMailFolder("scheduled")')],
  ["예약메일 상세 작업", app.includes("예약 수정") && app.includes("지금 발송") && app.includes("예약 취소")],
  ["수신 메일 번역", app.includes("메일 번역") && app.includes("원문 보기")],
  ["발신 메일 번역", app.includes("번역 미리보기") && app.includes("번역 적용")],
  ["독립 번역 도구 제거", !app.includes('data-testid="user-translation-tool"') && !app.includes("번역 보조 도구")],
  ["예약 API", ["fetchScheduledMail", "updateScheduledMail", "cancelScheduledMail", "sendScheduledMailNow", "retryScheduledMail"].every((name) => api.includes(`function ${name}`))],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
if (failed.length) process.exit(1);
