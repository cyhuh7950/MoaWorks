import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const appSource = await readFile(resolve(root, "src/App.tsx"), "utf8");
const apiSource = await readFile(resolve(root, "src/api.ts"), "utf8");

const checks = [
  ["SSE URL token 파라미터 제거", !appSource.includes("notifications/stream?token=")],
  ["브라우저 EventSource 제거", !appSource.includes("new EventSource(")],
  ["same-origin 스트림 경로", apiSource.includes('/notifications/stream${qs ? `?${qs}` : ""}')],
  ["Authorization 헤더 인증", apiSource.includes("headers: authHeaders(token)")],
  ["스트림 중단 제어", appSource.includes("AbortController") && appSource.includes(".abort()")],
  ["토큰 URL 조립 금지", !/notifications\/stream[^\n]*token/.test(appSource)],
];

const failures = checks.filter(([, passed]) => !passed);
for (const [name, passed] of checks) console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
if (failures.length) process.exitCode = 1;
