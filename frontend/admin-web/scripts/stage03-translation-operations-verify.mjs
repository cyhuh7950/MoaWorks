import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const api = fs.readFileSync(path.join(root, "src", "api.ts"), "utf8");
const app = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
let assertions = 0;
const check = (condition, message) => { assert.ok(condition, message); assertions += 1; };

for (const token of ["TranslationReview", "fetchTranslationReviews", "applyTranslationReviewAction", '"/translation/admin/status"']) {
  check(api.includes(token), `missing translation operations API: ${token}`);
}
check(api.includes('const defaultApiBase = "/api/v1";'), "translation browser API must remain same-origin");
check(!/https?:\/\/(?:server|localhost|127\.0\.0\.1)(?::\d+)?/i.test(api), "translation browser API must not expose internal absolute URLs");

for (const token of [
  "번역 Provider 운영", "OpenAI 호환 LLM", "DeepL", "자동 감지", "PostgreSQL 캐시 사용",
  "번역 검수", "원문·번역문 비교", "수정 저장", "승인", "재번역", "API 키는 암호화 저장",
]) {
  check(app.includes(token), `missing actual translation operations UI: ${token}`);
}
check(app.includes("saveTranslationProviderPolicy"), "provider policy save handler must be wired");
check(app.includes("runTranslationReviewAction"), "review action handler must be wired");
check(
  app.includes('<button type="button" disabled={translationLoading || !translationStatus?.enabled} onClick={() => void runTranslationDemo()}>번역 실행</button>'),
  "translation run button must invoke its handler directly in the deployed admin UI",
);
check(!app.includes("window.localStorage.setItem(\"translation"), "translation operations must not persist to localStorage");

console.log(`PASS stage03 translation operations contract (${assertions} assertions)`);
