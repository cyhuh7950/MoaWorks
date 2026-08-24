const bottom = Object.freeze([
  Object.freeze({ id: "home", label: "홈", icon: "home" }),
  Object.freeze({ id: "mail", label: "메일", icon: "mail" }),
  Object.freeze({ id: "approval", label: "결재", icon: "approval" }),
  Object.freeze({ id: "chat", label: "메신저", icon: "chat" }),
  Object.freeze({ id: "calendar", label: "일정", icon: "calendar" }),
  Object.freeze({ id: "more", label: "더보기", icon: "more" }),
]);

const more = Object.freeze([
  Object.freeze({ id: "directory", label: "주소록", icon: "directory" }),
  Object.freeze({ id: "ai", label: "AI 채팅", icon: "ai" }),
  Object.freeze({ id: "search", label: "업무 검색", icon: "search" }),
  Object.freeze({ id: "settings", label: "설정", icon: "settings" }),
]);

function navigationModel() {
  return { bottom, more };
}

function calendarLayoutModel() {
  return {
    columns: 7,
    weekdayLabels: ["일", "월", "화", "수", "목", "금", "토"],
    typeScale: { body: 12, supporting: 10, title: 18 },
  };
}

function buildHomeViewModel({ userName = "", mailItems = [], documents = [], todaySchedules = [], rooms = [] } = {}) {
  return {
    greeting: `안녕하세요, ${String(userName).trim()}님!`,
    summary: [
      { id: "mail", label: "안 읽은 메일", count: mailItems.filter((item) => !item.isRead).length },
      { id: "approval", label: "결재 대기", count: documents.filter((item) => item.status === "submitted").length },
    ],
    todaySchedules: todaySchedules.slice(0, 4),
    recentRooms: rooms.slice(0, 3),
  };
}

function approvalViewModel({ documents = [], view = "progress", selectedId = "" } = {}) {
  const statusGroups = {
    draft: new Set(["draft"]),
    progress: new Set(["submitted"]),
    complete: new Set(["approved", "rejected", "withdrawn"]),
  };
  const activeStatuses = statusGroups[view] || statusGroups.progress;
  const rows = documents.filter((document) => activeStatuses.has(document.status));
  const selected = rows.find((document) => document.id === selectedId) || rows[0] || null;
  return {
    tabs: ["초안", "진행 중", "완료"],
    rows,
    selected,
  };
}

module.exports = {
  approvalViewModel,
  buildHomeViewModel,
  calendarLayoutModel,
  navigationModel,
};
