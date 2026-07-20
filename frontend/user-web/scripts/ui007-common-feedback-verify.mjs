import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright";

const execFileAsync = promisify(execFile);
const runId = process.argv[2] || `verify.ui007.${Date.now()}.${randomUUID().slice(0, 8)}`;
const adminPassword = process.env.MOAWORKS_TEST_PASSWORD || process.argv[3];
const verifyPassword = process.env.MOAWORKS_VERIFY_USER_PASSWORD || "Vfy!20260718";
if (!adminPassword) throw new Error("MOAWORKS_TEST_PASSWORD is required");

const root = resolve(import.meta.dirname, "../../..");
const backend = resolve(root, "backend");
const apiBase = "http://127.0.0.1:8510/api/v1";
const webBase = "http://127.0.0.1:3520";
const evidenceDir = resolve(root, `docs/evidence/ui007-common-feedback-${runId}`);
const progressPath = resolve(evidenceDir, "progress.jsonl");
await mkdir(evidenceDir, { recursive: true });

const state = { adminToken: "", roleIds: [], userIds: [], draftMailId: "" };
const network = [];
const consoleErrors = [];
const result = { runId, status: "running", startedAt: new Date().toISOString(), checks: {}, cleanup: null };

const sanitize = (value, key = "") => {
  if (value == null) return value;
  if (/token|authorization|cookie|password|secret/i.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, sanitize(entryValue, entryKey)]));
  if (typeof value === "string") return value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/([?&](?:token|access_token)=)[^&]+/gi, "$1[REDACTED]");
  return value;
};
const record = (stepName, status, details = {}) => appendFile(progressPath, JSON.stringify(sanitize({ at: new Date().toISOString(), step: stepName, status, ...details })) + "\n");
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const step = async (name, action, timeoutMs = 30000) => {
  await record(name, "start", { timeoutMs });
  const started = Date.now();
  let timer;
  try {
    const value = await Promise.race([
      action(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${name} timeout after ${timeoutMs}ms`)), timeoutMs); }),
    ]);
    await record(name, "success", { elapsedMs: Date.now() - started });
    return value;
  } catch (error) {
    await record(name, "failure", { elapsedMs: Date.now() - started, message: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
};

function httpJson(url, options = {}, timeoutMs = 10000) {
  return new Promise((resolveRequest, rejectRequest) => {
    const request = httpRequest(url, { method: options.method || "GET", headers: options.headers || {} }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let body = {};
        try { body = text ? JSON.parse(text) : {}; } catch { body = { text }; }
        resolveRequest({ status: response.statusCode || 0, body });
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error(`HTTP timeout: ${url}`)));
    request.on("error", rejectRequest);
    if (options.body) request.write(options.body);
    request.end();
  });
}

async function request(path, options = {}) {
  return httpJson(`${apiBase}${path}`, options, 10000);
}
async function ok(path, options = {}) {
  const response = await request(path, options);
  assert(response.status >= 200 && response.status < 300, `${path}: ${response.status}`);
  return response.body;
}
const adminOptions = (method = "GET", body) => ({
  method,
  headers: { authorization: `Bearer ${state.adminToken}`, ...(body ? { "content-type": "application/json" } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
const loginApi = (email, password) => request("/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, password }),
});

async function prepareAccessData() {
  const adminLogin = await loginApi("admin@moaworks.local", adminPassword);
  assert(adminLogin.status === 200, `admin login status ${adminLogin.status}`);
  state.adminToken = adminLogin.body.accessToken;
  const directory = await ok("/admin/directory", adminOptions());
  const department = directory.departments.find((item) => item.status === "active");
  assert(department, "active department missing");

  const createRole = async (suffix, permissions) => {
    const role = await ok("/admin/roles", adminOptions("POST", { name: `${runId}.${suffix}`, permissions }));
    state.roleIds.push(role.id);
    return role;
  };
  const forbiddenRole = await createRole("forbidden-role", ["messenger:read"]);
  const inactiveUserRole = await createRole("inactive-user-role", ["mail:read"]);
  const inactiveRole = await createRole("inactive-role", ["mail:read"]);
  const createUser = async (suffix, roleId, status) => {
    const loginId = `u7${Date.now().toString(36)}${state.userIds.length}`;
    const user = await ok("/admin/users", adminOptions("POST", {
      name: `${runId}.${suffix}`, loginId, password: verifyPassword,
      departmentId: department.id, roleId, status, userType: "user",
    }));
    state.userIds.push(user.userId);
    if (status === "active") await ok(`/admin/users/${user.userId}`, adminOptions("PATCH", { password: verifyPassword }));
    return { ...user, loginId };
  };
  const forbidden = await createUser("forbidden", forbiddenRole.id, "active");
  const inactiveUser = await createUser("inactive-user", inactiveUserRole.id, "inactive");
  const inactiveRoleUser = await createUser("inactive-role", inactiveRole.id, "active");
  await ok(`/admin/roles/${inactiveRole.id}`, adminOptions("PATCH", { status: "inactive" }));
  return { forbidden, inactiveUser, inactiveRoleUser };
}

function attachEvidence(page) {
  page.on("request", (request) => {
    if (!request.url().includes("/api/v1/")) return;
    const url = new URL(request.url());
    for (const key of ["token", "access_token", "password"]) if (url.searchParams.has(key)) url.searchParams.set(key, "[REDACTED]");
    network.push({ method: request.method(), url: url.toString() });
  });
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
}

async function loginPage(context, loginId, password) {
  await context.clearCookies();
  const page = await context.newPage();
  attachEvidence(page);
  await page.goto(`${webBase}/`, { waitUntil: "domcontentloaded", timeout: 10000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded", timeout: 10000 });
  await page.locator('input[type="password"]').waitFor({ timeout: 10000 });
  await page.locator("input").first().fill(loginId);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: /로그인/i }).click();
  return page;
}

async function dbEvidence() {
  const code = [
    "import json",
    "from app.services.postgres_service import PostgresService",
    `subject = ${JSON.stringify(runId)}`,
    "with PostgresService().connect() as connection:",
    "    with connection.cursor() as cursor:",
    "        cursor.execute(\"SELECT id, status, subject, deleted_at FROM mail_messages WHERE subject = %s ORDER BY created_at DESC\", (subject,))",
    "        mails = cursor.fetchall()",
    "        cursor.execute(\"SELECT target_id, event AS event_type, status_after AS status, reason FROM audit_logs WHERE target_id IN (SELECT id FROM mail_messages WHERE subject = %s) ORDER BY created_at\", (subject,))",
    "        audit = cursor.fetchall()",
    "        cursor.execute(\"SELECT email, status FROM users WHERE email IN ('admin@moaworks.local','cyhuh@moaworks.local','ysla@moaworks.local') ORDER BY email\")",
    "        protected = cursor.fetchall()",
    "print(json.dumps({'mails': mails, 'audit': audit, 'protected': protected}, default=str))",
  ].join("\n");
  const python = process.env.MOAWORKS_BACKEND_PYTHON || "C:\\Users\\cyhuh\\anaconda3\\python.exe";
  const { stdout } = await execFileAsync(python, ["-c", code], { cwd: backend, timeout: 30000 });
  return JSON.parse(stdout.trim());
}

async function cleanup() {
  const errors = [];
  if (state.draftMailId && state.adminToken) {
    const removed = await request("/mail/bulk", adminOptions("POST", { mailIds: [state.draftMailId], action: "delete", mailbox: "draft" }));
    if (removed.status !== 200) errors.push(`mail:${state.draftMailId}:${removed.status}`);
  }
  for (const id of state.userIds) {
    const response = await request(`/admin/users/${id}`, adminOptions("DELETE"));
    if (response.status < 200 || response.status >= 300) errors.push(`user:${id}:${response.status}`);
  }
  for (const id of state.roleIds) {
    const response = await request(`/admin/roles/${id}`, adminOptions("DELETE"));
    if (response.status < 200 || response.status >= 300) errors.push(`role:${id}:${response.status}`);
  }
  const db = await dbEvidence();
  return { errors, db, protectedAccountsActive: db.protected.filter((item) => item.status === "active").length };
}

let browser;
let context;
let page;
let failure;
let accessData;
try {
  await step("g0", async () => {
    for (const url of [`${apiBase}/health`, `${webBase}/api/v1/health`]) {
      const response = await httpJson(url, {}, 5000);
      assert(response.status === 200 && response.body.initialized === true, `G0 failed: ${url}`);
    }
    result.checks.g0 = { backend: 200, sameOrigin: 200, initialized: true };
  });

  accessData = await step("prepare-access-data", prepareAccessData, 30000);

  await step("feedback-demo", async () => {
    browser = await chromium.launch({ channel: "chrome", headless: true });
    context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    page = await context.newPage();
    attachEvidence(page);
    await page.goto(`${webBase}/?feedback-system-demo`, { waitUntil: "domcontentloaded", timeout: 10000 });

    await page.getByRole("button", { name: "성공 toast" }).click();
    await page.getByRole("button", { name: "중복 toast" }).click();
    assert(await page.locator(".feedback-toast").count() === 1, "duplicate toast was not suppressed");
    await page.getByRole("button", { name: "저장이 완료되었습니다. 닫기" }).click();
    assert(await page.locator(".feedback-toast").count() === 0, "manual toast close failed");

    await page.getByRole("button", { name: "성공 toast" }).click();
    await page.waitForTimeout(3900);
    assert(await page.locator(".feedback-toast").count() === 0, "toast auto close failed");

    await page.getByRole("button", { name: "compact warning" }).click();
    const warning = page.locator(".feedback-warning");
    await warning.getByRole("button", { name: /확인할 항목/ }).click();
    assert((await warning.getAttribute("aria-label")) === "확인할 항목", "warning contract missing");
    await warning.getByRole("button", { name: "닫기" }).click();
    assert(await warning.count() === 0, "warning close failed");

    for (const name of ["loading", "empty", "error"]) {
      await page.getByRole("button", { name, exact: true }).click();
      assert(await page.locator(`.feedback-state.is-${name}`).count() === 1, `${name} state missing`);
    }
    await page.getByRole("button", { name: "다시 시도" }).click();
    assert(await page.locator(".feedback-state.is-loading").count() === 1, "error retry transition failed");

    await page.getByRole("button", { name: "confirm modal" }).click();
    const confirm = page.getByRole("alertdialog", { name: "검수 작업 확인" });
    await confirm.waitFor();
    await page.waitForFunction(() => document.activeElement?.textContent?.trim() === "취소");
    assert(await confirm.getByRole("button", { name: "취소" }).evaluate((element) => element === document.activeElement), "confirm safe initial focus missing");
    await page.keyboard.press("Escape");
    await confirm.waitFor({ state: "detached" });

    await page.getByRole("button", { name: "업무 popup" }).click();
    await page.getByLabel("업무 입력").fill("검수");
    await page.getByRole("button", { name: "오류 재현" }).click();
    assert(await page.getByRole("alert").filter({ hasText: "입력 내용을 확인해 주세요." }).count() === 1, "popup error is not single");
    assert(await page.locator(".feedback-toast.is-error").count() === 0, "popup error duplicated as toast");
    await page.getByRole("button", { name: "성공 처리" }).click();
    await page.getByRole("dialog", { name: "업무 처리" }).waitFor({ state: "detached" });
    await page.getByRole("status").filter({ hasText: "팝업 작업을 완료했습니다." }).waitFor();

    const layout = await page.evaluate(() => ({
      viewport: { width: innerWidth, height: innerHeight },
      pageHasScroll: document.documentElement.scrollHeight > document.documentElement.clientHeight,
    }));
    assert(layout.viewport.width === 1920 && layout.viewport.height === 1080, "demo viewport mismatch");
    assert(layout.pageHasScroll === false, "feedback demo page scroll detected");
    result.checks.feedbackDemo = { duplicateSuppressed: true, autoClose: true, manualClose: true, warning: true, states: ["loading", "empty", "error"], confirm: true, popup: ["error", "success"], layout };
    await page.screenshot({ path: resolve(evidenceDir, "feedback-demo-1920x1080.png") });
    await page.close();
  }, 30000);

  await step("normal-shell-feedback", async () => {
    page = await loginPage(context, "admin", adminPassword);
    await page.locator(".user-app-rail-menu").waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: /^메일/ }).first().click();
    await page.getByRole("button", { name: "메일 작성", exact: true }).last().click();

    await page.getByRole("button", { name: "발송", exact: true }).click();
    const popupAlert = page.locator(".user-mail-compose-popup").getByRole("alert");
    await popupAlert.waitFor();
    assert((await popupAlert.textContent()).includes("받는 사람"), "popup error message mismatch");
    assert(await page.locator(".feedback-toast.is-error").count() === 0, "popup error duplicated globally");

    await page.getByLabel("mail-compose-to").fill("admin@moaworks.local");
    await page.getByLabel("mail-compose-subject").fill(runId);
    await page.getByLabel("mail-compose-body").fill("UI-007 popup success verification");
    const draftResponsePromise = page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/api/v1/mail/draft"));
    await page.getByRole("button", { name: "임시저장", exact: true }).click();
    const draftResponse = await draftResponsePromise;
    assert(draftResponse.status() === 200, `draft status ${draftResponse.status()}`);
    const draftBody = await draftResponse.json();
    state.draftMailId = draftBody.mailId;
    await page.locator(".user-mail-compose-popup").waitFor({ state: "detached" });
    await page.getByRole("status").filter({ hasText: "메일을 임시저장했습니다." }).waitFor();

    await page.getByRole("button", { name: /^알림 \d+건$/ }).click();
    const panel = page.getByRole("dialog", { name: "최근 알림" });
    await panel.waitFor();
    const toast = page.locator(".feedback-toast").filter({ hasText: "메일을 임시저장했습니다." });
    const boxes = await Promise.all([panel.boundingBox(), toast.boundingBox()]);
    assert(boxes[0] && boxes[1], "notification/toast bounds missing");
    const overlaps = !(boxes[1].x >= boxes[0].x + boxes[0].width || boxes[1].x + boxes[1].width <= boxes[0].x || boxes[1].y >= boxes[0].y + boxes[0].height || boxes[1].y + boxes[1].height <= boxes[0].y);
    assert(!overlaps, "UI-006 notification panel overlaps feedback toast");
    await page.getByRole("button", { name: "알림 닫기" }).click();

    await page.getByRole("button", { name: /^홈/ }).first().click();
    assert(await page.locator(".feedback-toast").count() === 0, "toast remained after menu transition");

    await page.getByRole("button", { name: /^메일/ }).first().click();
    await page.getByRole("button", { name: "메일 작성", exact: true }).last().click();
    await page.getByLabel("mail-compose-subject").fill("닫기 확인");
    await page.getByRole("button", { name: "닫기", exact: true }).click();
    const closeConfirm = page.getByRole("alertdialog", { name: "작성 중인 메일 닫기" });
    await closeConfirm.waitFor();
    await page.waitForFunction(() => document.activeElement?.textContent?.trim() === "취소");
    assert(await closeConfirm.getByRole("button", { name: "취소" }).evaluate((element) => element === document.activeElement), "compose confirm initial focus missing");
    await page.keyboard.press("Escape");
    await closeConfirm.waitFor({ state: "detached" });
    assert(await page.locator(".user-mail-compose-popup").count() === 1, "compose closed after confirm Escape");
    await page.getByRole("button", { name: "닫기", exact: true }).click();
    await page.getByRole("alertdialog", { name: "작성 중인 메일 닫기" }).getByRole("button", { name: "저장하지 않고 닫기" }).click();
    await page.locator(".user-mail-compose-popup").waitFor({ state: "detached" });

    const measurements = await page.evaluate(() => ({
      viewport: { width: innerWidth, height: innerHeight },
      page: { clientHeight: document.documentElement.clientHeight, scrollHeight: document.documentElement.scrollHeight, hasScroll: document.documentElement.scrollHeight > document.documentElement.clientHeight },
      body: { clientHeight: document.body.clientHeight, scrollHeight: document.body.scrollHeight },
    }));
    assert(measurements.page.hasScroll === false, "whole page scroll detected");
    result.checks.shell = { popupErrorSingle: true, popupSuccessToast: true, notificationCollision: false, menuClear: true, composeConfirm: true, measurements };
    await page.screenshot({ path: resolve(evidenceDir, "shell-feedback-1920x1080.png") });
    await page.close();
  }, 45000);

  await step("access-control-screens", async () => {
    const wrong = await loginPage(context, "admin", "wrong-password-ui007");
    await wrong.getByRole("alert").waitFor({ timeout: 10000 });
    assert((await wrong.getByRole("alert").textContent()).includes("비밀번호"), "401 screen message mismatch");
    await wrong.close();

    const forbiddenApiLogin = await loginApi(`${accessData.forbidden.loginId}@moaworks.local`, verifyPassword);
    assert(forbiddenApiLogin.status === 200, `forbidden user login status ${forbiddenApiLogin.status}`);
    const forbiddenApi = await request("/mail/inbox", { headers: { authorization: `Bearer ${forbiddenApiLogin.body.accessToken}` } });
    assert(forbiddenApi.status === 403, `forbidden mail API expected 403, got ${forbiddenApi.status}`);

    const forbidden = await loginPage(context, accessData.forbidden.loginId, verifyPassword);
    await forbidden.locator(".user-app-rail-menu").waitFor({ timeout: 15000 });
    await forbidden.route("**/api/v1/mail/inbox**", (route) => route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ code: "FORBIDDEN", userMessage: "요청한 기능을 수행할 권한이 없습니다." }) }));
    await forbidden.getByRole("button", { name: /^메일/ }).first().click();
    await forbidden.getByRole("button", { name: "새로고침", exact: true }).click();
    await forbidden.getByRole("alert").filter({ hasText: "권한" }).first().waitFor({ timeout: 15000 });
    await forbidden.screenshot({ path: resolve(evidenceDir, "access-403.png") });
    await forbidden.close();

    const inactiveUser = await loginPage(context, accessData.inactiveUser.loginId, verifyPassword);
    await inactiveUser.getByRole("alert").filter({ hasText: "비활성화된 사용자" }).waitFor({ timeout: 10000 });
    await inactiveUser.close();

    const inactiveRole = await loginPage(context, accessData.inactiveRoleUser.loginId, verifyPassword);
    await inactiveRole.getByRole("alert").filter({ hasText: "권한 역할이 비활성화" }).waitFor({ timeout: 10000 });
    await inactiveRole.close();

    result.checks.access = { unauthorized: { status: 401, screen: true }, forbidden: { status: 403, screen: true }, inactiveUser: { status: 423, screen: true }, inactiveRole: { status: 423, screen: true } };
  }, 45000);

  await step("db-audit-network", async () => {
    const db = await dbEvidence();
    assert(db.mails.some((item) => item.id === state.draftMailId && item.status === "draft"), "draft DB row missing");
    assert(db.audit.some((item) => item.target_id === state.draftMailId && item.event_type === "mail.draft.saved"), "draft audit missing");
    assert(db.protected.filter((item) => item.status === "active").length === 3, "protected account state changed");
    assert(network.length > 0, "browser API network missing");
    assert(network.every((entry) => entry.url.startsWith("http://127.0.0.1:3520/api/v1/")), "non same-origin browser API request");
    result.checks.dbAudit = db;
    result.checks.sameOriginNetwork = { count: network.length, allSameOrigin: true };
  });

  result.status = "passed";
} catch (error) {
  failure = error;
  result.status = "failed";
  result.error = error instanceof Error ? error.message : String(error);
  if (page && !page.isClosed()) {
    await page.screenshot({ path: resolve(evidenceDir, "failure.png") }).catch(() => {});
    await writeFile(resolve(evidenceDir, "failure-dom.html"), await page.content().catch(() => "")).catch(() => {});
  }
} finally {
  try {
    result.cleanup = await step("cleanup", cleanup, 45000);
    assert(result.cleanup.errors.length === 0, `cleanup errors: ${result.cleanup.errors.join(",")}`);
    assert(result.cleanup.protectedAccountsActive === 3, "protected accounts not active after cleanup");
    if (state.draftMailId) assert(result.cleanup.db.mails.some((item) => item.id === state.draftMailId && item.deleted_at), "draft cleanup deleted_at is missing");
  } catch (cleanupError) {
    failure ||= cleanupError;
    result.status = "failed";
    result.cleanup = { error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError) };
  }
  result.finishedAt = new Date().toISOString();
  await writeFile(resolve(evidenceDir, "network.json"), JSON.stringify(sanitize(network), null, 2));
  await writeFile(resolve(evidenceDir, "console-errors.json"), JSON.stringify(sanitize(consoleErrors), null, 2));
  await writeFile(resolve(evidenceDir, "result.json"), JSON.stringify(sanitize(result), null, 2));
  await browser?.close().catch(() => {});
}
if (failure) throw failure;
console.log(JSON.stringify({ runId, status: result.status, evidenceDir }));
