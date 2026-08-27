import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

test("사용자 웹과 관리자 웹이 같은 공통 글꼴 토큰을 사용한다", () => {
  const userCss = read("../src/global.css");
  const adminCss = read("../../admin-web/src/styles.css");
  assert.match(userCss, /--moaworks-font-family:[^;]*Pretendard/);
  assert.match(adminCss, /--moaworks-font-family:[^;]*Pretendard/);
});

test("관리자와 모바일의 항상 보이는 헤더에서 로그아웃할 수 있다", () => {
  const adminApp = read("../../admin-web/src/App.tsx");
  const mobileApp = read("../../mobile-app/App.tsx");
  assert.match(adminApp, /aria-label="관리자 로그아웃"/);
  assert.match(mobileApp, /accessibilityLabel="헤더 로그아웃"/);
});

test("웹과 모바일 메신저가 빈 목록이 아니어도 새 대화 진입을 전면에 둔다", () => {
  const messenger = read("../src/MessengerPanel.tsx");
  const mobileApp = read("../../mobile-app/App.tsx");
  assert.match(messenger, /새 대화 시작/);
  assert.match(mobileApp, /accessibilityLabel="새 대화 시작"/);
});
