const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appSource = fs.readFileSync(path.resolve(__dirname, "..", "App.tsx"), "utf8");

function loadPersonalAiApi() {
  return require("../personal-ai-api.js");
}

test("서버 provider/config 응답만 안전한 모바일 상태로 읽는다", () => {
  const { readPersonalAiConfig, readPersonalAiProviders } = loadPersonalAiApi();

  assert.deepEqual(readPersonalAiProviders({ providers: [
    { provider: "groq", label: "Groq", apiKeyRequired: true, apiBaseUrl: "https://hidden.invalid" },
    { provider: "ollama", label: "Ollama", apiKeyRequired: false },
  ] }), [
    { provider: "groq", label: "Groq", apiKeyRequired: true },
    { provider: "ollama", label: "Ollama", apiKeyRequired: false },
  ]);
  assert.deepEqual(readPersonalAiConfig({
    provider: "groq",
    model: "llama-3.3-70b-versatile",
    apiKeyConfigured: true,
    connectionStatus: "ready",
    lastTestCode: "PERSONAL_AI_CONNECTION_READY",
    lastTestedAt: "2026-08-24T04:00:00Z",
    apiKey: "must-not-cross-client-boundary",
  }), {
    provider: "groq",
    model: "llama-3.3-70b-versatile",
    apiKeyConfigured: true,
    connectionStatus: "ready",
    lastTestCode: "PERSONAL_AI_CONNECTION_READY",
    lastTestedAt: "2026-08-24T04:00:00Z",
  });
  assert.throws(() => readPersonalAiProviders({ providers: [{ provider: "GROQ", label: "Groq", apiKeyRequired: true }] }), /개인 AI 응답을 확인할 수 없습니다/);
  assert.throws(() => readPersonalAiConfig({ provider: "groq", model: "m", apiKeyConfigured: "yes", connectionStatus: "ready" }), /개인 AI 응답을 확인할 수 없습니다/);
});

test("설정 payload는 server lowercase provider와 model 및 새 key draft만 포함한다", () => {
  const { buildPersonalAiConfigPayload } = loadPersonalAiApi();

  assert.deepEqual(buildPersonalAiConfigPayload({ provider: " groq ", model: " llama-3 ", apiKeyDraft: "" }), {
    provider: "groq",
    model: "llama-3",
  });
  assert.deepEqual(buildPersonalAiConfigPayload({ provider: "openai", model: "gpt-5", apiKeyDraft: " sk-new " }), {
    provider: "openai",
    model: "gpt-5",
    apiKey: "sk-new",
  });
  assert.throws(() => buildPersonalAiConfigPayload({ provider: "OpenAI", model: "", apiKeyDraft: "secret" }), /Provider와 모델/);
});

test("chat payload는 현재 질문을 포함해 최근 20개와 32000자 제한을 지킨다", () => {
  const { buildPersonalAiChatPayload } = loadPersonalAiApi();
  const history = Array.from({ length: 24 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    body: `${index}`.padEnd(1700, "x"),
  }));

  const payload = buildPersonalAiChatPayload(history, " 현재 질문 ");
  assert.equal(payload.messages.at(-1).content, "현재 질문");
  assert.equal(payload.messages.at(-1).role, "user");
  assert.ok(payload.messages.length <= 20);
  assert.ok(payload.messages.reduce((total, message) => total + message.content.length, 0) <= 32000);
  assert.deepEqual(Object.keys(payload.messages[0]).sort(), ["content", "role"]);
  assert.throws(() => buildPersonalAiChatPayload([], "x".repeat(8001)), /8,000자/);
  assert.throws(() => buildPersonalAiChatPayload([], "   "), /질문을 입력/);
});

test("test/chat malformed 응답과 네트워크 오류는 비밀 없는 안전 오류로 바꾼다", () => {
  const { personalAiErrorMessage, readPersonalAiChatResponse, readPersonalAiConnectionTest } = loadPersonalAiApi();

  assert.deepEqual(readPersonalAiConnectionTest({
    success: true,
    provider: "groq",
    model: "llama-3",
    code: "PERSONAL_AI_CONNECTION_READY",
    message: "개인 AI Provider 연결이 준비되었습니다.",
    connectionStatus: "ready",
    testedAt: "2026-08-24T04:00:00Z",
  }).connectionStatus, "ready");
  assert.deepEqual(readPersonalAiChatResponse({
    provider: "groq",
    model: "llama-3",
    message: { role: "assistant", content: "안전한 답변" },
    generatedAt: "2026-08-24T04:00:01Z",
  }).message, { role: "assistant", content: "안전한 답변" });
  assert.throws(() => readPersonalAiConnectionTest({ success: true, connectionStatus: "ready" }), /개인 AI 응답을 확인할 수 없습니다/);
  assert.throws(() => readPersonalAiChatResponse({ message: { role: "system", content: "hidden" } }), /개인 AI 응답을 확인할 수 없습니다/);
  assert.equal(personalAiErrorMessage({ detail: { userMessage: "먼저 개인 AI 연결 시험을 완료해 주세요.", adminMessage: "ciphertext=hidden" } }), "먼저 개인 AI 연결 시험을 완료해 주세요.");
  assert.equal(personalAiErrorMessage(new Error("fetch https://internal-provider.invalid?apiKey=secret failed")), "개인 AI 요청을 처리하지 못했습니다.");
});

test("개인 AI action gate는 중복 실행을 막고 reset 뒤 이전 release가 새 작업을 풀지 못한다", () => {
  const { createPersonalAiActionGate } = loadPersonalAiApi();
  const gate = createPersonalAiActionGate();
  const oldTicket = gate.tryEnter("save");

  assert.ok(oldTicket);
  assert.equal(gate.tryEnter("test"), null);
  assert.equal(gate.isBusy(), true);
  gate.reset();
  const currentTicket = gate.tryEnter("chat");
  assert.ok(currentTicket);
  gate.release(oldTicket);
  assert.equal(gate.isBusy("chat"), true);
  gate.release(currentTicket);
  assert.equal(gate.isBusy(), false);
});

test("App은 서버 catalog/config/test/chat만 사용하고 모든 응답을 current session에 귀속한다", () => {
  assert.match(appSource, /from "\.\/personal-ai-api"/);
  for (const contract of [
    '"/workspace/personal-ai/providers"',
    '"/workspace/personal-ai/config"',
    '"/workspace/personal-ai/test"',
    '"/workspace/personal-ai/chat"',
  ]) {
    assert.match(appSource, new RegExp(contract.replaceAll("/", "\\/")));
  }
  for (const name of ["loadPersonalAi", "savePersonalAiConfig", "testPersonalAiConnection", "askAi"]) {
    const start = appSource.indexOf(`async function ${name}`);
    assert.notEqual(start, -1, `${name} exists`);
    const next = appSource.indexOf("\n  async function ", start + 1);
    const body = appSource.slice(start, next === -1 ? appSource.length : next);
    assert.match(body, /sessionControllerRef\.current\.capture\(/, `${name} captures session`);
    assert.match(body, /sessionControllerRef\.current\.isCurrent\(context\)|applyProtectedResponse\(/, `${name} guards response and error`);
  }
  assert.doesNotMatch(appSource, /apiBaseUrl|providerEndpoint|Provider 호출은 클라이언트/);
});

test("설정 저장은 성공과 실패 전에 key draft를 폐기하고 현재 session의 test ready만 chat을 활성화한다", () => {
  const loadStart = appSource.indexOf("async function loadPersonalAi");
  const saveStart = appSource.indexOf("async function savePersonalAiConfig");
  const testStart = appSource.indexOf("async function testPersonalAiConnection", saveStart);
  const loadBody = appSource.slice(loadStart, saveStart);
  const saveBody = appSource.slice(saveStart, testStart);
  assert.match(saveBody, /const apiKeyDraft = llmApiKey;/);
  assert.match(saveBody, /setLlmApiKey\(""\);/);
  assert.match(appSource, /setPersonalAiTestReady\(result\.success && result\.connectionStatus === "ready"\)/);
  assert.match(appSource, /if \(!token \|\| !personalAiTestReady/);
  assert.match(appSource, /disabled=\{!personalAiTestReady/);
  assert.match(appSource, /if \(!token \|\| personalAiConfigDirty/);
  assert.match(loadBody, /if \(!activeToken \|\| personalAiConfigDirty/);
  assert.doesNotMatch(loadBody, /setPersonalAiConfigDirty\(false\)/);
  assert.match(appSource, /disabled=\{Boolean\(personalAiPendingAction\) \|\| personalAiConfigDirty/);
  for (const functionName of ["loadPersonalAi", "savePersonalAiConfig"]) {
    const start = appSource.indexOf(`async function ${functionName}`);
    const next = appSource.indexOf("\n  async function ", start + 1);
    assert.match(appSource.slice(start, next), /setPersonalAiTestReady\(false\)/, `${functionName} invalidates current-session readiness`);
  }
  assert.match(appSource, /onChangeText=\{\(value\) => \{ setLlmModel\(value\); setLlmConnectionStatus\("untested"\); setPersonalAiTestReady\(false\); setPersonalAiConfigDirty\(true\); \}\}/);
  assert.match(appSource, /onChangeText=\{\(value\) => \{ setLlmApiKey\(value\); setLlmConnectionStatus\("untested"\); setPersonalAiTestReady\(false\); setPersonalAiConfigDirty\(true\); \}\}/);
  assert.match(appSource, /setPersonalAiConfigDirty\(true\)/);
  assert.match(appSource, /if \(option\.provider !== llmProvider\) \{ setLlmProvider\(option\.provider\); setLlmModel\(""\); setLlmApiKey\(""\);/);
  assert.match(saveBody, /setPersonalAiConfigDirty\(false\)/);
  assert.match(appSource, /personalAiActionGateRef\.current\.reset\(\)/);
  assert.match(appSource, /setPersonalAiPendingAction\(""\)/);
});

test("AI와 설정 진입은 server state를 갱신하고 입력 및 동작 접근성 이름을 제공한다", () => {
  assert.match(appSource, /item\.id === "settings" \|\| \(item\.id === "ai" && !personalAiTestReady\)/);
  assert.match(appSource, /void loadPersonalAi\(token\)/);
  for (const label of ["개인 AI 질문", "개인 AI 질문 보내기", "개인 AI 모델", "개인 AI API 키", "개인 AI 연결 시험", "개인 AI 설정 저장"]) {
    assert.match(appSource, new RegExp(`accessibilityLabel="${label}"`));
  }
});
