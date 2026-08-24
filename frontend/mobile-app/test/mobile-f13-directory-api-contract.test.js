const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  createDirectoryActionGate,
  directoryUsers,
  directRoomPayload,
  filterDirectoryUsers,
  mailtoUrl,
} = require("../directory-api.js");

const appSource = fs.readFileSync(path.resolve(__dirname, "..", "App.tsx"), "utf8");

test("directory {users}만 읽고 이름·부서·역할·이메일을 공백/대소문자 무시 검색한다", () => {
  const users = directoryUsers({ users: [{ id: "u1", name: "홍 길동", email: "HONG@example.com", department_name: " 개발 ", role_name: "매니저" }] });
  assert.deepEqual(directoryUsers({ members: users }), []);
  assert.deepEqual(filterDirectoryUsers(users, "  개발  ").map((user) => user.id), ["u1"]);
  assert.deepEqual(filterDirectoryUsers(users, "hong@EXAMPLE").map((user) => user.id), ["u1"]);
});

test("메일은 유효 이메일만 URL로 만들고 direct room payload는 승인 계약만 만든다", () => {
  assert.equal(mailtoUrl("hong@example.com"), "mailto:hong@example.com");
  assert.equal(mailtoUrl("not an email"), "");
  assert.deepEqual(directRoomPayload({ id: "u1", name: "홍길동" }), { roomName: "홍길동", roomType: "direct", participantUserIds: ["u1"], translationLocale: "ko" });
  assert.throws(() => directRoomPayload({ id: "", name: "" }));
});

test("production direct room gate는 동시 제출을 막고 reset 후 재시도를 허용한다", () => {
  const gate = createDirectoryActionGate();
  assert.equal(gate.tryEnter("u1"), true);
  assert.equal(gate.tryEnter("u1"), false);
  assert.equal(gate.tryEnter("u2"), true);
  gate.reset();
  assert.equal(gate.tryEnter("u1"), true);
  gate.release("u1");
  assert.equal(gate.isBusy("u1"), false);
});

test("App은 directory API/reset/메일/비활성 전화/direct room production wiring을 사용한다", () => {
  assert.match(appSource, /request<\{ users: DirectoryUser\[\] \}>\("\/workspace\/directory"/);
  assert.match(appSource, /setDirectoryUsers\(readDirectoryUsers\(body\)\)/);
  assert.match(appSource, /directoryActionGateRef\.current\.reset\(\)/);
  assert.match(appSource, /Linking\.openURL\(url\)/);
  assert.match(appSource, /accessibilityLabel="전화번호 미제공"/);
  assert.match(appSource, /disabled=\{true\}/);
  assert.match(appSource, /request<\{ roomId: string \}>\("\/messenger\/rooms", \{ method: "POST"/);
  assert.match(appSource, /directRoomPayload\(member\)/);
  assert.match(appSource, /if \(!directoryActionGateRef\.current\.tryEnter\(member\.id\)\) return;/);
});
