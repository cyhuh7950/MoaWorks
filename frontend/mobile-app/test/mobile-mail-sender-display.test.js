const test = require("node:test");
const assert = require("node:assert/strict");

const {
  formatMailSender,
  resolveMailSenderDisplayMode,
  senderEmailId,
} = require("../mail-sender-display.js");

test("모바일 ID 모드는 trim한 이메일의 첫 @ 앞 원문을 표시한다", () => {
  assert.equal(senderEmailId(" Hong@Example.com "), "Hong");
  assert.equal(senderEmailId("first@alias@example.com"), "first");
  assert.equal(formatMailSender("홍길동", " Hong@Example.com ", "id"), "Hong");
});

test("모바일 ID 모드는 잘못된 이메일에 ID 정보 없음으로 fallback한다", () => {
  assert.equal(senderEmailId(""), null);
  assert.equal(senderEmailId("missing-at"), null);
  assert.equal(senderEmailId("@example.com"), null);
  assert.equal(formatMailSender("", "missing-at", "id"), "ID 정보 없음");
});

test("모바일 이름 계열 모드는 이름과 이메일 누락 계약을 유지한다", () => {
  assert.equal(formatMailSender("", "hong@example.com", "name"), "이름 정보 없음");
  assert.equal(formatMailSender("", "hong@example.com", "name_email"), "이름 정보 없음 <hong@example.com>");
  assert.equal(formatMailSender("", "", "name_email"), "이름 정보 없음");
});

test("모바일 preference 누락 또는 알 수 없는 값은 name으로 fallback한다", () => {
  assert.equal(resolveMailSenderDisplayMode(), "name");
  assert.equal(resolveMailSenderDisplayMode({}), "name");
  assert.equal(resolveMailSenderDisplayMode({ senderDisplayMode: "email" }), "name");
  assert.equal(resolveMailSenderDisplayMode({ senderDisplayMode: "id" }), "id");
});
