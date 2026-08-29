// 실제 App의 React 상태/effect를 실행한다. RN 호스트와 API만 격리한다.
// 저장소에 이미 설치된 user-web의 React DOM/jsdom QA 도구를 재사용한다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { randomUUID } = require("node:crypto");
const webRequire = createRequire(path.resolve(__dirname, "../../user-web/package.json"));
const React = webRequire("react");
const { createRoot } = webRequire("react-dom/client");
const { JSDOM } = webRequire("jsdom");
const { transformSync } = require("@babel/core");
const filename = path.resolve(__dirname, "../App.tsx");
const compiled = transformSync(fs.readFileSync(filename, "utf8"), {
  filename, presets: [require.resolve("@react-native/babel-preset")], babelrc: false, configFile: false,
}).code;

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

async function mountApp(t) {
  const dom = new JSDOM("<div id='root'></div>", { url: "https://fixture.invalid" });
  const saved = Object.fromEntries(["window", "document", "fetch", "IS_REACT_ACT_ENVIRONMENT"].map((key) => [key, global[key]]));
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const propsByNode = new WeakMap();
  const hardwareBack = new Set();
  const native = (tag) => React.forwardRef((props, forwardedRef) => {
    const input = tag === "input";
    const style = Object.assign({}, ...[props.style].flat(4).filter(Boolean));
    return React.createElement(tag, {
      ref(node) {
        if (node) propsByNode.set(node, props);
        if (typeof forwardedRef === "function") forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
      },
      "data-label": props.accessibilityLabel,
      "aria-checked": props.accessibilityState?.checked,
      disabled: props.disabled || props.editable === false,
      style,
      ...(input ? { value: props.value ?? "", readOnly: true } : {}),
    }, ...(input ? [] : [props.children ?? props.title]));
  });
  const rn = {
    View: native("div"), Text: native("span"), Pressable: native("button"), TextInput: native("input"),
    SafeAreaView: native("div"), ScrollView: native("div"), KeyboardAvoidingView: native("div"), Button: native("button"),
    Modal: ({ visible, children }) => visible ? children : null,
    Platform: { OS: "android" }, StyleSheet: { create: (styles) => styles },
    AppState: { addEventListener: () => ({ remove() {} }) },
    BackHandler: { addEventListener: (_event, fn) => { hardwareBack.add(fn); return { remove: () => hardwareBack.delete(fn) }; } },
    Linking: { openURL: async () => {} }, Alert: { alert() {} },
  };
  const module = { exports: {} };
  const appRequire = createRequire(filename);
  new Function("require", "module", "exports", compiled)((id) => {
    if (id === "react-native") return rn;
    if (id === "react" || id.startsWith("react/")) return webRequire(id);
    return appRequire(id);
  }, module, module.exports);
  const user = { userId: "me", userName: "시험 사용자", userEmail: "qa@fixture.invalid", roleName: "user", permissions: [] };
  const directory = [
    { id: "me", name: user.userName, department_name: "QA", email: user.userEmail, role_name: "user" },
    { id: "u1", name: "김하나", department_name: "개발", email: "one@fixture.invalid", role_name: "user" },
    { id: "u2", name: "이둘", department_name: "기획", email: "two@fixture.invalid", role_name: "user" },
  ];
  const credential = { email: "qa@fixture.invalid", password: randomUUID() };
  const accessToken = randomUUID();
  const state = { posts: [], rooms: [], unknown: [], directory: async () => response({ users: directory }), create: async () => response({ detail: { userMessage: "생성 시험 오류" } }, 500) };
  global.fetch = async (url, init = {}) => {
    const route = new URL(url).pathname.replace("/api/v1", "");
    const method = init.method || "GET";
    if (route === "/auth/login" && method === "POST") {
      assert.deepEqual(JSON.parse(init.body), credential);
      return response({ accessToken });
    }
    if (route !== "/ui-contract" && init.headers?.Authorization !== `Bearer ${accessToken}`) return response({}, 401);
    if (route === "/workspace/directory" && method === "GET") return state.directory();
    if (route === "/messenger/rooms" && method === "POST") {
      const payload = JSON.parse(init.body);
      state.posts.push(payload);
      return state.create(payload);
    }
    const get = {
      "/ui-contract": {}, "/auth/me": { user }, "/approvals": { documents: [] },
      "/notifications/summary": { unreadCount: 0, severityCount: {} }, "/notifications": { notifications: [] },
      "/mail/inbox": { messages: [] }, "/messenger/rooms": { rooms: state.rooms },
      "/messenger/rooms/new-room/messages": { messages: [] },
      "/workspace/files": { items: [] }, "/workspace/calendars": { owned: [] },
      "/workspace/schedules": { items: [] }, "/workspace/directory": { users: directory },
      "/workspace/personal-ai/providers": { providers: [{ provider: "upstage", label: "Upstage", apiKeyRequired: true }] },
      "/workspace/personal-ai/config": { provider: "upstage", model: "fixture-model", apiKeyConfigured: true, connectionStatus: "ready", configSource: "admin_default", lastTestedAt: null },
    };
    if (method === "GET" && Object.hasOwn(get, route)) return response(get[route]);
    state.unknown.push(`${method} ${route}`);
    return response({}, 404);
  };
  const root = createRoot(document.getElementById("root"));
  t.after(async () => {
    await React.act(async () => root.unmount());
    assert.equal(hardwareBack.size, 0);
    dom.window.close();
    Object.assign(global, saved);
    assert.deepEqual(state.unknown, [], "미등록 API는 404이며 시험 실패로 처리한다");
  });
  await React.act(async () => root.render(React.createElement(module.exports.default)));
  const find = (label) => [...document.querySelectorAll("[data-label]")].find((node) => node.dataset.label === label);
  const press = async (label) => {
    const node = find(label);
    assert.ok(node, `${label} 진입점`);
    const props = propsByNode.get(node);
    assert.ok(!props.disabled, `${label} 사용 가능`);
    await React.act(async () => props.onPress());
  };
  const input = async (label, value) => {
    assert.ok(find(label), `${label} 입력`);
    await React.act(async () => propsByNode.get(find(label)).onChangeText(value));
  };
  await input("아이디 또는 이메일", credential.email);
  await input("비밀번호", credential.password);
  await press("업무 포털 로그인");
  assert.ok(find("헤더 로그아웃"));
  return { state, find, press, input, hardwareBack, propsByNode };
}

test("실제 App: 더보기/AI에서 설정 진입 후 화면 버튼과 Android 뒤로가기로 원위치 복귀", async (t) => {
  const app = await mountApp(t);
  await app.press("더보기 메뉴");
  await app.press("설정 메뉴");
  assert.ok(app.find("설정 이전 화면으로"));
  assert.ok(app.find("개인 AI API 키"));
  await app.press("설정 이전 화면으로");
  assert.ok(app.find("AI 채팅 메뉴"));
  assert.equal(app.find("개인 AI API 키"), undefined, "더보기로 돌아가면 설정 본문은 닫혀야 한다");
  await app.press("AI 채팅 메뉴");
  await app.press("개인 AI 설정 열기");
  assert.equal(app.hardwareBack.size, 1);
  await React.act(async () => assert.equal([...app.hardwareBack][0](), true));
  assert.ok(app.find("개인 AI 질문"));
  assert.equal(app.find("설정 이전 화면으로"), undefined);
});

test("실제 App: 그룹 검색/선택, 실패 입력 보존, 중복 제출 방지와 생성방 진입", async (t) => {
  const app = await mountApp(t);
  await app.press("메신저 메뉴");
  await app.press("새 대화 시작");
  await app.press("그룹 대화");
  await app.input("그룹 대화방 이름", "개발 협업");
  await app.input("대화 참여자 검색", "김하나");
  await app.press("김하나 참여자");
  await app.input("대화 참여자 검색", "이둘");
  await app.press("이둘 참여자");
  assert.ok(app.find("김하나 선택 해제"));
  await app.press("대화방 생성");
  assert.equal(app.find("그룹 대화방 이름").value, "개발 협업");
  assert.ok(app.find("이둘 선택 해제"));
  assert.match(document.body.textContent, /생성 시험 오류/);
  const expected = { roomType: "group", roomName: "개발 협업", participantUserIds: ["u1", "u2"], translationLocale: "ko" };
  assert.deepEqual(app.state.posts, [expected]);
  let resolve;
  app.state.create = () => new Promise((done) => { resolve = done; });
  const onPress = app.propsByNode.get(app.find("대화방 생성")).onPress;
  await React.act(async () => { onPress(); onPress(); });
  assert.equal(app.state.posts.length, 2, "동일 tick 중복 요청 없음");
  assert.ok(app.propsByNode.get(app.find("새 대화 닫기")).disabled);
  app.state.rooms = [{ roomId: "new-room", roomType: "group", roomName: "개발 협업", participantIds: ["me", "u1", "u2"], unreadCount: 0, translationLocale: "ko" }];
  await React.act(async () => resolve(response({ roomId: "new-room" })));
  assert.equal(app.find("대화방 생성"), undefined);
  assert.match(document.body.textContent, /개발 협업/);
  const roomHeading = [...document.querySelectorAll("span")].find((node) => node.textContent === "개발 협업");
  assert.equal(roomHeading.style.fontSize, "18px", "화면 제목 공통 크기");
  await app.press("홈 메뉴");
  const recentName = [...document.querySelectorAll("span")].find((node) => node.textContent === "개발 협업");
  assert.equal(recentName.style.fontSize, "14px", "최근 메신저 이름 공통 크기");
  assert.equal(recentName.style.fontWeight, "600", "최근 메신저 이름 공통 굵기");
});

test("실제 App: 생성 중 로그아웃 후 늦은 성공은 화면/세션을 되살리지 않는다", async (t) => {
  const app = await mountApp(t);
  await app.press("메신저 메뉴");
  await app.press("새 대화 시작");
  await app.press("김하나 참여자");
  let resolve;
  app.state.create = () => new Promise((done) => { resolve = done; });
  await app.press("대화방 생성");
  assert.equal(app.state.posts[0].roomType, "direct");
  await app.press("헤더 로그아웃");
  await React.act(async () => resolve(response({ roomId: "new-room" })));
  assert.ok(app.find("업무 포털 로그인"));
  assert.equal(app.find("대화방 생성"), undefined);
  assert.equal(app.find("헤더 로그아웃"), undefined);
});

test("실제 App: 새 대화 재진입은 이전 주소록 성공/실패/finally를 무시한다", async (t) => {
  const app = await mountApp(t);
  await app.press("메신저 메뉴");
  const pending = [];
  app.state.directory = () => new Promise((resolve) => pending.push(resolve));
  const invokeWithoutAwaitingRequest = async (label) => {
    React.act(() => app.propsByNode.get(app.find(label)).onPress());
  };
  await invokeWithoutAwaitingRequest("새 대화 시작");
  await app.press("새 대화 닫기");
  await invokeWithoutAwaitingRequest("새 대화 시작");
  await React.act(async () => pending[0](response({ users: [] })));
  assert.equal(app.propsByNode.get(app.find("대화방 생성")).disabled, true, "A finally는 B 로딩을 해제하지 않는다");
  const current = { id: "u2", name: "이둘", department_name: "기획", email: "two@fixture.invalid", role_name: "user" };
  await React.act(async () => pending[1](response({ users: [current] })));
  await app.press("새 대화 닫기");
  await invokeWithoutAwaitingRequest("새 대화 시작");
  await app.press("새 대화 닫기");
  await invokeWithoutAwaitingRequest("새 대화 시작");
  await React.act(async () => pending[3](response({ users: [current] })));
  await React.act(async () => pending[2](response({ detail: { userMessage: "이전 요청 실패" } }, 500)));
  assert.ok(app.find("이둘 참여자"), "이전 실패는 현재 목록을 숨기지 않는다");
  assert.equal(app.propsByNode.get(app.find("대화방 생성")).disabled, false);
  assert.doesNotMatch(document.body.textContent, /이전 요청 실패/);
});
