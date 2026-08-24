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

module.exports = {
  calendarLayoutModel,
  navigationModel,
};

