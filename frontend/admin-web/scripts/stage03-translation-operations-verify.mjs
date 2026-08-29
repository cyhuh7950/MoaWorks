import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const api = fs.readFileSync(path.join(root, "src", "api.ts"), "utf8");
const app = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
const providerSource = fs.readFileSync(path.resolve(root, "..", "..", "backend", "app", "services", "translation_provider.py"), "utf8");
let assertions = 0;
const check = (condition, message) => { assert.ok(condition, message); assertions += 1; };

for (const token of ["TranslationReview", "fetchTranslationReviews", "applyTranslationReviewAction", '"/translation/admin/status"']) {
  check(api.includes(token), `missing translation operations API: ${token}`);
}
check(api.includes('const defaultApiBase = "/api/v1";'), "translation browser API must remain same-origin");
check(!app.includes("void refreshTranslationState();"), "관리 로그인 전 공개 translation status를 호출하면 안 됩니다.");
check(!/https?:\/\/(?:server|localhost|127\.0\.0\.1)(?::\d+)?/i.test(api), "translation browser API must not expose internal absolute URLs");

for (const token of [
  "번역 Provider 운영", "자동 감지", "PostgreSQL 캐시 사용",
  "번역 검수", "원문·번역문 비교", "수정 저장", "승인", "재번역", "API 키는 암호화 저장",
]) {
  check(app.includes(token), `missing actual translation operations UI: ${token}`);
}
for (const provider of ["CEREBRAS", "GROQ", "MISTRAL", "OPENAI", "UPSTAGE", "GEMINI", "OPENROUTER", "ANTHROPIC", "OLLAMA"]) {
  check(providerSource.includes(`\"label\": \"${provider}\"`), `missing supported LLM provider profile: ${provider}`);
}
check(app.includes("saveTranslationProviderPolicy"), "provider policy save handler must be wired");
check(app.includes("testTranslationProviderConnection"), "provider connection test handler must be wired");
check(app.includes("연결 테스트"), "provider connection test button must be visible");
check(app.includes("translationConnectionResult.code"), "connection result must show the safe provider error code");
check(app.includes("fetchTranslationProviderModels"), "provider model list handler must be wired");
check(app.includes("모델 불러오기"), "provider model refresh button must be visible");
check(app.includes('<select value={translationPolicyForm.model}'), "provider model must be selected from a dropdown");
check(!app.includes('<input value={translationPolicyForm.model}'), "provider model must not be entered as free text");
check(!app.includes('<option value="deepl">DeepL</option>'), "DeepL must not be exposed as an operating provider");
check(app.includes("const translationUiVisible = translationStatus?.available === true;"), "translation UI visibility must follow server availability");
check(app.includes("translationUiVisible ? ("), "actual translation and review panels must be conditional");
check(app.includes("LLM 설정과 활성화 후 번역 실행·검수 화면이 표시됩니다."), "admin must explain the hidden translation UI state");
check(app.includes("입력 토큰 백만 개당 비용"), "admin must expose a separate input token price");
check(app.includes("출력 토큰 백만 개당 비용"), "admin must expose a separate output token price");
check(app.includes("혼합 단가(호환용)"), "admin must identify the legacy blended price as compatibility-only");
check(app.includes("runTranslationReviewAction"), "review action handler must be wired");
check(
  app.includes('<button type="button" disabled={translationLoading || !translationStatus?.enabled} onClick={() => void runTranslationDemo()}>번역 실행</button>'),
  "translation run button must invoke its handler directly in the deployed admin UI",
);
const translationDemoBlock = app.slice(
  app.indexOf("async function runTranslationDemo"),
  app.indexOf("\n  useEffect(() =>", app.indexOf("async function runTranslationDemo")),
);
check(translationDemoBlock.includes("fetchTranslationReviews"), "successful translation must refresh the review list immediately");
check(app.includes('data-testid="translation-fallback-status"'), "actual translation fallback must show a safe recovery status");
check(!app.includes("window.localStorage.setItem(\"translation"), "translation operations must not persist to localStorage");

console.log(`PASS stage03 translation operations contract (${assertions} assertions)`);
