const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const designModulePath = path.resolve(__dirname, "..", "mobile-ui-design.js");

function loadDesign() {
  assert.equal(fs.existsSync(designModulePath), true, "mobile UI design model exists");
  delete require.cache[designModulePath];
  return require(designModulePath);
}

test("정본 하단 메뉴와 더보기 메뉴 순서를 그대로 사용한다", () => {
  const navigation = loadDesign().navigationModel();

  assert.deepEqual(navigation.bottom.map(({ id, label }) => [id, label]), [
    ["home", "홈"],
    ["mail", "메일"],
    ["approval", "결재"],
    ["chat", "메신저"],
    ["calendar", "일정"],
    ["more", "더보기"],
  ]);
  assert.deepEqual(navigation.more.map(({ id, label }) => [id, label]), [
    ["directory", "주소록"],
    ["ai", "AI 채팅"],
    ["search", "업무 검색"],
    ["settings", "설정"],
  ]);
  assert.equal(navigation.bottom.some(({ id }) => id === "files"), false);
});

test("정본 밀도와 7열 달력 상수를 고정한다", () => {
  assert.deepEqual(loadDesign().calendarLayoutModel(), {
    columns: 7,
    weekdayLabels: ["일", "월", "화", "수", "목", "금", "토"],
    typeScale: { body: 12, supporting: 10, title: 18 },
  });
});

test("홈 view model은 사용자와 핵심 업무를 목업 순서로 만든다", () => {
  const { buildHomeViewModel } = loadDesign();
  const view = buildHomeViewModel({
    userName: "김모아",
    mailItems: [{ isRead: false }, { isRead: true }],
    documents: [{ status: "submitted" }],
    todaySchedules: [{ id: "s1", title: "회의" }],
    rooms: [{ roomId: "r1", roomName: "전략 TF", lastMessage: "확인했습니다." }],
  });

  assert.equal(view.greeting, "안녕하세요, 김모아님!");
  assert.deepEqual(view.summary.map(({ label, count }) => [label, count]), [
    ["안 읽은 메일", 1],
    ["결재 대기", 1],
  ]);
  assert.deepEqual(view.todaySchedules.map(({ id }) => id), ["s1"]);
  assert.deepEqual(view.recentRooms.map(({ roomId }) => roomId), ["r1"]);
});
