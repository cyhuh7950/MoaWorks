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

test("결재 view model은 상태 탭과 선택 문서를 일관되게 만든다", () => {
  const { approvalViewModel } = loadDesign();
  const documents = [
    { id: "d1", status: "draft", title: "초안" },
    { id: "d2", status: "submitted", title: "진행" },
    { id: "d3", status: "approved", title: "완료" },
  ];

  const view = approvalViewModel({ documents, view: "progress", selectedId: "missing" });

  assert.deepEqual(view.tabs, ["초안", "진행 중", "완료"]);
  assert.deepEqual(view.rows.map(({ id }) => id), ["d2"]);
  assert.equal(view.selected.id, "d2");
});

test("일정 view model은 7개 요일과 선택일 일정만 반환한다", () => {
  const { calendarViewModel } = loadDesign();
  const view = calendarViewModel({
    cells: Array.from({ length: 35 }, (_, index) => ({ dateKey: `2026-08-${String(index + 1).padStart(2, "0")}`, day: index + 1 })),
    schedules: [{ id: "s1", title: "회의", starts_at: "2026-08-24T10:00:00+09:00" }],
    selectedDateKey: "2026-08-24",
    timezone: "Asia/Seoul",
  });

  assert.deepEqual(view.weekdayLabels, ["일", "월", "화", "수", "목", "금", "토"]);
  assert.equal(view.columns, 7);
  assert.deepEqual(view.selectedSchedules.map(({ id }) => id), ["s1"]);
});

test("주소록 view model은 섹션과 검색 결과를 만든다", () => {
  const { directoryViewModel } = loadDesign();
  const view = directoryViewModel({
    users: [{ id: "u1", name: "김모아", department_name: "기획", role_name: "팀장", email: "kim@example.com" }],
    query: "기획",
    section: "all",
  });

  assert.deepEqual(view.sections, ["전체", "즐겨찾기", "최근 연락처"]);
  assert.deepEqual(view.rows.map(({ id }) => id), ["u1"]);
});

test("AI view model은 Provider 상태와 대화 순서를 보존한다", () => {
  const { aiViewModel } = loadDesign();
  const messages = [{ role: "assistant", body: "안녕하세요" }];
  const view = aiViewModel({ messages, provider: "openai", connectionStatus: "ready" });

  assert.equal(view.providerLabel, "OPENAI");
  assert.equal(view.ready, true);
  assert.deepEqual(view.messages, messages);
});
