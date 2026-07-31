const test = require("node:test");
const assert = require("node:assert/strict");

function loadBroker() {
  return require("../electron/api-broker.js");
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("login keeps the session credential in main-process memory and removes it from renderer result", async () => {
  const calls = [];
  const { createApiBroker } = loadBroker();
  const broker = createApiBroker({
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({ accessToken: "session-sentinel", tokenType: "bearer" });
    },
  });

  const result = await broker.login({ email: "desktop@example.invalid", password: "not-a-secret" });

  assert.deepEqual(result, { authenticated: true });
  assert.equal(result.accessToken, undefined);
  assert.equal(broker.hasSession(), true);
  assert.equal(calls[0].url, "https://user.moaworks.sinsan.kr/api/v1/auth/login");
  assert.equal(calls[0].init.headers.Authorization, undefined);
});

test("authenticated request injects authorization only inside the broker", async () => {
  const calls = [];
  const { createApiBroker } = loadBroker();
  const broker = createApiBroker({
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return calls.length === 1
        ? jsonResponse({ accessToken: "session-sentinel" })
        : jsonResponse({ user: { userId: "u1" } });
    },
  });
  await broker.login({ email: "desktop@example.invalid", password: "not-a-secret" });

  const result = await broker.request({ path: "/auth/me", method: "GET" });

  assert.equal(result.user.userId, "u1");
  assert.equal(calls[1].init.headers.Authorization, "Bearer session-sentinel");
});

test("allowlist rejects absolute URLs, unknown paths, wrong methods and oversized bodies", async () => {
  const { createApiBroker } = loadBroker();
  const broker = createApiBroker({ fetchImpl: async () => jsonResponse({}) });

  await assert.rejects(() => broker.request({ path: "http://127.0.0.1/private", method: "GET" }), /허용되지 않은 API 경로/);
  await assert.rejects(() => broker.request({ path: "/admin/users", method: "GET" }), /허용되지 않은 API 경로/);
  await assert.rejects(() => broker.request({ path: "/auth/me", method: "DELETE" }), /허용되지 않은 API method/);
  await assert.rejects(() => broker.request({ path: "/approvals", method: "POST", body: { value: "x".repeat(300_000) } }), /요청 크기/);
});

test("401 and 423 responses clear the in-memory session", async () => {
  for (const status of [401, 423]) {
    let callCount = 0;
    const { createApiBroker } = loadBroker();
    const broker = createApiBroker({
      fetchImpl: async () => {
        callCount += 1;
        return callCount === 1 ? jsonResponse({ accessToken: "session-sentinel" }) : jsonResponse({ detail: "blocked" }, status);
      },
    });
    await broker.login({ email: "desktop@example.invalid", password: "not-a-secret" });
    await assert.rejects(() => broker.request({ path: "/auth/me", method: "GET" }), new RegExp(String(status)));
    assert.equal(broker.hasSession(), false);
  }
});

test("response size limit is enforced before returning data", async () => {
  const { createApiBroker } = loadBroker();
  const broker = createApiBroker({
    maxResponseBytes: 32,
    fetchImpl: async () => jsonResponse({ value: "x".repeat(100) }),
  });

  await assert.rejects(() => broker.request({ path: "/ui-contract", method: "GET" }), /응답 크기/);
});

test("broker validates configuration, credentials, JSON and response contracts", async () => {
  const { createApiBroker, validateApiBase } = loadBroker();
  assert.throws(() => validateApiBase("http://localhost/api"), /HTTPS/);
  assert.throws(() => validateApiBase("https://user:password@example.invalid/api"), /HTTPS/);
  assert.throws(() => createApiBroker({ fetchImpl: 7 }), /연결 기능/);

  const broker = createApiBroker({ fetchImpl: async () => jsonResponse({ accessToken: "ok" }) });
  await assert.rejects(() => broker.login({ email: "invalid", password: "x" }), /이메일/);
  await assert.rejects(() => broker.login({ email: "user@example.invalid", password: "" }), /로그인 입력/);
  await assert.rejects(() => broker.request({ path: "//example.invalid", method: "GET" }), /경로/);
  await assert.rejects(() => broker.request({ path: "/auth/../me", method: "GET" }), /경로/);
  await assert.rejects(() => broker.request({ path: "/approvals", method: "POST", body: "not-json" }), /JSON/);
});

test("broker handles empty, malformed and failed responses and explicit session clearing", async () => {
  const { createApiBroker } = loadBroker();
  const responses = [
    new Response("", { status: 200 }),
    new Response("not-json", { status: 200 }),
    jsonResponse({ detail: "failure" }, 500),
  ];
  const broker = createApiBroker({ fetchImpl: async () => responses.shift() });
  assert.deepEqual(await broker.request({ path: "/ui-contract" }), {});
  await assert.rejects(() => broker.request({ path: "/ui-contract" }), /응답 형식/);
  await assert.rejects(() => broker.request({ path: "/ui-contract" }), /500/);

  const sessionBroker = createApiBroker({ fetchImpl: async () => jsonResponse({ accessToken: "session" }) });
  await sessionBroker.login({ email: "user@example.invalid", password: "x" });
  assert.deepEqual(sessionBroker.logout(), { authenticated: false });
  assert.equal(sessionBroker.hasSession(), false);
  sessionBroker.clearSession();
  await assert.rejects(() => sessionBroker.request({ path: "/auth/me" }), /로그인/);
});

test("login requires a bounded credential in the server response", async () => {
  const { createApiBroker } = loadBroker();
  for (const accessToken of [undefined, "x".repeat(17_000)]) {
    const broker = createApiBroker({ fetchImpl: async () => jsonResponse({ accessToken }) });
    await assert.rejects(() => broker.login({ email: "user@example.invalid", password: "x" }), /로그인 응답/);
  }
});
