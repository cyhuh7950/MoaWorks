const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "..", "App.tsx"), "utf8");

test("설정은 진입 화면을 기억하는 화면/Android 뒤로가기를 제공한다", () => {
  assert.match(source, /accessibilityLabel="설정 이전 화면으로"/);
  assert.match(source, /BackHandler\.addEventListener\("hardwareBackPress"/);
  assert.match(source, /onPress=\{openSettings\}/);
  assert.match(source, /settingsHistoryRef\.current\.reset\(\)/);
});

test("설정 history는 AI/더보기 복귀, 중복 진입, 세션 reset을 처리한다", () => {
  const { createSettingsHistory } = require("../mobile-navigation.js");
  const history = createSettingsHistory();
  const ai = { activeTab: "more", moreScreen: "ai", moreMenuOpen: false };
  const settings = history.enter(ai);
  history.enter(settings);
  assert.deepEqual(history.back(), ai);
  const menu = { activeTab: "more", moreScreen: "directory", moreMenuOpen: true };
  history.enter(menu);
  assert.deepEqual(history.back(), menu);
  const settingsMenu = { activeTab: "more", moreScreen: "settings", moreMenuOpen: true };
  history.enter(settingsMenu);
  assert.deepEqual(history.back(), settingsMenu);
  history.enter(ai);
  history.reset();
  assert.equal(history.back().activeTab, "home");
});

test("동일 역할 글자는 공통 크기/굵기/행간이며 플랫폼 글꼴과 레이아웃은 보존한다", () => {
  const { withMobileTypography } = require("../mobile-typography.js");
  const raw = { listTitle: { fontSize: 20, fontWeight: "800", marginTop: 8 }, employeeSearchName: { fontSize: 13 }, listBody: { color: "#475569" }, surfaceTitle: { fontSize: 26 }, messengerSendText: { fontSize: 22 } };
  const result = withMobileTypography(raw);
  assert.equal(result.listTitle.fontSize, 14);
  assert.equal(result.listTitle.fontWeight, "600");
  assert.equal(result.employeeSearchName.fontSize, result.listTitle.fontSize);
  assert.equal(result.listBody.lineHeight, 20);
  assert.equal(result.surfaceTitle.fontSize, 18);
  assert.equal(result.listTitle.marginTop, 8);
  assert.equal(raw.listTitle.fontSize, 20);
  assert.equal(result.messengerSendText.fontSize, 22);
  assert.equal(result.listTitle.fontFamily, undefined);
  assert.match(source, /StyleSheet\.create\(withMobileTypography\(/);
});

const users = [{ id: "me", name: "본인" }, { id: "u1", name: "김하나" }, { id: "u2", name: "이둘" }];
test("생성 payload는 1:1과 그룹을 분리하고 본인/중복/잘못된 참여자를 처리한다", () => {
  const { buildRoomCreatePayload } = require("../messenger-compose.js");
  const build = (form) => buildRoomCreatePayload(form, users, "me");
  assert.deepEqual(build({ roomType: "direct", participantUserIds: ["u1"] }), { roomType: "direct", roomName: "김하나", participantUserIds: ["u1"], translationLocale: "ko" });
  assert.deepEqual(build({ roomType: "group", roomName: " 개발팀 ", participantUserIds: ["me", "u1", "u2", "u1"] }), { roomType: "group", roomName: "개발팀", participantUserIds: ["u1", "u2"], translationLocale: "ko" });
  for (const form of [
    { roomType: "direct", participantUserIds: [] },
    { roomType: "direct", participantUserIds: ["u1", "u2"] },
    { roomType: "group", roomName: "", participantUserIds: ["u1"] },
    { roomType: "group", roomName: "방", participantUserIds: ["foreign"] },
    { roomType: "other", participantUserIds: ["u1"] },
  ]) assert.throws(() => build(form));
});

test("그룹 생성은 본인 포함 100명, 이름 80자 한도를 지킨다", () => {
  const { buildRoomCreatePayload } = require("../messenger-compose.js");
  const directory = Array.from({ length: 100 }, (_, i) => ({ id: `u${i}`, name: `사용자${i}` }));
  const form = { roomType: "group", roomName: "방", participantUserIds: directory.slice(0, 99).map((u) => u.id) };
  assert.equal(buildRoomCreatePayload(form, directory, "me").participantUserIds.length, 99);
  assert.throws(() => buildRoomCreatePayload({ ...form, participantUserIds: directory.map((u) => u.id) }, directory, "me"));
  assert.throws(() => buildRoomCreatePayload({ ...form, roomName: "가".repeat(81) }, directory, "me"));
});

test("앱 새 대화는 유형/참여자/검색/생성 UI와 세션·중복 제출 보호를 연결한다", () => {
  assert.ok(source.includes('["group", "그룹 대화"]') && source.includes('accessibilityLabel={label}'));
  assert.match(source, /accessibilityLabel="대화 참여자 검색"/);
  assert.match(source, /accessibilityLabel="대화방 생성"/);
  assert.match(source, /onPress=\{openRoomComposer\}/);
  assert.match(source, /if \(roomCreateGateRef\.current\) return;/);
  assert.match(source, /buildRoomCreatePayload\(roomCreateForm, directoryUsers, me\?\.userId\)/);
  assert.match(source, /if \(!sessionControllerRef\.current\.isCurrent\(context\)\) return;/);
});

test("선택 여부는 글자 크기를 바꾸지 않고 색상 전용 보조 스타일은 글자를 덮지 않는다", () => {
  const { withMobileTypography } = require("../mobile-typography.js");
  const result = withMobileTypography({
    mailFilter: { fontSize: 9, color: "#222" }, mailFilterActive: { fontSize: 9, fontWeight: "800", color: "#fff" },
    calendarWeekday: { fontSize: 10 }, calendarSunday: { color: "#f00" },
  });
  assert.equal(result.mailFilter.fontSize, result.mailFilterActive.fontSize);
  assert.equal(result.mailFilterActive.fontWeight, "600");
  assert.deepEqual(result.calendarSunday, { color: "#f00" });
  assert.equal({ ...result.calendarWeekday, ...result.calendarSunday }.fontSize, result.calendarWeekday.fontSize);
});

test("sparse 선택 탭은 기본 탭 역할을 상속하고 모든 메시지 본문은 body 역할을 공유한다", () => {
  const { withMobileTypography } = require("../mobile-typography.js");
  const result = withMobileTypography({
    mailboxTabText: { fontSize: 9 }, mailboxTabTextActive: { fontWeight: "800", color: "#fff" },
    approvalTabText: { fontSize: 10 }, approvalTabTextActive: { fontWeight: "800" },
    messageTextMine: { fontSize: 12 }, aiMessageTextUser: { fontSize: 14 },
  });
  assert.equal(result.mailboxTabTextActive.fontSize, result.mailboxTabText.fontSize);
  assert.equal(result.mailboxTabTextActive.lineHeight, result.mailboxTabText.lineHeight);
  assert.equal(result.approvalTabTextActive.fontSize, result.approvalTabText.fontSize);
  assert.deepEqual(
    [result.messageTextMine.fontSize, result.messageTextMine.lineHeight, result.messageTextMine.fontWeight],
    [result.aiMessageTextUser.fontSize, result.aiMessageTextUser.lineHeight, result.aiMessageTextUser.fontWeight],
  );
  assert.deepEqual([result.messageTextMine.fontSize, result.messageTextMine.lineHeight], [14, 20]);
});
