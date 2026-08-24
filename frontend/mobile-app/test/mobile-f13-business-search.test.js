const test = require("node:test");
const assert = require("node:assert/strict");

let businessSearch;
try {
  businessSearch = require("../business-search.js");
} catch {
  businessSearch = {};
}

test("업무 검색은 정규화와 현재 로드된 요약 검색 함수를 제공한다", () => {
  assert.equal(typeof businessSearch.normalizeBusinessSearchText, "function");
  assert.equal(typeof businessSearch.searchLoadedBusinessSummaries, "function");
  assert.equal(typeof businessSearch.updateBusinessSearchWarnings, "function");
});

test("부분 로드 경고는 허용된 source key만 중복 없이 보존하고 성공한 source만 제거한다", () => {
  let warnings = businessSearch.updateBusinessSearchWarnings([], "mail", true);
  warnings = businessSearch.updateBusinessSearchWarnings(warnings, "schedule", true);
  warnings = businessSearch.updateBusinessSearchWarnings(warnings, "mail", true);
  warnings = businessSearch.updateBusinessSearchWarnings(warnings, "hidden endpoint: /private", true);
  assert.deepEqual(warnings, ["mail", "schedule"]);
  assert.deepEqual(businessSearch.updateBusinessSearchWarnings(warnings, "mail", false), ["schedule"]);
});

test("Unicode 호환문자, 대소문자와 연속 공백을 같은 검색어로 정규화한다", () => {
  assert.equal(businessSearch.normalizeBusinessSearchText("  ＡＢＣ\t팀   회의  "), "abc 팀 회의");
  assert.equal(businessSearch.normalizeBusinessSearchText(null), "");
});

test("모든 query token을 허용된 현재-session 요약 필드에서만 찾아 고정 결과 shape로 반환한다", () => {
  const results = businessSearch.searchLoadedBusinessSummaries(" 영업   박 ", {
    mailItems: [
      { mailId: "mail-1", subject: "영업 주간 보고", senderEmail: "park@example.com", preview: "박 대리 공유" },
    ],
    documents: [
      { id: "approval-1", title: "영업 비용 승인", creatorUserName: "박 대리", status: "submitted", content: "검색 제외 본문" },
    ],
    rooms: [
      { roomId: "room-1", roomName: "영업 1팀", lastMessage: "박 대리 확인" },
    ],
    schedules: [
      { id: "schedule-1", title: "영업 회의", starts_at: "2026-08-24T09:00:00+09:00", description: "박 대리 참석", location: "3층" },
    ],
    directoryUsers: [
      { id: "user-1", name: "박신산", email: "park@example.com", department_name: "영업팀", role_name: "대리" },
    ],
    files: [
      { id: "file-1", file_name: "영업_박대리.xlsx", content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", status: "active" },
    ],
  });

  assert.deepEqual(results, [
    { category: "mail", id: "mail-1", title: "영업 주간 보고", summary: "park@example.com · 박 대리 공유", target: { screen: "mail", id: "mail-1" } },
    { category: "approval", id: "approval-1", title: "영업 비용 승인", summary: "박 대리 · submitted", target: { screen: "approval", id: "approval-1" } },
    { category: "messenger", id: "room-1", title: "영업 1팀", summary: "박 대리 확인", target: { screen: "chat", id: "room-1" } },
    { category: "schedule", id: "schedule-1", title: "영업 회의", summary: "2026-08-24T09:00:00+09:00 · 3층 · 박 대리 참석", target: { screen: "calendar", id: "schedule-1" } },
    { category: "directory", id: "user-1", title: "박신산", summary: "영업팀 · 대리 · park@example.com", target: { screen: "directory", id: "user-1" } },
    { category: "file", id: "file-1", title: "영업_박대리.xlsx", summary: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet · active", target: { screen: "files", id: "file-1" } },
  ]);
});

test("민감·상세·숨은 필드는 색인하지 않고 malformed record를 버리며 category/title 순으로 50개만 반환한다", () => {
  const secretNeedle = "never-index-this-secret";
  const mailItems = Array.from({ length: 55 }, (_, index) => ({
    mailId: `mail-${String(index).padStart(2, "0")}`,
    subject: `공개 제목 ${String(54 - index).padStart(2, "0")}`,
    senderEmail: "sender@example.com",
    preview: "현재 불러온 요약",
  }));
  const sources = {
    mailItems: [
      ...mailItems,
      null,
      { mailId: "", subject: "빈 식별자" },
      { mailId: "secret-mail", subject: "일반 제목", senderEmail: "sender@example.com", token: secretNeedle, password: secretNeedle, apiKey: secretNeedle, bodyText: secretNeedle, bodyHtml: secretNeedle, endpoint: secretNeedle },
    ],
    documents: [{ id: "secret-approval", title: "일반 결재", creatorUserName: "작성자", status: "draft", content: secretNeedle }],
    rooms: [{ roomId: "secret-room", roomName: "일반 대화방", lastMessage: null, messages: [{ body: secretNeedle }] }],
    schedules: [{ id: "", title: "식별자 없는 일정", description: secretNeedle }],
    directoryUsers: [{ id: "secret-user", name: "일반 사용자", email: "user@example.com", department_name: "개발", role_name: "사원", password: secretNeedle }],
    files: [{ id: "secret-file", file_name: "일반.txt", content_type: "text/plain", status: "active", downloadUrl: secretNeedle }],
  };

  assert.deepEqual(businessSearch.searchLoadedBusinessSummaries(secretNeedle, sources), []);
  const results = businessSearch.searchLoadedBusinessSummaries("공개", sources);
  assert.equal(results.length, 50);
  assert.equal(results[0].title, "공개 제목 00");
  assert.equal(results[49].title, "공개 제목 49");
  assert.equal(JSON.stringify(results).includes(secretNeedle), false);
});
