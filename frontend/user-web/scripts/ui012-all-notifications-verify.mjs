import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright";

const execFileAsync = promisify(execFile);
const runId = process.argv[2] || `verify.ui012.${Date.now()}.${randomUUID().slice(0, 8)}`;
const adminPassword = process.env.MOAWORKS_TEST_PASSWORD;
const verifyPassword = process.env.MOAWORKS_VERIFY_USER_PASSWORD;
if (!adminPassword) throw new Error("MOAWORKS_TEST_PASSWORD is required");
if (!verifyPassword) throw new Error("MOAWORKS_VERIFY_USER_PASSWORD is required");

const root = resolve(import.meta.dirname, "../../..");
const backend = resolve(root, "backend");
const backendPython = process.env.MOAWORKS_BACKEND_PYTHON || resolve(backend, ".venv/Scripts/python.exe");
const apiBase = "http://127.0.0.1:8510/api/v1";
const webBase = "http://127.0.0.1:3520";
const evidenceDir = resolve(root, "docs/evidence/ui012-all-notifications", runId);
const progressPath = resolve(evidenceDir, "progress.jsonl");
await mkdir(evidenceDir, { recursive: true });

const state = { adminToken: "", adminUserId: "", scheduleId: "", notificationIds: [], notificationBySuffix: {} };
const network = [];
const consoleErrors = [];
const httpErrors = [];
const result = { runId, status: "running", startedAt: new Date().toISOString(), checks: {}, cleanup: null };

const sanitize = (value, key = "") => {
  if (value == null) return value;
  if (/token|authorization|cookie|password|secret/i.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map(item => sanitize(item));
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, sanitize(entryValue, entryKey)]));
  if (typeof value === "string") return value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/([?&](?:token|access_token)=)[^&]+/gi, "$1[REDACTED]");
  return value;
};
const record = (stage, status, detail = {}) => appendFile(progressPath, `${JSON.stringify(sanitize({ at: new Date().toISOString(), runId, stage, status, detail }))}\n`);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));
const step = async (stage, action, timeoutMs = 30000) => {
  await record(stage, "START");
  let timer;
  try {
    const value = await Promise.race([
      action(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${stage} timeout after ${timeoutMs}ms`)), timeoutMs); }),
    ]);
    clearTimeout(timer);
    await record(stage, "OK");
    return value;
  } catch (error) {
    clearTimeout(timer);
    await record(stage, "FAIL", { message: error instanceof Error ? error.message : String(error) });
    throw error;
  }
};

async function request(path, options = {}) {
  const { timeoutMs = 10000, ...fetchOptions } = options;
  const response = await fetch(`${apiBase}${path}`, { ...fetchOptions, signal: AbortSignal.timeout(timeoutMs) });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}
const adminOptions = (method = "GET", body) => ({
  method,
  headers: { authorization: `Bearer ${state.adminToken}`, ...(body ? { "content-type": "application/json" } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
async function ok(path, options = {}) {
  const response = await request(path, options);
  assert(response.status >= 200 && response.status < 300, `${path}: ${response.status}`);
  return response.body;
}
async function login(email, password) {
  return request("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
    timeoutMs: 15000,
  });
}
async function execDb(code) {
  const { stdout } = await execFileAsync(backendPython, ["-c", code], { cwd: backend, timeout: 20000, maxBuffer: 1024 * 1024 * 8 });
  return stdout.trim();
}
async function emit(suffix, category = "system", resourceType = "notification", resourceId = `${runId}.${suffix}.resource`) {
  const now = new Date().toISOString();
  const payload = {
    schemaVersion: "1.0",
    eventId: `${runId}.${suffix}.event`,
    eventType: `verify.ui012.${suffix}`,
    category,
    severity: "INFO",
    resourceType,
    resourceId,
    requestId: `${runId}.${suffix}`,
    dedupKey: `${runId}.${suffix}`,
    title: `${runId} ${suffix}`,
    message: `UI-012 ${suffix} 검수 알림`,
    source: "ui012-harness",
    companyId: "moaworks.local",
    actorUserId: state.adminUserId,
    occurredAt: now,
    createdAt: now,
    payload: { runId, suffix },
    targets: [state.adminUserId],
    visibility: "user",
    links: {},
    delivery: {},
    auditing: { runId },
    targetAudience: "user",
  };
  const body = await ok("/internal/observability/events", { ...adminOptions("POST", payload), timeoutMs: 15000 });
  const notificationId = body.notificationId ?? payload.eventId;
  state.notificationIds.push(notificationId);
  state.notificationBySuffix[suffix] = notificationId;
  await delay(80);
  return notificationId;
}
async function waitForApiState(notificationId, expectedStatus) {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const response = await request(`/notifications/${notificationId}`, adminOptions());
    if (response.status === 200 && response.body.status === expectedStatus) return response.body;
    await delay(250);
  }
  throw new Error(`${notificationId} did not reach ${expectedStatus}`);
}

async function waitForArchivedHidden(notificationId) {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const response = await request(`/notifications/${notificationId}`, adminOptions());
    if (response.status === 404) return;
    await delay(250);
  }
  throw new Error(`${notificationId} remained visible after soft-delete`);
}

async function dbEvidence() {
  const code = [
    "import json",
    "from app.services.postgres_service import PostgresService",
    `notification_ids = ${JSON.stringify(state.notificationIds)}`,
    `schedule_id = ${JSON.stringify(state.scheduleId)}`,
    "with PostgresService().connect() as connection:",
    "    with connection.cursor() as cursor:",
    "        cursor.execute(\"SELECT notification_id, user_id, status, read_at, archived_at FROM notification_user_states WHERE notification_id = ANY(%s) ORDER BY notification_id\", (notification_ids,))",
    "        states = cursor.fetchall()",
    "        cursor.execute(\"SELECT notification_id, resource_type, resource_id, request_id FROM notifications WHERE notification_id = ANY(%s) ORDER BY request_id\", (notification_ids,))",
    "        notifications = cursor.fetchall()",
    "        cursor.execute(\"SELECT audit_id, target_id, event_type, status FROM notification_action_audit WHERE target_id = ANY(%s) ORDER BY created_at\", (notification_ids,))",
    "        audit = cursor.fetchall()",
    "        cursor.execute(\"SELECT id, title, status FROM user_schedule_events WHERE id = %s\", (schedule_id,))",
    "        schedule = cursor.fetchone()",
    "        cursor.execute(\"SELECT id, email, status FROM users WHERE email IN ('admin@moaworks.local','cyhuh@moaworks.local','ysla@moaworks.local') ORDER BY email\")",
    "        protected = cursor.fetchall()",
    "print(json.dumps({'states': states, 'notifications': notifications, 'audit': audit, 'schedule': schedule, 'protected': protected}, default=str))",
  ].join("\n");
  return JSON.parse(await execDb(code));
}

async function ownedRunData() {
  const code = [
    "import json",
    "from app.services.postgres_service import PostgresService",
    `run_id = ${JSON.stringify(runId)}`,
    "pattern = run_id + '.%'",
    "with PostgresService().connect() as connection:",
    "    with connection.cursor() as cursor:",
    "        cursor.execute(\"SELECT id, title, status FROM user_schedule_events WHERE title LIKE %s ORDER BY title\", (pattern,))",
    "        schedules = cursor.fetchall()",
    "        cursor.execute(\"SELECT notification_id, request_id FROM notifications WHERE request_id LIKE %s ORDER BY request_id\", (pattern,))",
    "        notifications = cursor.fetchall()",
    "        ids = [row['notification_id'] for row in notifications]",
    "        cursor.execute(\"SELECT notification_id, user_id, status FROM notification_user_states WHERE notification_id = ANY(%s) ORDER BY notification_id\", (ids,))",
    "        states = cursor.fetchall()",
    "        cursor.execute(\"SELECT audit_id, target_id, event_type FROM notification_action_audit WHERE target_id = ANY(%s) OR payload->>'runId' = %s ORDER BY created_at\", (ids, run_id))",
    "        audit = cursor.fetchall()",
    "        cursor.execute(\"SELECT event_id, request_id FROM monitoring_events WHERE request_id LIKE %s ORDER BY request_id\", (pattern,))",
    "        events = cursor.fetchall()",
    "        cursor.execute(\"SELECT id, email, status FROM users WHERE email IN ('admin@moaworks.local','cyhuh@moaworks.local','ysla@moaworks.local') ORDER BY email\")",
    "        protected = cursor.fetchall()",
    "print(json.dumps({'schedules': schedules, 'notifications': notifications, 'states': states, 'audit': audit, 'events': events, 'protected': protected}, default=str))",
  ].join("\n");
  return JSON.parse(await execDb(code));
}

async function cleanup() {
  const before = await ownedRunData();
  await writeFile(resolve(evidenceDir, "cleanup-owned-before.json"), JSON.stringify(sanitize(before), null, 2));
  for (const schedule of before.schedules.filter(item => item.status !== "deleted")) {
    const response = await request(`/workspace/schedules/${schedule.id}`, adminOptions("DELETE"));
    assert((response.status >= 200 && response.status < 300) || response.status === 404, `schedule cleanup ${response.status}`);
  }
  const notificationIds = before.notifications.map(item => item.notification_id);
  const auditIds = before.audit.map(item => item.audit_id);
  const eventIds = before.events.map(item => item.event_id);
  const code = [
    "from app.services.postgres_service import PostgresService",
    `notification_ids = ${JSON.stringify(notificationIds)}`,
    `audit_ids = ${JSON.stringify(auditIds)}`,
    `event_ids = ${JSON.stringify(eventIds)}`,
    "with PostgresService().connect() as connection:",
    "    with connection.cursor() as cursor:",
    "        if notification_ids: cursor.execute(\"DELETE FROM notification_user_states WHERE notification_id = ANY(%s)\", (notification_ids,))",
    "        if audit_ids: cursor.execute(\"DELETE FROM notification_action_audit WHERE audit_id = ANY(%s)\", (audit_ids,))",
    "        if notification_ids: cursor.execute(\"DELETE FROM notifications WHERE notification_id = ANY(%s)\", (notification_ids,))",
    "        if event_ids: cursor.execute(\"DELETE FROM monitoring_events WHERE event_id = ANY(%s)\", (event_ids,))",
    "    connection.commit()",
  ].join("\n");
  await execDb(code);
  const after = await ownedRunData();
  await writeFile(resolve(evidenceDir, "cleanup-owned-after.json"), JSON.stringify(sanitize(after), null, 2));
  const remaining = {
    activeSchedules: after.schedules.filter(item => item.status !== "deleted").length,
    notifications: after.notifications.length,
    states: after.states.length,
    audit: after.audit.length,
    events: after.events.length,
  };
  const protectedAccountsActive = after.protected.filter(item => item.status === "active").length;
  const errors = [];
  if (Object.values(remaining).some(count => count !== 0)) errors.push(`remaining:${JSON.stringify(remaining)}`);
  if (protectedAccountsActive !== 3) errors.push(`protected:${protectedAccountsActive}`);
  return { errors, beforeCounts: { schedules: before.schedules.length, notifications: before.notifications.length, states: before.states.length, audit: before.audit.length, events: before.events.length }, remaining, protectedAccountsActive };
}

async function scanEvidence() {
  const invalidJson = [];
  const sensitiveValueHits = [];
  const sensitivePattern = /"(?:accessToken|refreshToken|token|password|authorization|cookie|secret)"\s*:\s*"(?!\[REDACTED\])[^"\r\n]+"|Bearer\s+(?!\[REDACTED\])[A-Za-z0-9._-]+/gi;
  for (const entry of await readdir(evidenceDir, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(json|jsonl)$/.test(entry.name) || entry.name === "security-scan.json") continue;
    const text = await readFile(resolve(evidenceDir, entry.name), "utf8");
    try {
      if (entry.name.endsWith(".jsonl")) for (const line of text.split(/\r?\n/).filter(Boolean)) JSON.parse(line);
      else JSON.parse(text);
    } catch (error) {
      invalidJson.push({ file: entry.name, error: error instanceof Error ? error.message : String(error) });
    }
    if (sensitivePattern.test(text)) sensitiveValueHits.push(entry.name);
    sensitivePattern.lastIndex = 0;
  }
  const nonSameOriginApiUrls = network.map(item => item.url).filter(url => !url.startsWith(`${webBase}/api/v1/`));
  return { status: invalidJson.length || sensitiveValueHits.length || nonSameOriginApiUrls.length ? "failed" : "passed", invalidJson, sensitiveValueHits, apiRequestCount: network.length, nonSameOriginApiUrls };
}

async function loginPage(page) {
  await page.goto(`${webBase}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.locator("input").first().fill("admin");
  await page.locator('input[type="password"]').fill(adminPassword);
  await page.getByRole("button", { name: /로그인/i }).click();
  await page.locator(".user-app-rail-menu").waitFor({ timeout: 15000 });
}
const rowFor = (page, suffix) => page.locator(".notification-center-row", { hasText: `${runId} ${suffix}` }).first();

let browser;
let failure;
try {
  await step("g0-runtime", async () => {
    for (const url of [`${apiBase}/health`, `${webBase}/api/v1/health`]) {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const body = await response.json();
      assert(response.status === 200 && body.initialized === true, `health failed: ${url}`);
    }
    result.checks.health = { api: 200, userWebProxy: 200 };
  });

  await step("prepare-data", async () => {
    const loginResponse = await login("admin@moaworks.local", adminPassword);
    assert(loginResponse.status === 200, `admin login ${loginResponse.status}`);
    state.adminToken = loginResponse.body.accessToken;
    state.adminUserId = loginResponse.body.user.userId;
    const startsAt = new Date(Date.now() + 3600000).toISOString();
    const endsAt = new Date(Date.now() + 7200000).toISOString();
    const schedule = await ok("/workspace/schedules", adminOptions("POST", { title: `${runId}.schedule`, startsAt, endsAt, description: "UI-012 source navigation" }));
    state.scheduleId = schedule.id;
    await emit("prefilter-read");
    await emit("bulk-a");
    await emit("bulk-b");
    await emit("read-all-a");
    await emit("read-all-b");
    await emit("archive-a");
    await emit("archive-b");
    await emit("schedule-link", "schedule", "schedule", schedule.id);
    await emit("single");
    await ok("/notifications/bulk/read", adminOptions("POST", { notificationIds: [state.notificationBySuffix["prefilter-read"]] }));
    result.checks.prepared = { schedule: true, notifications: state.notificationIds.length };
  }, 60000);

  await step("chrome-flow", async () => {
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await context.newPage();
    let nativeConfirmCount = 0;
    page.on("dialog", async dialog => { nativeConfirmCount += 1; await dialog.dismiss(); });
    page.on("request", request => {
      if (request.url().includes("/api/v1/")) network.push({ method: request.method(), url: sanitize(request.url()) });
    });
    page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
    page.on("response", response => { if (response.status() >= 400) httpErrors.push({ status: response.status(), url: sanitize(response.url()) }); });
    await loginPage(page);

    const entry = page.locator(".user-notification-entry");
    await entry.waitFor();
    await entry.click();
    const recentDialog = page.getByRole("dialog", { name: "최근 알림" });
    await recentDialog.waitFor();

    let releaseList;
    let listIntercepted;
    const listRelease = new Promise(resolveRelease => { releaseList = resolveRelease; });
    const listGate = new Promise(resolveGate => { listIntercepted = resolveGate; });
    let held = false;
    const listPattern = "**/api/v1/notifications?*";
    const loadingHandler = async route => {
      if (!held) { held = true; listIntercepted(); await listRelease; }
      await route.continue();
    };
    await page.route(listPattern, loadingHandler);
    await recentDialog.getByRole("button", { name: "전체 알림 보기", exact: true }).click();
    await Promise.race([listGate, new Promise((_, reject) => setTimeout(() => reject(new Error("notification list intercept timeout")), 10000))]);
    await page.getByText("알림을 불러오는 중입니다.", { exact: true }).waitFor();
    releaseList();
    await page.getByRole("heading", { name: "전체 알림" }).waitFor();
    await page.unroute(listPattern, loadingHandler);

    const filters = page.locator(".notification-center-filters select");
    await filters.nth(0).selectOption("unread");
    await rowFor(page, "single").waitFor();
    await filters.nth(0).selectOption("read");
    await rowFor(page, "prefilter-read").waitFor();
    assert(await rowFor(page, "single").count() === 0, "unread item leaked into read filter");
    await filters.nth(0).selectOption("all");

    const summaryBeforeSingle = await ok("/notifications/summary", adminOptions());
    const singleRow = rowFor(page, "single");
    await singleRow.locator("button").click();
    await page.locator(".notification-center-detail").getByRole("button", { name: "읽음 처리", exact: true }).click();
    await waitForApiState(state.notificationBySuffix.single, "read");
    const summaryAfterSingle = await ok("/notifications/summary", adminOptions());
    assert(summaryAfterSingle.unreadCount === summaryBeforeSingle.unreadCount - 1, "single read summary mismatch");
    await page.waitForFunction(count => document.querySelector(".user-notification-entry")?.getAttribute("aria-label") === `알림, 미확인 ${count}건`, summaryAfterSingle.unreadCount);
    await entry.click();
    await recentDialog.waitFor();
    const recentSingle = recentDialog.locator(".user-notification-row", { hasText: `${runId} single` }).first();
    await recentSingle.waitFor();
    assert(!(await recentSingle.getAttribute("class")).includes("is-unread"), "recent popup single read not synchronized");
    await recentDialog.getByRole("button", { name: "알림 닫기" }).click();

    for (const suffix of ["bulk-a", "bulk-b"]) await page.getByLabel(`${runId} ${suffix} 선택`).check();
    await page.locator(".notification-center-selection").getByRole("button", { name: "읽음 처리", exact: true }).click();
    await Promise.all(["bulk-a", "bulk-b"].map(suffix => waitForApiState(state.notificationBySuffix[suffix], "read")));

    await page.locator(".notification-center-actions").getByRole("button", { name: "전체 읽음", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".user-notification-entry")?.getAttribute("aria-label") === "알림, 미확인 0건");
    assert((await ok("/notifications/summary", adminOptions())).unreadCount === 0, "read-all summary mismatch");

    for (const suffix of ["archive-a", "archive-b"]) await page.getByLabel(`${runId} ${suffix} 선택`).check();
    await page.locator(".notification-center-selection").getByRole("button", { name: "삭제", exact: true }).click();
    const deleteDialog = page.getByRole("alertdialog", { name: "알림 삭제" });
    await deleteDialog.waitFor();
    assert(nativeConfirmCount === 0, "native browser confirm used");
    await deleteDialog.getByRole("button", { name: "삭제", exact: true }).click();
    await Promise.all(["archive-a", "archive-b"].map(suffix => waitForArchivedHidden(state.notificationBySuffix[suffix])));
    assert(nativeConfirmCount === 0, "native browser confirm used after delete");

    const emptyHandler = route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ notifications: [], nextCursor: null, hasMore: false }) });
    await page.route(listPattern, emptyHandler);
    await page.locator(".notification-center-selection").getByRole("button", { name: "새로고침", exact: true }).click();
    await page.getByText("조건에 맞는 알림이 없습니다.", { exact: true }).waitFor();
    await page.unroute(listPattern, emptyHandler);

    const errorHandler = route => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "UI012_EXPECTED_ERROR" }) });
    await page.route(listPattern, errorHandler);
    await page.locator(".notification-center-selection").getByRole("button", { name: "새로고침", exact: true }).click();
    await page.locator(".notification-center-error").waitFor();
    await page.unroute(listPattern, errorHandler);
    await page.locator(".notification-center-selection").getByRole("button", { name: "새로고침", exact: true }).click();
    await rowFor(page, "schedule-link").waitFor();

    const measurements = await page.evaluate(() => {
      const list = document.querySelector(".notification-center-list");
      const detail = document.querySelector(".notification-center-detail");
      return {
        viewport: { width: innerWidth, height: innerHeight },
        pageHasScroll: document.documentElement.scrollHeight > document.documentElement.clientHeight,
        list: list ? { overflowY: getComputedStyle(list).overflowY, clientHeight: list.clientHeight, scrollHeight: list.scrollHeight } : null,
        detail: detail ? { overflowY: getComputedStyle(detail).overflowY, clientHeight: detail.clientHeight, scrollHeight: detail.scrollHeight } : null,
      };
    });
    assert(measurements.viewport.width === 1920 && measurements.viewport.height === 1080, "viewport mismatch");
    assert(measurements.pageHasScroll === false, "whole page scroll detected");
    assert(["auto", "scroll"].includes(measurements.list?.overflowY), "list internal scroll missing");
    assert(["auto", "scroll"].includes(measurements.detail?.overflowY), "detail internal scroll missing");
    await writeFile(resolve(evidenceDir, "measurements.json"), JSON.stringify(measurements, null, 2));
    await page.screenshot({ path: resolve(evidenceDir, "all-notifications.png"), fullPage: false });

    const sourceRow = rowFor(page, "schedule-link");
    await sourceRow.locator("button").click();
    await page.locator(".notification-center-detail").getByRole("button", { name: "원본으로 이동", exact: true }).click();
    await page.getByRole("heading", { name: "일정", exact: true }).waitFor();
    await page.getByText(`${runId}.schedule`, { exact: true }).first().waitFor();
    await page.screenshot({ path: resolve(evidenceDir, "source-navigation.png"), fullPage: false });

    result.checks.chrome = {
      popupToAllNotifications: true,
      filters: ["all", "unread", "read"],
      singleReadAndRecentSync: true,
      bulkRead: true,
      readAll: true,
      commonPopupDelete: true,
      nativeConfirmCount,
      states: ["loading", "empty", "error"],
      sourceNavigation: true,
      measurements,
    };
    await context.close();
  }, 120000);

  await step("db-audit", async () => {
    const db = await dbEvidence();
    const archiveIds = [state.notificationBySuffix["archive-a"], state.notificationBySuffix["archive-b"]];
    const archivedStates = db.states.filter(item => archiveIds.includes(item.notification_id));
    const archivedAuditTargets = new Set(db.audit.filter(item => item.event_type === "notification.archived").map(item => item.target_id));
    assert(db.notifications.length === state.notificationIds.length, "notification DB count mismatch");
    assert(db.states.some(item => item.status === "read"), "read state missing");
    assert(archivedStates.length === 2 && archivedStates.every(item => item.status === "archived" && item.archived_at), "soft-delete states or archived_at missing");
    assert(db.audit.some(item => item.event_type === "notification.read"), "read audit missing");
    assert(archiveIds.every(id => archivedAuditTargets.has(id)), "archive audit missing for a soft-deleted notification");
    assert(db.notifications.some(item => item.resource_type === "schedule" && item.resource_id === state.scheduleId), "source metadata missing");
    assert(db.protected.length === 3 && db.protected.every(item => item.status === "active"), "protected accounts changed");
    result.checks.dbAudit = { read: true, archived: 2, archivedAt: true, readAudit: true, archiveAuditTargets: 2, source: true, protectedAccountsActive: 3 };
    await writeFile(resolve(evidenceDir, "db-audit.json"), JSON.stringify(sanitize(db), null, 2));
  });

  await step("network", async () => {
    assert(network.length > 0, "no browser API requests captured");
    assert(network.every(item => item.url.startsWith(`${webBase}/api/v1/`)), "non same-origin browser API request");
    await writeFile(resolve(evidenceDir, "network.json"), JSON.stringify(sanitize(network), null, 2));
    await writeFile(resolve(evidenceDir, "console-errors.json"), JSON.stringify(sanitize(consoleErrors), null, 2));
    await writeFile(resolve(evidenceDir, "http-errors.json"), JSON.stringify(sanitize(httpErrors), null, 2));
    result.checks.network = { requestCount: network.length, sameOrigin: true, expectedErrorResponses: httpErrors.filter(item => item.status === 500).length };
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
      if (result.cleanup.errors.length) throw new Error(`cleanup integrity failed: ${result.cleanup.errors.join(", ")}`);
    } catch (cleanupError) {
      failure ??= cleanupError;
      result.status = "failed";
      result.cleanup = { ...(result.cleanup ?? {}), error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError) };
    }
  }
  result.finishedAt = new Date().toISOString();
  await writeFile(resolve(evidenceDir, "cleanup-result.json"), JSON.stringify(sanitize(result.cleanup), null, 2));
  await writeFile(resolve(evidenceDir, "result.json"), JSON.stringify(sanitize(result), null, 2));
  const security = await scanEvidence();
  result.checks.security = security;
  if (security.status !== "passed") {
    failure ??= new Error("evidence security scan failed");
    result.status = "failed";
  }
  await writeFile(resolve(evidenceDir, "security-scan.json"), JSON.stringify(sanitize(security), null, 2));
  await writeFile(resolve(evidenceDir, "result.json"), JSON.stringify(sanitize(result), null, 2));
  await record("complete", result.status === "passed" ? "OK" : "FAIL", { evidenceDir });
}

if (failure) throw failure;
console.log(JSON.stringify({ runId, status: result.status, evidenceDir }));
