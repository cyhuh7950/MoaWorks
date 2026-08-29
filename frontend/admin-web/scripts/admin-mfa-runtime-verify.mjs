import crypto from "node:crypto";
import http from "node:http";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";

import { chromium } from "../../user-web/node_modules/playwright/index.mjs";

const root = resolve(import.meta.dirname, "..");
const qaLogin = `mfa-${crypto.randomUUID().slice(0, 8)}`;
const qaEmail = `${qaLogin}@mfa-runtime.invalid`;
const qaPassword = crypto.randomUUID();
const totpCode = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
const recoveryCode = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
const manualKey = crypto.randomBytes(20).toString("base64url");
const accessToken = crypto.randomUUID();
const staleToken = crypto.randomUUID();
const loginChallenge = crypto.randomUUID();
const reenrollChallenge = crypto.randomUUID();
const reenrollTotpChallenge = crypto.randomUUID();
const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
const requests = [];
const children = [];
let observedMaskedStatus = null;
let observedReenrollPayload = null;
let observedReenrollMinutes = null;
let observedQrHeaders = null;

const json = (response, value, status = 200, headers = {}) => {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...headers });
  response.end(JSON.stringify(value));
};
const methodNotAllowed = (response) => json(response, { detail: "method not allowed" }, 405);
const notFound = (response) => json(response, { detail: "route not found" }, 404);
const getOnly = (request, response, value) => request.method === "GET" ? json(response, value) : methodNotAllowed(response);
const readJson = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};
const requireAccess = (request, response) => {
  if (request.headers.authorization !== `Bearer ${accessToken}`) {
    json(response, { detail: "stale session" }, 401);
    return false;
  }
  return true;
};
const adminUser = {
  userId: "mfa-runtime-admin", companyId: "mfa-runtime-company", userName: "MFA Runtime Admin",
  userEmail: qaEmail, roleId: "mfa-runtime-role", roleName: "Admin", userType: "admin",
  isDepartmentHead: false, status: "active", permissions: ["admin:*"], mustChangePassword: false,
};

function fixtureServer() {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    requests.push({ method: request.method, path: url.pathname });
    if (url.pathname === "/health") return getOnly(request, response, { status: "ok" });
    if (url.pathname === "/api/v1/health") return getOnly(request, response, { status: "ok", initialized: true, components: {} });
    if (url.pathname === "/api/v1/ui-contract") return getOnly(request, response, { company: { name: "MoaWorks", domain: "mfa-runtime.invalid", logoDataUrl: "" } });
    if (url.pathname === "/api/v1/auth/login") {
      if (request.method !== "POST") return methodNotAllowed(response);
      let body;
      try { body = await readJson(request); } catch { return json(response, { detail: "invalid JSON" }, 400); }
      if (body.email !== qaEmail || body.password !== qaPassword) return json(response, { detail: "credentials rejected" }, 401);
      return json(response, { nextAction: "mfa_required", challengeId: loginChallenge, expiresAt });
    }
    if (url.pathname === "/api/v1/auth/admin/mfa/verify") {
      if (request.method !== "POST") return methodNotAllowed(response);
      const body = await readJson(request);
      if (body.challengeId !== loginChallenge || body.code !== totpCode) return json(response, { detail: "challenge rejected" }, 401);
      return json(response, { nextAction: "authenticated", accessToken, tokenType: "bearer", expiresIn: 3600, user: adminUser });
    }
    if (url.pathname === "/api/v1/auth/admin/mfa/recovery/verify") {
      if (request.method !== "POST") return methodNotAllowed(response);
      const body = await readJson(request);
      if (body.email !== qaEmail || body.recoveryCode !== recoveryCode) return json(response, { detail: "recovery rejected" }, 401);
      return json(response, { nextAction: "mfa_reenroll_required", challengeId: reenrollChallenge, expiresAt });
    }
    if (url.pathname === "/api/v1/auth/admin/mfa/totp/start") {
      if (request.method !== "POST") return methodNotAllowed(response);
      const body = await readJson(request);
      if (body.flowChallengeId !== reenrollChallenge) return json(response, { detail: "flow rejected" }, 401);
      return json(response, { challengeId: reenrollTotpChallenge, expiresAt, manualKey, qrPath: "/auth/admin/mfa/totp/qr" });
    }
    if (url.pathname === "/api/v1/auth/admin/mfa/totp/qr") {
      if (request.method !== "POST") return methodNotAllowed(response);
      const body = await readJson(request);
      if (body.challengeId !== reenrollTotpChallenge) return json(response, { detail: "QR challenge rejected" }, 401);
      response.writeHead(200, { "content-type": "image/png", "cache-control": "no-store", "referrer-policy": "no-referrer" });
      return response.end(Buffer.from("89504e470d0a1a0a", "hex"));
    }
    if (url.pathname === "/api/v1/auth/admin/mfa/status") {
      if (request.method !== "GET") return methodNotAllowed(response);
      if (!requireAccess(request, response)) return;
      return json(response, { enrolled: true, status: "active", recoveryEmailMasked: "r***@mfa-runtime.invalid", profileVersion: 2 });
    }
    if (url.pathname === "/api/v1/translation/status") return getOnly(request, response, { enabled: false, provider: "disabled", providerAvailable: false, cacheAvailable: false });
    const protectedGets = new Map([
      ["/api/v1/admin/directory", { company: { name: "MoaWorks", domain: "mfa-runtime.invalid" }, users: [], departments: [], roles: [] }],
      ["/api/v1/mail/delivery/status", { provider: {}, worker: {}, summary: {} }],
      ["/api/v1/admin/mail-delivery/queue", { items: [], summary: {} }],
      ["/api/v1/admin/mail-operations", { domain: null, providers: [] }],
      ["/api/v1/admin/messenger/rooms", { rooms: [] }],
      ["/api/v1/translation/admin/status", { enabled: false, provider: "disabled", providerAvailable: false, cacheAvailable: false }],
      ["/api/v1/translation/admin", { provider: "disabled", model: "", apiBaseUrl: "", cacheEnabled: false, timeoutSeconds: 15, maxRetries: 2, rateLimitPerMinute: 60, circuitFailureThreshold: 5, circuitRecoverySeconds: 60, costUnit: "tokens" }],
      ["/api/v1/translation/reviews", { items: [] }],
      ["/api/v1/ui-contract/admin", { company: { name: "MoaWorks", domain: "mfa-runtime.invalid", logoDataUrl: "" } }],
      ["/api/v1/admin/monitoring/overview", { mailFailureRate24h: 0, approvalBacklogCount: 0, relayFailureCount1h: 0, diskUsagePercent: 0, alertOpenCount: 0 }],
      ["/api/v1/admin/monitoring/events", { events: [], total: 0 }],
      ["/api/v1/admin/monitoring/alerts", { alerts: [], total: 0 }],
      ["/api/v1/admin/operations/backups", { policy: { enabled: false, intervalHours: 24, retentionDays: 7, encryptionRequired: true, storageMode: "managed_local", lastScheduledAt: null, nextScheduledAt: null, updatedAt: null }, backups: [], restoreDrills: [] }],
      ["/api/v1/approvals/audit-logs", { logs: [] }],
      ["/api/v1/admin/content/messages", { items: [], total: 0 }],
      ["/api/v1/admin/content/help-policies", { items: [], total: 0 }],
    ]);
    if (protectedGets.has(url.pathname)) {
      if (request.method !== "GET") return methodNotAllowed(response);
      if (!requireAccess(request, response)) return;
      return json(response, protectedGets.get(url.pathname));
    }
    return notFound(response);
  });
}

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const freePort = () => new Promise((resolvePort, rejectPort) => {
  const server = createServer();
  server.once("error", rejectPort);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    server.close((error) => error ? rejectPort(error) : resolvePort(address.port));
  });
});
const waitFor = async (url) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await sleep(100);
  }
  throw new Error(`runtime ready timeout: ${url}`);
};
const stopChildren = async (force = false) => {
  await Promise.allSettled([...children].reverse().map((child) => new Promise((resolveExit) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolveExit();
    const timeout = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }, force ? 250 : 2_000);
    child.once("exit", () => { clearTimeout(timeout); resolveExit(); });
    child.kill(force ? "SIGKILL" : "SIGTERM");
  })));
};
const boundedCleanupAction = async (action, timeoutMs) => {
  let timer;
  return Promise.race([
      Promise.resolve().then(action).then(
        () => ({ status: "fulfilled" }),
        (error) => ({ status: "rejected", reason: error instanceof Error ? error.message : String(error) }),
      ),
      new Promise((resolveTimeout) => {
        timer = setTimeout(() => resolveTimeout({ status: "timeout" }), timeoutMs);
      }),
    ]).finally(() => clearTimeout(timer));
};
const cleanupDeadline = async (label, action, fallback, timeoutMs = 2_000, fallbackTimeoutMs = 2_000) => {
  const result = await boundedCleanupAction(action, timeoutMs);
  if (result.status === "fulfilled") return { label, ...result };
  const fallbackResult = await boundedCleanupAction(fallback, fallbackTimeoutMs);
  return { label, ...result, fallbackStatus: fallbackResult.status, fallbackReason: fallbackResult.reason };
};
const cleanupRuntime = async ({ actions, fallbacks, timeouts = {} }) => {
  const labels = ["browser", "fixture", "children"];
  const tasks = labels.map((label) => cleanupDeadline(label, actions[label], fallbacks[label], timeouts[label] ?? 2_000));
  const settled = await Promise.allSettled(tasks);
  return settled.map((result, index) => result.status === "fulfilled"
    ? result.value
    : { label: labels[index], status: "rejected", reason: result.reason instanceof Error ? result.reason.message : String(result.reason), fallbackStatus: "not_run" });
};

let browser;
let fixture;
try {
  const fixturePort = await freePort();
  const webPort = await freePort();
  fixture = fixtureServer();
  await new Promise((resolveListen, rejectListen) => {
    fixture.once("error", rejectListen);
    fixture.listen(fixturePort, "127.0.0.1", resolveListen);
  });
  const wrongLogin = await fetch(`http://127.0.0.1:${fixturePort}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: qaEmail, password: `${qaPassword}-wrong` }) });
  const unknown = await fetch(`http://127.0.0.1:${fixturePort}/api/v1/not-registered`);
  const wrongMethod = await fetch(`http://127.0.0.1:${fixturePort}/api/v1/auth/login`);
  const stale = await fetch(`http://127.0.0.1:${fixturePort}/api/v1/auth/admin/mfa/status`, { headers: { authorization: `Bearer ${staleToken}` } });
  if (wrongLogin.status !== 401 || unknown.status !== 404 || wrongMethod.status !== 405 || stale.status !== 401) throw new Error("fixture fail-closed guards failed");

  const env = { ...process.env, VITE_PROXY_TARGET: `http://127.0.0.1:${fixturePort}` };
  const vite = spawn(process.execPath, [resolve(root, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", String(webPort), "--strictPort"], { cwd: root, env, stdio: "ignore", windowsHide: true });
  children.push(vite);
  await waitFor(`http://127.0.0.1:${webPort}/`);

  browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  const pageErrors = [];
  const apiResponses = [];
  const consoleMessages = [];
  const page = await context.newPage();
  page.setDefaultTimeout(6_000);
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => consoleMessages.push(message.text()));
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith("/api/")) apiResponses.push({ path: url.pathname, status: response.status() });
  });
  await page.goto(`http://127.0.0.1:${webPort}/`, { waitUntil: "networkidle" });
  await page.getByLabel(/관리자 아이디/).fill(qaLogin);
  await page.getByLabel("비밀번호").fill(qaPassword);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.getByLabel("인증 앱 코드").waitFor();
  if (await page.evaluate(() => Boolean(localStorage.getItem("moaworks.adminToken")))) throw new Error("token stored before MFA");
  await page.getByLabel("인증 앱 코드").fill(totpCode);
  const statusResponsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/auth/admin/mfa/status" && response.status() === 200);
  await page.getByRole("button", { name: "코드 확인" }).click();
  await page.locator(".console-layout").waitFor();
  observedMaskedStatus = await (await statusResponsePromise).json();
  if (!await page.evaluate(() => Boolean(localStorage.getItem("moaworks.adminToken")))) throw new Error("token missing after MFA");
  await page.waitForTimeout(300);
  if (!requests.some(({ method, path }) => method === "GET" && path === "/api/v1/auth/admin/mfa/status")) throw new Error("masked MFA status was not loaded");
  if (observedMaskedStatus?.recoveryEmailMasked !== "r***@mfa-runtime.invalid") throw new Error("masked MFA status payload was not verified");
  await page.getByText("복구 이메일: r***@mfa-runtime.invalid", { exact: true }).waitFor();

  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.getByLabel(/관리자 아이디/).fill(qaLogin);
  await page.getByLabel("비밀번호").fill(qaPassword);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.getByRole("button", { name: "인증 앱을 사용할 수 없나요?" }).click();
  await page.getByLabel("일회용 복구 코드").fill(recoveryCode);
  const recoveryResponsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/auth/admin/mfa/recovery/verify" && response.status() === 200);
  const totpStartResponsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/auth/admin/mfa/totp/start" && response.status() === 200);
  const qrResponsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/auth/admin/mfa/totp/qr" && response.status() === 200);
  await page.getByRole("button", { name: "복구 코드 확인" }).click();
  observedReenrollPayload = await (await recoveryResponsePromise).json();
  const reenrollObservedAt = Date.now();
  observedReenrollMinutes = (Date.parse(observedReenrollPayload.expiresAt) - reenrollObservedAt) / 60_000;
  await totpStartResponsePromise;
  const qrResponse = await qrResponsePromise;
  observedQrHeaders = {
    cacheControl: qrResponse.headers()["cache-control"],
    contentType: qrResponse.headers()["content-type"],
    referrerPolicy: qrResponse.headers()["referrer-policy"],
  };
  await page.getByLabel("인증 앱 코드").waitFor();
  if (await page.evaluate(() => Boolean(localStorage.getItem("moaworks.adminToken")))) throw new Error("recovery issued a full token");
  if (!requests.some(({ method, path }) => method === "POST" && path === "/api/v1/auth/admin/mfa/totp/start")) throw new Error("recovery did not enter TOTP reenrollment");
  if (observedReenrollPayload?.nextAction !== "mfa_reenroll_required") throw new Error("reenrollment response was not verified");
  if (!(observedReenrollMinutes > 9 && observedReenrollMinutes <= 10)) throw new Error("reenrollment expiry was not bounded to 10 minutes");
  if (observedQrHeaders.cacheControl !== "no-store" || observedQrHeaders.referrerPolicy !== "no-referrer" || observedQrHeaders.contentType !== "image/png") throw new Error("QR response security headers were not verified");

  const browserOrigins = await page.evaluate(() => performance.getEntriesByType("resource").filter((entry) => entry.name.includes("/api/")).map((entry) => new URL(entry.name).origin));
  if (browserOrigins.some((origin) => origin !== `http://127.0.0.1:${webPort}`)) throw new Error("browser used a non-local API origin");
  if (pageErrors.length) throw new Error(`page errors: ${pageErrors.join(" | ")}`);
  if (apiResponses.some(({ status }) => status >= 400)) throw new Error(`browser API failure: ${JSON.stringify(apiResponses.filter(({ status }) => status >= 400))}`);
  const sensitiveValues = [qaPassword, totpCode, recoveryCode, manualKey, accessToken, staleToken, loginChallenge, reenrollChallenge, reenrollTotpChallenge];
  const consoleSensitiveValueDetected = consoleMessages.some((message) => sensitiveValues.some((value) => message.includes(value)));
  if (consoleSensitiveValueDetected) throw new Error("browser console exposed synthetic MFA material");
  process.stdout.write(`${JSON.stringify({ status: "ADMIN_MFA_RUNTIME_PASS", fixtureGuards: { wrongLogin: 401, unknown: 404, wrongMethod: 405, staleToken: 401 }, tokenBeforeMfa: false, tokenAfterMfa: true, recoveryToken: false, reenrollMinutes: Number(observedReenrollMinutes.toFixed(2)), maskedStatus: observedMaskedStatus.recoveryEmailMasked === "r***@mfa-runtime.invalid", qrHeaders: observedQrHeaders, consoleSensitiveValueDetected, localOnly: browserOrigins.every((origin) => origin === `http://127.0.0.1:${webPort}`) })}\n`);
} catch (error) {
  process.stderr.write(`ADMIN_MFA_RUNTIME_FAIL ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  const injection = process.env.ADMIN_MFA_RUNTIME_INJECT_CLEANUP_FAILURE || "";
  const closeFixture = () => fixture && fixture.listening ? new Promise((resolveClose, rejectClose) => {
    fixture.close((error) => error ? rejectClose(error) : resolveClose());
  }) : undefined;
  const forceCloseFixture = () => {
    fixture?.closeAllConnections?.();
    return closeFixture();
  };
  const actions = {
    browser: () => browser?.close(),
    fixture: closeFixture,
    children: () => stopChildren(false),
  };
  const fallbacks = {
    browser: () => browser?.close({ reason: "cleanup deadline fallback" }),
    fixture: forceCloseFixture,
    children: () => stopChildren(true),
  };
  const timeouts = {};
  if (injection === "browser_hang") { actions.browser = () => new Promise(() => {}); timeouts.browser = 50; }
  if (injection === "fixture_reject") { actions.fixture = () => Promise.reject(new Error("injected fixture cleanup rejection")); timeouts.fixture = 50; }
  if (injection === "children_hang") { actions.children = () => new Promise(() => {}); timeouts.children = 50; }
  const cleanupResults = await cleanupRuntime({ actions, fallbacks, timeouts });
  const expectedByInjection = { browser_hang: ["browser", "timeout"], fixture_reject: ["fixture", "rejected"], children_hang: ["children", "timeout"] };
  const expected = expectedByInjection[injection];
  const unexpected = cleanupResults.filter(({ label, status, fallbackStatus }) => {
    if (expected?.[0] === label) return status !== expected[1] || fallbackStatus !== "fulfilled";
    return status !== "fulfilled";
  });
  const residue = {
    browserConnected: browser?.isConnected() === true,
    fixtureListening: fixture?.listening === true,
    childProcesses: children.filter((child) => child.exitCode === null && child.signalCode === null).length,
  };
  if (Object.values(residue).some(Boolean)) unexpected.push({ label: "residue", status: "detected", residue });
  if (unexpected.length) {
    process.stderr.write(`ADMIN_MFA_RUNTIME_CLEANUP_FAIL ${JSON.stringify(unexpected)}\n`);
    process.exitCode = 1;
  } else if (expected) {
    process.stdout.write(`ADMIN_MFA_CLEANUP_INJECTION_PASS ${injection}\n`);
  } else if (injection) {
    process.stderr.write("ADMIN_MFA_RUNTIME_CLEANUP_FAIL unknown injection mode\n");
    process.exitCode = 1;
  }
}
