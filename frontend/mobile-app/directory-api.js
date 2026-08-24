function directoryUsers(body) { return Array.isArray(body?.users) ? body.users : []; }
function normalized(value) { return String(value || "").replace(/\s+/g, "").toLowerCase(); }
function filterDirectoryUsers(users, query) {
  const needle = normalized(query);
  if (!needle) return Array.isArray(users) ? users : [];
  return (Array.isArray(users) ? users : []).filter((user) => normalized(`${user.name} ${user.department_name} ${user.role_name} ${user.email}`).includes(needle));
}
function mailtoUrl(email) {
  const value = String(email || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? `mailto:${value}` : "";
}
function directRoomPayload(user) {
  if (!user?.id || !String(user.name || "").trim()) throw new Error("대화 상대 정보가 필요합니다.");
  return { roomName: String(user.name).trim(), roomType: "direct", participantUserIds: [user.id], translationLocale: "ko" };
}
function createDirectoryActionGate() {
  const busy = new Set();
  return { tryEnter(id) { if (busy.has(id)) return false; busy.add(id); return true; }, release(id) { busy.delete(id); }, reset() { busy.clear(); }, isBusy(id) { return busy.has(id); } };
}
module.exports = { createDirectoryActionGate, directoryUsers, directRoomPayload, filterDirectoryUsers, mailtoUrl };
