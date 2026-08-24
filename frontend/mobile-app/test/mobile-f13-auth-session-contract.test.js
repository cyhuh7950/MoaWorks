const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  createMobileSessionAdapter,
  normalizeLoginIdentifier,
  isSessionInvalidatedError,
} = require("../auth-session.js");

const appSource = fs.readFileSync(path.resolve(__dirname, "..", "App.tsx"), "utf8");

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
    email: "remembered@moaworks.sinsan.kr",
    token: "stale-token",
    user: { userId: "stale-user" },
    password: "not-recorded",
    documents: [{ id: "stale-document" }],
    createForm: { title: "stale title", content: "stale body", approverUserIds: "stale-user" },
    notifications: [{ notificationId: "stale-notification" }],
    notificationSummary: { unreadCount: 1 },
    notificationError: "stale-notification-error",
    activeTab: "files",
    mailItems: [{ mailId: "stale-mail" }],
    selectedMailId: "stale-mail",
    selectedMailDetail: { mailId: "stale-mail", body: "stale" },
    mailError: "stale-mail-error",
    mailQuery: "stale-query",
    mailFilter: "starred",
    rooms: [{ roomId: "stale-room" }],
    selectedRoomId: "stale-room",
    roomMessages: [{ messageId: "stale-message" }],
    chatDraft: "stale-draft",
    chatError: "stale-chat-error",
    files: [{ fileId: "stale-file" }],
    fileError: "stale-file-error",
    calendars: [{ id: "stale-calendar", isDefault: true }],
    schedules: [{ id: "stale-schedule", title: "stale" }],
    scheduleError: "stale-schedule-error",
    scheduleForm: { title: "stale", startsAt: "2026-08-01T09:00:00+09:00", endsAt: "2026-08-01T10:00:00+09:00", description: "stale", location: "stale" },
    directoryUsers: [{ id: "stale-user", name: "stale" }],
    directoryQuery: "stale-query",
    directoryError: "stale-directory-error",
    directoryBusyUserId: "stale-user",
    actionReason: "stale-reason",
    llmProvider: "personal-provider",
    llmApiKey: "not-recorded",
    llmConnected: true,
    aiDraft: "stale-ai-draft",
    aiMessages: [{ role: "user", body: "stale-ai-message" }],
    message: "",
  };
}

function createAdapter(state) {
  return createMobileSessionAdapter({
    onLoginCommitted({ token, user }) {
      state.token = token;
      state.user = user;
    },
    onSessionReset(nextState) {
      Object.assign(state, nextState);
    },
  });
}

function activate(adapter, state, token, userId) {
  const attempt = adapter.beginLogin();
  const context = adapter.commitLogin(attempt, token, { userId });
  assert.ok(context);
  assert.equal(state.token, token);
  return context;
}

function clearedState(message) {
  return {
    email: "remembered@moaworks.sinsan.kr",
    token: "",
    user: null,
    password: "",
    documents: [],
    createForm: { title: "", content: "", approverUserIds: "" },
    notifications: [],
    notificationSummary: null,
    notificationError: "",
    activeTab: "home",
    mailItems: [],
    selectedMailId: "",
    selectedMailDetail: null,
    mailError: "",
    mailQuery: "",
    mailFilter: "all",
    rooms: [],
    selectedRoomId: "",
    roomMessages: [],
    chatDraft: "",
    chatError: "",
    files: [],
    fileError: "",
    calendars: [],
    schedules: [],
    scheduleError: "",
    scheduleForm: { title: "", startsAt: "", endsAt: "", description: "", location: "" },
    directoryUsers: [],
    directoryQuery: "",
    directoryError: "",
    directoryBusyUserId: "",
    actionReason: "확인",
    llmProvider: "OpenAI",
    llmApiKey: "",
    llmConnected: false,
    aiDraft: "",
    aiMessages: [],
    message,
  };
}

test("사내 아이디와 이메일 로그인 식별자를 운영 이메일 주소로 정규화한다", () => {
  assert.equal(normalizeLoginIdentifier(" sinsan "), "sinsan@moaworks.sinsan.kr");
  assert.equal(normalizeLoginIdentifier(" sinsan@example.com "), "sinsan@example.com");
  assert.equal(normalizeLoginIdentifier("   "), "");
});

test("보호 요청의 401과 403 응답은 App과 같은 전체 세션 상태를 중앙 정리한다", async () => {
  for (const status of [401, 403]) {
    const state = createState();
    const adapter = createAdapter(state);
    const context = activate(adapter, state, "active-token", "active-user");
    await assert.rejects(
      adapter.requestForSession({
        apiBase: "https://api.moaworks.sinsan.kr/api/v1",
        path: "/approvals",
        context,
        fetchImpl: async () => response(status, { detail: { userMessage: "숨겨진 서버 메시지" } }),
      }),
      (error) => error.status === status && isSessionInvalidatedError(error),
    );
    assert.deepEqual(state, clearedState(status === 403
      ? "권한이 없거나 세션이 만료되었습니다. 다시 로그인 후 업무를 계속하세요."
      : "세션이 만료되었습니다. 다시 로그인 후 업무를 계속하세요."));
  }
});

test("auth me 실패 시 로그인 결과를 반영하지 않고 업무 상태를 정리한다", async () => {
  const state = createState();
  const adapter = createAdapter(state);
  const requests = [];

  await assert.rejects(
    adapter.login({
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
  assert.deepEqual(state, clearedState("세션이 만료되었습니다. 다시 로그인 후 업무를 계속하세요."));
});

test("로그아웃 뒤 지연된 mail/room 두 번째 조회와 열기 응답은 동일 adapter로 차단한다", async () => {
  const lateCases = [
    ["loadMail detail", { mailId: "late-mail", body: "late" }, (state, value) => {
      state.selectedMailId = value.mailId;
      state.selectedMailDetail = value;
    }],
    ["loadRooms messages", { messages: [{ messageId: "late-room-message" }] }, (state, value) => {
      state.selectedRoomId = "late-room";
      state.roomMessages = value.messages;
    }],
    ["openMail detail", { mailId: "opened-late-mail", body: "late" }, (state, value) => {
      state.selectedMailId = value.mailId;
      state.selectedMailDetail = value;
    }],
    ["openRoom messages", { messages: [{ messageId: "opened-late-message" }] }, (state, value) => {
      state.selectedRoomId = "opened-late-room";
      state.roomMessages = value.messages;
    }],
  ];

  for (const [label, value, apply] of lateCases) {
    const state = createState();
    const adapter = createAdapter(state);
    const context = activate(adapter, state, "active-token", "active-user");
    const lateResponse = deferred();
    const pending = adapter.applyProtectedResponse(context, () => lateResponse.promise, (responseBody) => apply(state, responseBody));

    adapter.clearSession("로그아웃되었습니다.");
    lateResponse.resolve(value);

    assert.deepEqual(await pending, { applied: false, value }, label);
    assert.deepEqual(state, clearedState("로그아웃되었습니다."), label);
  }
});

test("이전 세션의 늦은 401은 새 세션을 정리하지 않는다", async () => {
  const state = createState();
  const adapter = createAdapter(state);
  const oldContext = activate(adapter, state, "old-token", "old-user");
  const newContext = activate(adapter, state, "new-token", "new-user");

  await assert.rejects(
    adapter.requestForSession({
      apiBase: "https://api.moaworks.sinsan.kr/api/v1",
      path: "/mail/inbox",
      context: oldContext,
      fetchImpl: async () => response(401, {}),
    }),
    (error) => isSessionInvalidatedError(error),
  );

  assert.equal(adapter.isCurrent(newContext), true);
  assert.equal(state.token, "new-token");
  assert.deepEqual(state.user, { userId: "new-user" });
});

test("연속 로그인 응답이 역전되어도 최신 로그인만 인증 상태를 반영한다", async () => {
  const state = createState();
  const adapter = createAdapter(state);
  const firstLoginResponse = deferred();

  const first = adapter.login({
    apiBase: "https://api.moaworks.sinsan.kr/api/v1",
    identifier: "first",
    password: "not-recorded",
    fetchImpl: async () => firstLoginResponse.promise,
  });
  const second = adapter.login({
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

test("새 로그인 성공 뒤 이전 auth login 401 또는 네트워크 실패는 adapter에서 무시한다", async () => {
  for (const lateFailure of [
    () => response(401, { detail: { userMessage: "old failure" } }),
    () => response(403, { detail: { userMessage: "old forbidden" } }),
    () => Promise.reject(new Error("old network failure")),
  ]) {
    const state = createState();
    const adapter = createAdapter(state);
    const delayedLogin = deferred();
    const previousLogin = adapter.login({
      apiBase: "https://api.moaworks.sinsan.kr/api/v1",
      identifier: "previous",
      password: "not-recorded",
      fetchImpl: async () => delayedLogin.promise,
    });
    const currentLogin = adapter.login({
      apiBase: "https://api.moaworks.sinsan.kr/api/v1",
      identifier: "current",
      password: "not-recorded",
      fetchImpl: async (url) => url.endsWith("/auth/login")
        ? response(200, { accessToken: "current-token", user: { userId: "current" } })
        : response(200, { user: { userId: "current" } }),
    });

    await currentLogin;
    state.message = "현재 로그인 성공";
    const failure = lateFailure();
    if (failure instanceof Promise) {
      delayedLogin.reject(await failure.catch((error) => error));
    } else {
      delayedLogin.resolve(failure);
    }

    assert.deepEqual(await previousLogin, { committed: false });
    assert.equal(state.token, "current-token");
    assert.deepEqual(state.user, { userId: "current" });
    assert.equal(state.message, "현재 로그인 성공");
  }
});

test("새 세션이 시작되면 이전 로그인 초기 요청의 성공과 실패를 모두 무시한다", async () => {
  for (const lateResult of [
    () => ({ documents: [{ id: "old-document" }] }),
    () => Promise.reject(new Error("old initial request failure")),
  ]) {
    const state = createState();
    const adapter = createAdapter(state);
    const oldContext = activate(adapter, state, "old-token", "old-user");
    const delayedRequest = deferred();
    const initialRequests = adapter.runInitialRequests(oldContext, [
      () => adapter.applyProtectedResponse(oldContext, () => delayedRequest.promise, (value) => {
        state.documents = value.documents;
        state.message = "이전 요청 성공";
      }),
    ]);
    activate(adapter, state, "new-token", "new-user");
    state.documents = [{ id: "new-document" }];
    state.message = "새 세션 준비 완료";

    const result = lateResult();
    if (result instanceof Promise) {
      delayedRequest.reject(await result.catch((error) => error));
    } else {
      delayedRequest.resolve(result);
    }

    assert.deepEqual(await initialRequests, { applied: false });
    assert.equal(state.token, "new-token");
    assert.deepEqual(state.user, { userId: "new-user" });
    assert.deepEqual(state.documents, [{ id: "new-document" }]);
    assert.equal(state.message, "새 세션 준비 완료");
  }
});

test("App은 중앙 reset과 mail/room/schedule 보호 응답에 production adapter를 연결한다", () => {
  assert.match(appSource, /createMobileSessionAdapter\(/);
  assert.match(appSource, /function clearSession[\s\S]*?\.clearSession\(nextMessage\)/);
  for (const name of ["loadMail", "loadRooms", "openMail", "openRoom"]) {
    const start = appSource.indexOf(`async function ${name}`);
    assert.notEqual(start, -1, `${name} exists`);
    const next = appSource.indexOf("\n  async function ", start + 1);
    const body = appSource.slice(start, next === -1 ? appSource.length : next);
    assert.match(body, /applyProtectedResponse\(/, `${name} uses adapter`);
  }
  assert.match(appSource, /request<\{ owned: WorkspaceCalendar\[\] \}>\("\/workspace\/calendars"/);
  assert.match(appSource, /request<\{ items: WorkspaceSchedule\[\] \}>\("\/workspace\/schedules"/);
  assert.match(appSource, /setSchedules\(scheduleItems\(scheduleBody\)\)/);
  assert.match(appSource, /createSubmissionGate\(\)/);
  assert.match(appSource, /scheduleSubmissionGateRef\.current\.reset\(\)/);
  assert.match(appSource, /onLoginCommitted\([\s\S]*?scheduleSubmissionGateRef\.current\.reset\(\)/);
  assert.match(appSource, /if \(!scheduleSubmissionGateRef\.current\.tryEnter\(\)\) return;/);
  assert.match(appSource, /sessionControllerRef\.current\.isCurrent\(context\).*scheduleSubmissionGateRef\.current\.release\(\)/s);
});
