const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createAuthSessionController,
  normalizeLoginIdentifier,
  isSessionInvalidatedError,
} = require("../auth-session.js");

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function createState() {
  return {
    token: "stale-token",
    user: { userId: "stale-user" },
    documents: [{ id: "stale-document" }],
    mails: [{ mailId: "stale-mail" }],
    rooms: [{ roomId: "stale-room" }],
    errors: { mail: "stale-error" },
    message: "",
  };
}

function createController(state) {
  return createAuthSessionController({
    onLoginCommitted({ token, user }) {
      state.token = token;
      state.user = user;
    },
    onSessionCleared(message) {
      state.token = "";
      state.user = null;
      state.documents = [];
      state.mails = [];
      state.rooms = [];
      state.errors = {};
      state.message = message;
    },
  });
}

function activate(controller, state, token, userId) {
  const attempt = controller.beginLogin();
  const context = controller.commitLogin(attempt, token, { userId });
  assert.ok(context);
  assert.equal(state.token, token);
  return context;
}

test("사내 아이디와 이메일 로그인 식별자를 운영 이메일 주소로 정규화한다", () => {
  assert.equal(normalizeLoginIdentifier(" sinsan "), "sinsan@moaworks.sinsan.kr");
  assert.equal(normalizeLoginIdentifier(" sinsan@example.com "), "sinsan@example.com");
  assert.equal(normalizeLoginIdentifier("   "), "");
});

test("보호 요청의 401과 403 응답은 중앙 업무 상태를 정리한다", async () => {
  for (const status of [401, 403]) {
    const state = createState();
    const controller = createController(state);
    const context = activate(controller, state, "active-token", "active-user");
    await assert.rejects(
      controller.requestForSession({
        apiBase: "https://api.moaworks.sinsan.kr/api/v1",
        path: "/approvals",
        context,
        fetchImpl: async () => response(status, { detail: { userMessage: "숨겨진 서버 메시지" } }),
      }),
      (error) => error.status === status && isSessionInvalidatedError(error),
    );
    assert.deepEqual(state, {
      token: "",
      user: null,
      documents: [],
      mails: [],
      rooms: [],
      errors: {},
      message: status === 403
        ? "권한이 없거나 세션이 만료되었습니다. 다시 로그인 후 업무를 계속하세요."
        : "세션이 만료되었습니다. 다시 로그인 후 업무를 계속하세요.",
    });
  }
});

test("auth me 실패 시 로그인 결과를 반영하지 않고 업무 상태를 정리한다", async () => {
  const state = createState();
  const controller = createController(state);
  const requests = [];

  await assert.rejects(
    controller.login({
      apiBase: "https://api.moaworks.sinsan.kr/api/v1",
      identifier: "sinsan",
      password: "not-recorded",
      fetchImpl: async (url) => {
        requests.push(url);
        return url.endsWith("/auth/login")
          ? response(200, { accessToken: "candidate-token", user: { userId: "candidate" } })
          : response(401, { detail: { userMessage: "hidden" } });
      },
    }),
    (error) => isSessionInvalidatedError(error),
  );

  assert.deepEqual(requests, [
    "https://api.moaworks.sinsan.kr/api/v1/auth/login",
    "https://api.moaworks.sinsan.kr/api/v1/auth/me",
  ]);
  assert.equal(state.token, "");
  assert.equal(state.user, null);
  assert.deepEqual(state.documents, []);
});

test("로그아웃 후 지연된 성공 응답은 업무 상태를 다시 채우지 못한다", async () => {
  const state = createState();
  const controller = createController(state);
  const context = activate(controller, state, "active-token", "active-user");
  const lateResponse = deferred();

  const pending = controller.applyWhenCurrent(context, lateResponse.promise, (value) => {
    state.documents = [value];
  });
  controller.logout("로그아웃되었습니다.");
  lateResponse.resolve({ id: "late-document" });

  assert.deepEqual(await pending, { applied: false, value: { id: "late-document" } });
  assert.deepEqual(state.documents, []);
  assert.equal(state.token, "");
});

test("이전 세션의 늦은 401은 새 세션을 정리하지 않는다", async () => {
  const state = createState();
  const controller = createController(state);
  const oldContext = activate(controller, state, "old-token", "old-user");
  const newContext = activate(controller, state, "new-token", "new-user");

  await assert.rejects(
    controller.requestForSession({
      apiBase: "https://api.moaworks.sinsan.kr/api/v1",
      path: "/mail/inbox",
      context: oldContext,
      fetchImpl: async () => response(401, {}),
    }),
    (error) => isSessionInvalidatedError(error),
  );

  assert.equal(controller.isCurrent(newContext), true);
  assert.equal(state.token, "new-token");
  assert.deepEqual(state.user, { userId: "new-user" });
});

test("연속 로그인 응답이 역전되어도 최신 로그인만 인증 상태를 반영한다", async () => {
  const state = createState();
  const controller = createController(state);
  const firstLoginResponse = deferred();

  const first = controller.login({
    apiBase: "https://api.moaworks.sinsan.kr/api/v1",
    identifier: "first",
    password: "not-recorded",
    fetchImpl: async () => firstLoginResponse.promise,
  });
  const second = controller.login({
    apiBase: "https://api.moaworks.sinsan.kr/api/v1",
    identifier: "second",
    password: "not-recorded",
    fetchImpl: async (url) => url.endsWith("/auth/login")
      ? response(200, { accessToken: "second-token", user: { userId: "second" } })
      : response(200, { user: { userId: "second" } }),
  });

  await second;
  firstLoginResponse.resolve(response(200, { accessToken: "first-token", user: { userId: "first" } }));
  assert.deepEqual(await first, { committed: false });
  assert.equal(state.token, "second-token");
  assert.deepEqual(state.user, { userId: "second" });
});
