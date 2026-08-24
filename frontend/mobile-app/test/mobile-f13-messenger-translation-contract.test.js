const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const modulePath = path.resolve(__dirname, "..", "messenger-translation.js");

function loadMessengerTranslation() {
  assert.equal(fs.existsSync(modulePath), true, "messenger translation model exists");
  delete require.cache[modulePath];
  return require(modulePath);
}

test("대화방 언어 payload는 승인 locale만 허용한다", () => {
  const { buildTranslationPayload } = loadMessengerTranslation();

  assert.deepEqual(buildTranslationPayload("EN"), { translationLocale: "en" });
  assert.throws(() => buildTranslationPayload("secret-locale"), /지원하지 않는 번역 언어/);
});

test("메신저 view model은 선택 방과 언어 선택지를 만든다", () => {
  const { messengerViewModel } = loadMessengerTranslation();
  const view = messengerViewModel({
    rooms: [{ roomId: "r1", roomName: "전략 TF", translationLocale: "ko" }],
    selectedRoomId: "r1",
    messages: [{ messageId: "x1", roomId: "r1", body: "확인" }],
  });

  assert.equal(view.selectedRoom.roomId, "r1");
  assert.deepEqual(view.messages.map(({ messageId }) => messageId), ["x1"]);
  assert.deepEqual(view.languageOptions.map(({ value, label }) => [value, label]), [["ko", "한국어"], ["en", "English"]]);
});
