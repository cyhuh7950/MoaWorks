const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appSource = fs.readFileSync(path.join(__dirname, "..", "App.tsx"), "utf8");

test("홈에 임직원 검색 입력과 조회 진입점이 있다", () => {
  assert.match(appSource, /accessibilityLabel=["']홈 임직원 검색["']/);
  assert.match(appSource, /accessibilityLabel=["']임직원 검색 실행["']/);
});

test("임직원 검색 결과는 닫을 수 있는 정보 팝업으로 표시된다", () => {
  assert.match(appSource, /<Modal[\s\S]*visible=\{employeeSearchOpen\}/);
  assert.match(appSource, /accessibilityLabel=["']임직원 검색 결과 닫기["']/);
  assert.match(appSource, /employeeSearchResults/);
});

test("홈에서 AI 채팅 버튼이 기존 AI 화면으로 이동한다", () => {
  assert.match(appSource, /accessibilityLabel=["']AI 채팅 열기["']/);
  assert.match(appSource, /setActiveTab\(["']more["']\)/);
  assert.match(appSource, /setMoreScreen\(["']ai["']\)/);
});

