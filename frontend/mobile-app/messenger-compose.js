function buildRoomCreatePayload(form, users, currentUserId) {
  if (!currentUserId) throw new Error("로그인이 필요합니다.");
  if (!["direct", "group"].includes(form.roomType)) throw new Error("대화 유형을 선택해 주세요.");
  const ids = [...new Set(form.participantUserIds || [])].filter((id) => id !== currentUserId);
  if (!ids.length || ids.length > 99 || (form.roomType === "direct" && ids.length !== 1)) {
    throw new Error(form.roomType === "direct" ? "1:1 대화 상대를 한 명 선택해 주세요." : "참여자는 본인을 제외하고 1~99명 선택해 주세요.");
  }
  const directory = new Map(users.map((user) => [user.id, user]));
  if (ids.some((id) => !directory.has(id))) throw new Error("참여자 목록을 새로 불러온 뒤 다시 선택해 주세요.");
  const roomName = String(form.roomType === "direct" ? directory.get(ids[0]).name : form.roomName || "").trim();
  if (!roomName || [...roomName].length > 80) throw new Error("대화방 이름은 1~80자로 입력해 주세요.");
  return { roomType: form.roomType, roomName, participantUserIds: ids, translationLocale: "ko" };
}
module.exports = { buildRoomCreatePayload };
