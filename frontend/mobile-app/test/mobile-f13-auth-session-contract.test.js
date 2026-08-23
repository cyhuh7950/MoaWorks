const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "App.tsx"), "utf8");
const {
  normalizeLoginIdentifier,
  requestJson,
  isSessionInvalidatedError,
} = require("../auth-session.js");

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

test("사내 아이디와 이메일 로그인 식별자를 운영 이메일 주소로 정규화한다", () => {
  assert.equal(normalizeLoginIdentifier(" sinsan "), "sinsan@moaworks.sinsan.kr");
  assert.equal(normalizeLoginIdentifier(" sinsan@example.com "), "sinsan@example.com");
  assert.equal(normalizeLoginIdentifier("   "), "");
});

test("401과 403 응답은 중앙 세션 정리 신호를 포함해 실패한다", async () => {
  for (const status of [401, 403]) {
    await assert.rejects(
      requestJson({
        apiBase: "https://api.moaworks.sinsan.kr/api/v1",
        path: "/auth/me",
        fetchImpl: async () => response(status, { detail: { userMessage: "숨겨진 서버 메시지" } }),
      }),
      (error) => error.status === status && isSessionInvalidatedError(error),
    );
  }
});

test("운영 로그인은 개발 우회 없이 auth login과 auth me 검증 뒤에만 업무 화면을 연다", () => {
  assert.match(appSource, /import \{[^}]*\bPressable\b[^}]*\} from "react-native";/);
  assert.doesNotMatch(appSource, /__DEV__|developmentAuthBypassEnabled|development-only-session/);
  assert.match(appSource, /normalizeLoginIdentifier\(email\)/);
  assert.match(appSource, /request<\{ accessToken: string; user: AuthUser \}>\("\/auth\/login"/);
  assert.match(appSource, /request<\{ user: AuthUser \}>\("\/auth\/me"/);
  assert.match(appSource, /const meBody[\s\S]*setToken\(login\.accessToken\)[\s\S]*setMe\(meBody\.user\)/);
  assert.match(appSource, /function clearSession\(/);
  assert.match(appSource, /isSessionInvalidatedError\(error\)/);
});

test("두 로그아웃 경로는 동일한 중앙 세션 정리를 사용한다", () => {
  const logoutCalls = appSource.match(/onPress=\{\(\) => \{\s*clearSession\("로그아웃되었습니다\."\);\s*\}\}/g) || [];
  assert.equal(logoutCalls.length, 2);
  assert.match(appSource, /setDocuments\(\[\]\)/);
  assert.match(appSource, /setMailItems\(\[\]\)/);
  assert.match(appSource, /setRooms\(\[\]\)/);
  assert.match(appSource, /setFiles\(\[\]\)/);
  assert.match(appSource, /setActiveTab\("home"\)/);
  assert.match(appSource, /const activeSessionTokenRef = useRef\(""\)/);
  assert.match(appSource, /activeSessionTokenRef\.current = ""/);
  assert.match(appSource, /activeSessionTokenRef\.current = login\.accessToken/);
});
