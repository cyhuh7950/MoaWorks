import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isDeepStrictEqual, promisify } from "node:util";
import { chromium } from "playwright";

const execFileAsync = promisify(execFile);
const runId = process.argv[2] || `verify.ui006.${Date.now()}.${randomUUID().slice(0, 8)}`;
const adminPassword = process.env.MOAWORKS_TEST_PASSWORD;
if (!adminPassword) throw new Error("MOAWORKS_TEST_PASSWORD is required");
const verifyPassword = process.env.MOAWORKS_VERIFY_USER_PASSWORD || "Vfy!20260718";
const root = resolve(import.meta.dirname, "../../..");
const backend = resolve(root, "backend");
const apiBase = "http://127.0.0.1:8510/api/v1";
const webBase = "http://127.0.0.1:3520";
const evidenceDir = resolve(root, "docs/evidence/ui006-notification-center", runId);
const progressPath = resolve(evidenceDir, "progress.jsonl");
await mkdir(evidenceDir, { recursive: true });

const state = { adminToken: "", adminUserId: "", roleIds: [], userIds: [], notificationIds: [], preferenceAuditIds: [], originalPreferences: null };
const network = [];
const consoleErrors = [];
const httpErrors = [];
const result = { runId, status: "running", startedAt: new Date().toISOString(), checks: {}, cleanup: null };

const sanitize = (value, key = "") => {
  if (value == null) return value;
  if (/token|authorization|cookie|password|secret/i.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map(item => sanitize(item));
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, sanitize(entryValue, entryKey)]));
  if (typeof value === "string") return value.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]").replace(/([?&](?:token|access_token)=)[^&]+/gi, "$1[REDACTED]");
  return value;
};
const record = (step, status, details = {}) => appendFile(progressPath, JSON.stringify(sanitize({ at: new Date().toISOString(), step, status, ...details })) + "\n");
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const step = async (name, action, timeoutMs = 30000) => {
  await record(name, "start", { timeoutMs });
  const started = Date.now();
  let timeoutId;
  try {
    const value = await Promise.race([
      action(),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`${name} timeout after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    await record(name, "success", { elapsedMs: Date.now() - started });
    return value;
  } catch (error) {
    await record(name, "failure", { elapsedMs: Date.now() - started, message: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

async function request(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, { ...options, signal: AbortSignal.timeout(10000) });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}
async function ok(path, options = {}) {
  const response = await request(path, options);
  if (response.status < 200 || response.status >= 300) throw new Error(`${path}: ${response.status}/${response.body?.code ?? response.body?.detail?.code ?? "REQUEST_FAILED"}`);
  return response.body;
}
const adminOptions = (method = "GET", body) => ({
  method,
  headers: { authorization: `Bearer ${state.adminToken}`, ...(body ? { "content-type": "application/json" } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
const userOptions = (token, method = "GET", body) => ({
  method,
  headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

async function login(email, password) {
  return request("/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
}
async function emit(targetUserId, suffix, category = "system", resourceType = "notification") {
  const now = new Date().toISOString();
  const body = await ok("/internal/observability/events", adminOptions("POST", {
    schemaVersion: "1.0",
    eventId: `${runId}.${suffix}.event`,
    eventType: `verify.ui006.${suffix}`,
    category,
    severity: suffix.includes("critical") ? "CRITICAL" : "INFO",
    resourceType,
    resourceId: `${runId}.${suffix}.resource`,
    requestId: `${runId}.${suffix}`,
    dedupKey: `${runId}.${suffix}`,
    title: `${runId} ${suffix}`,
    message: `UI-006 ${suffix} 검수 알림`,
    source: "ui006-harness",
    companyId: "moaworks.local",
    actorUserId: state.adminUserId,
    occurredAt: now,
    createdAt: now,
    payload: { runId, suffix },
    targets: [targetUserId],
    visibility: "user",
    links: {},
    delivery: {},
    auditing: { runId },
    targetAudience: "user",
  }));
  state.notificationIds.push(body.notificationId ?? `${runId}.${suffix}.event`);
  return body;
}

async function createAccessData() {
  const directory = await ok("/admin/directory", adminOptions());
  const department = directory.departments.find(item => item.status === "active");
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
    const loginId = `u6${Date.now().toString(36)}${suffix}`.toLowerCase();
    const user = await ok("/admin/users", adminOptions("POST", {
      name: `${runId}.${suffix}`, loginId, password: verifyPassword,
      departmentId: department.id, roleId, status, userType: "user",
    }));
    state.userIds.push(user.userId);
    if (status === "active") await ok(`/admin/users/${user.userId}`, adminOptions("PATCH", { password: verifyPassword }));
    return { ...user, loginId };
  };
  const forbidden = await createUser("forbidden", forbiddenRole.id, "active");
  const inactiveUser = await createUser("inactiveuser", inactiveUserRole.id, "inactive");
  const inactiveRoleUser = await createUser("inactiverole", inactiveRole.id, "active");
  await ok(`/admin/roles/${inactiveRole.id}`, adminOptions("PATCH", { status: "inactive" }));
  return { forbidden, inactiveUser, inactiveRoleUser };
}

async function dbEvidence() {
  const code = [
    "import json",
    "from app.services.postgres_service import PostgresService",
    `run_id = ${JSON.stringify(runId)}`,
    `notification_ids = ${JSON.stringify(state.notificationIds)}`,
    `preference_audit_ids = ${JSON.stringify(state.preferenceAuditIds)}`,
    "with PostgresService().connect() as connection:",
    "    with connection.cursor() as cursor:",
    "        cursor.execute(\"SELECT notification_id, user_id, status, read_at, archived_at FROM notification_user_states WHERE notification_id = ANY(%s) ORDER BY notification_id, user_id\", (notification_ids,))",
    "        states = cursor.fetchall()",
    "        cursor.execute(\"SELECT audit_id, actor_user_id, target_id, event_type, status, reason FROM notification_action_audit WHERE target_id = ANY(%s) OR payload->>'runId' = %s OR audit_id = ANY(%s) ORDER BY created_at\", (notification_ids, run_id, preference_audit_ids))",
    "        audit = cursor.fetchall()",
    "        cursor.execute(\"SELECT enabled, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, categories FROM notification_preferences WHERE user_id = %s\", (" + JSON.stringify(state.adminUserId) + ",))",
    "        preferences = cursor.fetchone()",
    "        cursor.execute(\"SELECT COUNT(*) AS count FROM users WHERE email IN ('admin@moaworks.local','cyhuh@moaworks.local','ysla@moaworks.local') AND status = 'active'\")",
    "        protected = cursor.fetchone()['count']",
    "print(json.dumps({'states': states, 'audit': audit, 'preferences': preferences, 'protectedAccountsActive': protected}, default=str))",
  ].join("\n");
  const { stdout } = await execFileAsync("uv", ["run", "python", "-c", code], { cwd: backend, timeout: 30000 });
  return JSON.parse(stdout.trim());
}

async function preferenceAuditIdsSinceStart() {
  if (!state.adminUserId) return [];
  const code = [
    "import json",
    "from app.services.postgres_service import PostgresService",
    "admin_user_id = " + JSON.stringify(state.adminUserId),
    "started_at = " + JSON.stringify(result.startedAt),
    "with PostgresService().connect() as connection:",
    "    with connection.cursor() as cursor:",
    "        cursor.execute(\"SELECT audit_id FROM notification_action_audit WHERE actor_user_id = %s AND target_id = %s AND event_type = 'notification.preferences.updated' AND created_at >= %s::timestamptz ORDER BY created_at\", (admin_user_id, admin_user_id, started_at))",
    "        rows = [row['audit_id'] for row in cursor.fetchall()]",
    "print(json.dumps(rows))",
  ].join("\n");
  const { stdout } = await execFileAsync("uv", ["run", "python", "-c", code], { cwd: backend, timeout: 30000 });
  return JSON.parse(stdout.trim());
}

function appendNewPreferenceAuditIds(beforeIds, afterIds) {
  const before = new Set(beforeIds);
  state.preferenceAuditIds = [...new Set([
    ...state.preferenceAuditIds,
    ...afterIds.filter(id => !before.has(id)),
  ])];
}

async function restorePreferences() {
  const comparableKeys = ["enabled", "quietHoursEnabled", "quietHoursStart", "quietHoursEnd", "categories"];
  let lastStatus = 0;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const preferenceAuditBefore = await preferenceAuditIdsSinceStart();
    const restored = await request("/notifications/preferences", adminOptions("PUT", state.originalPreferences));
    lastStatus = restored.status;
    appendNewPreferenceAuditIds(preferenceAuditBefore, await preferenceAuditIdsSinceStart());
    if (restored.status === 200) {
      const verified = await request("/notifications/preferences", adminOptions());
      const matches = verified.status === 200
        && comparableKeys.every(key => isDeepStrictEqual(verified.body?.[key], state.originalPreferences[key]));
      if (matches) return null;
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 500 * attempt));
  }
  return `preferences:${lastStatus || "verify-failed"}`;
}

async function cleanup() {
  const errors = [];
  if (state.originalPreferences && state.adminToken) {
    const restoreError = await restorePreferences();
    if (restoreError) errors.push(restoreError);
  }
  for (const id of state.userIds) {
    const response = await request(`/admin/users/${id}`, adminOptions("DELETE"));
    if (response.status < 200 || response.status >= 300) errors.push(`user:${id}:${response.status}`);
  }
  for (const id of state.roleIds) {
    const response = await request(`/admin/roles/${id}`, adminOptions("DELETE"));
    if (response.status < 200 || response.status >= 300) errors.push(`role:${id}:${response.status}`);
  }
  const code = [
    "from app.services.postgres_service import PostgresService",
    `run_id = ${JSON.stringify(runId)}`,
    `preference_audit_ids = ${JSON.stringify(state.preferenceAuditIds)}`,
    "with PostgresService().connect() as connection:",
    "    with connection.cursor() as cursor:",
    "        cursor.execute(\"DELETE FROM notification_user_states WHERE notification_id IN (SELECT notification_id FROM notifications WHERE request_id LIKE %s)\", (run_id + '%',))",
    "        cursor.execute(\"DELETE FROM notification_action_audit WHERE target_id IN (SELECT notification_id FROM notifications WHERE request_id LIKE %s) OR payload->>'runId' = %s\", (run_id + '%', run_id))",
    "        cursor.execute(\"DELETE FROM notification_action_audit WHERE audit_id = ANY(%s)\", (preference_audit_ids,))",
    "        cursor.execute(\"DELETE FROM notifications WHERE request_id LIKE %s\", (run_id + '%',))",
    "        cursor.execute(\"DELETE FROM monitoring_events WHERE request_id LIKE %s\", (run_id + '%',))",
    "    connection.commit()",
    "print('cleanup=ok')",
  ].join("\n");
  await execFileAsync("uv", ["run", "python", "-c", code], { cwd: backend, timeout: 30000 });
  const db = await dbEvidence();
  return { errors, protectedAccountsActive: db.protectedAccountsActive, remainingStates: db.states.length, remainingAudit: db.audit.length };
}

async function loginPage(page, loginId, password) {
  await page.goto(`${webBase}/`, { waitUntil: "domcontentloaded", timeout: 10000 });
  await page.locator("input").first().fill(loginId);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: /로그인/i }).click();
}

let browser;
let failure;
try {
  await step("g0", async () => {
    for (const url of [`${apiBase}/health`, `${webBase}/api/v1/health`]) {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const body = await response.json();
      assert(response.status === 200 && body.initialized === true, `health failed: ${url}`);
    }
    result.checks.g0 = "passed";
  });

  const accessData = await step("prepare", async () => {
    const adminLogin = await login("admin@moaworks.local", adminPassword);
    assert(adminLogin.status === 200, `admin login ${adminLogin.status}`);
    state.adminToken = adminLogin.body.accessToken;
    state.adminUserId = adminLogin.body.user.userId;
    state.originalPreferences = await ok("/notifications/preferences", adminOptions());
    await emit(state.adminUserId, "recent");
    await emit(state.adminUserId, "critical");
    return createAccessData();
  });

  if (process.env.MOAWORKS_UI006_FORCE_FAILURE_AFTER_PREPARE === "1") {
    throw new Error("UI-006 forced failure after prepare for cleanup verification");
  }

  await step("api-access", async () => {
    const noToken = await request("/notifications");
    assert(noToken.status === 401, `401 expected, got ${noToken.status}`);
    const forbiddenLogin = await login(`${accessData.forbidden.loginId}@moaworks.local`, verifyPassword);
    assert(forbiddenLogin.status === 200, `forbidden login ${forbiddenLogin.status}`);
    const forbiddenGet = await request(`/notifications/${state.notificationIds[0]}`, userOptions(forbiddenLogin.body.accessToken));
    assert(forbiddenGet.status === 403, `403 expected, got ${forbiddenGet.status}`);
    const inactiveUser = await login(`${accessData.inactiveUser.loginId}@moaworks.local`, verifyPassword);
    assert(inactiveUser.status === 423, `inactive user expected 423, got ${inactiveUser.status}`);
    const inactiveRole = await login(`${accessData.inactiveRoleUser.loginId}@moaworks.local`, verifyPassword);
    assert(inactiveRole.status === 423, `inactive role expected 423, got ${inactiveRole.status}`);
    result.checks.access = { unauthorized: 401, forbidden: 403, inactiveUser: 423, inactiveRole: 423 };
  });

  await step("chrome-admin", async () => {
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await context.newPage();
    page.on("request", request => {
      if (!request.url().includes("/api/v1/")) return;
      network.push({ method: request.method(), url: sanitize(request.url()) });
    });
    page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
    page.on("response", response => { if (response.status() >= 400) httpErrors.push({ status: response.status(), url: sanitize(response.url()) }); });
    await loginPage(page, "admin", adminPassword);
    await page.locator(".user-app-rail-menu").waitFor({ timeout: 15000 });
  await record("chrome-admin-login", "success");

    await page.getByRole("button", { name: /알림 \d+건/ }).click();
    await page.getByRole("dialog", { name: "최근 알림" }).waitFor();
    await page.getByRole("dialog", { name: "최근 알림" }).getByRole("button").filter({ hasText: `${runId} recent` }).click();
  await record("chrome-admin-recent", "success");
    await page.getByRole("heading", { name: "전체 알림" }).waitFor();
    await page.getByText(`${runId} recent`, { exact: true }).waitFor();

    await page.getByLabel(`${runId} recent 선택`).check();
    await page.getByRole("button", { name: "읽음 처리", exact: true }).click();
  await record("chrome-admin-read", "success");
    const criticalRow = page.locator(".notification-center-row").filter({ hasText: `${runId} critical` }).first();
    await criticalRow.waitFor({ state: "visible", timeout: 10000 });
    await criticalRow.getByRole("checkbox").check();
    const archiveResponsePromise = page.waitForResponse(
      response => response.request().method() === "POST"
        && response.url().includes("/notifications/bulk/archive"),
      { timeout: 10000 },
    );
    page.once("dialog", dialog => dialog.accept());
    await page.getByRole("button", { name: "삭제", exact: true }).click();
    const archiveResponse = await archiveResponsePromise;
    assert(archiveResponse.status() === 200, `notification archive ${archiveResponse.status()}`);
    await page.waitForFunction(
      title => [...document.querySelectorAll(".notification-center-row")].every(
        row => !row.textContent?.includes(title),
      ),
      `${runId} critical`,
      { timeout: 10000 },
    );
  await record("chrome-admin-delete", "success");

    await page.getByRole("button", { name: "알림 설정", exact: true }).click();
    const settingsDialog = page.getByRole("dialog", { name: "알림 설정" });
    await settingsDialog.waitFor();
    await settingsDialog.getByLabel("방해 금지 시간 사용").check({ force: true });
    const preferenceAuditBefore = await preferenceAuditIdsSinceStart();
    const saveResponsePromise = page.waitForResponse(
      response => response.request().method() === "PUT" && response.url().includes("/notifications/preferences"),
      { timeout: 10000 },
    );
    await settingsDialog.getByRole("button", { name: "저장", exact: true }).click();
    assert((await saveResponsePromise).status() === 200, "preferences save failed");
    appendNewPreferenceAuditIds(preferenceAuditBefore, await preferenceAuditIdsSinceStart());
    assert(state.preferenceAuditIds.length > 0, "preferences audit id missing");
  await record("chrome-admin-preferences", "success");

    const measurements = await page.evaluate(() => {
      const list = document.querySelector(".notification-center-list");
      const detail = document.querySelector(".notification-center-detail");
      return {
        viewport: { width: innerWidth, height: innerHeight },
        page: { clientHeight: document.documentElement.clientHeight, scrollHeight: document.documentElement.scrollHeight, pageHasScroll: document.documentElement.scrollHeight > document.documentElement.clientHeight },
        list: list ? { clientHeight: list.clientHeight, scrollHeight: list.scrollHeight, overflowY: getComputedStyle(list).overflowY } : null,
        detail: detail ? { clientHeight: detail.clientHeight, scrollHeight: detail.scrollHeight, overflowY: getComputedStyle(detail).overflowY } : null,
      };
    });
    assert(measurements.viewport.width === 1920 && measurements.viewport.height === 1080, "viewport mismatch");
    assert(measurements.page.pageHasScroll === false, "whole page scroll detected");
    assert(measurements.list?.overflowY === "auto" && measurements.detail?.overflowY === "auto", "internal scroll contract missing");
    await page.screenshot({ path: resolve(evidenceDir, "notification-center-1920x1080.png"), fullPage: false });
    await writeFile(resolve(evidenceDir, "measurements.json"), JSON.stringify(measurements, null, 2));
    result.checks.chrome = { recentPopup: true, bulkRead: true, softDelete: true, preferences: true, measurements };
    await context.close();
  }, 90000);

  await step("chrome-access", async () => {
    const unauthorized = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await unauthorized.goto(`${webBase}/`, { waitUntil: "domcontentloaded" });
    const unauthorizedStatus = await unauthorized.evaluate(async () => (await fetch("/api/v1/notifications")).status);
    assert(unauthorizedStatus === 401, "browser 401 missing");
    await unauthorized.getByRole("button", { name: /로그인/i }).waitFor();
    await unauthorized.screenshot({ path: resolve(evidenceDir, "unauthorized-401.png") });
    await unauthorized.close();

    const forbidden = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await loginPage(forbidden, accessData.forbidden.loginId, verifyPassword);
    await forbidden.locator(".user-app-rail-menu").waitFor({ timeout: 15000 });
    await emit(accessData.forbidden.userId, "forbidden-mail", "mail", "mail");
    await forbidden.getByRole("button", { name: /알림 \d+건/ }).click();
    const forbiddenRow = forbidden.locator(".user-notification-row", { hasText: `${runId} forbidden-mail` }).first();
    await forbiddenRow.waitFor({ state: "visible", timeout: 10000 });
    await forbiddenRow.click();
    await forbidden.getByText("원본 항목이 삭제되었거나 접근 권한이 없습니다.", { exact: false }).waitFor({ timeout: 10000 });
    await forbidden.screenshot({ path: resolve(evidenceDir, "forbidden-403.png") });
    await forbidden.close();

    for (const [name, data, expected] of [
      ["inactive-user-423", accessData.inactiveUser, "비활성화된 사용자 계정입니다."],
      ["inactive-role-423", accessData.inactiveRoleUser, "사용자의 권한 역할이 비활성화되어 로그인할 수 없습니다."],
    ]) {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      await loginPage(page, data.loginId, verifyPassword);
      await page.getByText(expected, { exact: false }).waitFor({ timeout: 10000 });
      await page.screenshot({ path: resolve(evidenceDir, `${name}.png`) });
      await page.close();
    }
    result.checks.accessScreens = ["401", "403", "inactive-user-423", "inactive-role-423"];
  }, 90000);

  await step("db-audit", async () => {
    const db = await dbEvidence();
    assert(db.states.some(item => item.status === "read"), "read state missing");
    assert(db.states.some(item => item.status === "archived"), "archived state missing");
    assert(db.audit.some(item => item.event_type === "notification.read"), "read audit missing");
    assert(db.audit.some(item => item.event_type === "notification.archived"), "archive audit missing");
    assert(db.audit.some(item => item.event_type === "notification.preferences.updated"), "preferences audit missing");
    assert(db.protectedAccountsActive === 3, "protected accounts changed");
    result.checks.dbAudit = db;
    await writeFile(resolve(evidenceDir, "db-audit.json"), JSON.stringify(sanitize(db), null, 2));
  });

  await step("network", async () => {
    assert(network.length > 0, "no browser API network");
    assert(network.every(item => item.url.startsWith(`${webBase}/api/v1/`)), "non same-origin browser API request");
    await writeFile(resolve(evidenceDir, "network.json"), JSON.stringify(sanitize(network), null, 2));
    await writeFile(resolve(evidenceDir, "console-errors.json"), JSON.stringify(sanitize(consoleErrors), null, 2));
    await writeFile(resolve(evidenceDir, "http-errors.json"), JSON.stringify(sanitize(httpErrors), null, 2));
    result.checks.sameOriginRequests = network.length;
  });

  result.status = "passed";
} catch (error) {
  failure = error;
  result.status = "failed";
  result.error = error instanceof Error ? error.message : String(error);
} finally {
  await browser?.close().catch(() => {});
  if (state.adminToken) {
    try {
      result.cleanup = await step("cleanup", cleanup, 60000);
    } catch (cleanupError) {
      result.cleanup = { error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError) };
      failure ??= cleanupError;
      result.status = "failed";
    }
  }
  result.finishedAt = new Date().toISOString();
  await writeFile(resolve(evidenceDir, "cleanup-result.json"), JSON.stringify(sanitize(result.cleanup), null, 2));
  await writeFile(resolve(evidenceDir, "result.json"), JSON.stringify(sanitize(result), null, 2));
  await record("complete", result.status);
}
if (failure) throw failure;
console.log(JSON.stringify({ runId, status: result.status, evidenceDir }));
