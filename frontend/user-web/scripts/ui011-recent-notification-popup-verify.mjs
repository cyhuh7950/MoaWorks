import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isDeepStrictEqual, promisify } from "node:util";
import { chromium } from "playwright";

const execFileAsync = promisify(execFile);
const runId = process.argv[2] || `verify.ui011.${Date.now()}.${randomUUID().slice(0, 8)}`;
const adminPassword = process.env.MOAWORKS_TEST_PASSWORD;
if (!adminPassword) throw new Error("MOAWORKS_TEST_PASSWORD is required");
const verifyPassword = process.env.MOAWORKS_VERIFY_USER_PASSWORD || "Vfy!20260718";
const root = resolve(import.meta.dirname, "../../..");
const backend = resolve(root, "backend");
const backendPython = process.env.MOAWORKS_BACKEND_PYTHON || resolve(backend, ".venv/Scripts/python.exe");
const apiBase = "http://127.0.0.1:8510/api/v1";
const webBase = "http://127.0.0.1:3520";
const evidenceDir = resolve(root, "docs/evidence/ui011-recent-notification-popup", runId);
const progressPath = resolve(evidenceDir, "progress.jsonl");
await mkdir(evidenceDir, { recursive: true });

const state = { adminToken: "", adminUserId: "", observerToken: "", observerUserId: "", forbiddenToken: "", roleIds: [], userIds: [], notificationIds: [], notificationBySuffix: {}, preferenceAuditIds: [], scheduleIds: [], originalPreferences: null };
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

async function execDb(code) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const started = Date.now();
    try {
      const value = await execFileAsync(backendPython, ["-c", code], { cwd: backend, timeout: 12000, maxBuffer: 1024 * 1024 * 8 });
      await record("db-subprocess", "success", { attempt, elapsedMs: Date.now() - started });
      return value;
    } catch (error) {
      lastError = error;
      await record("db-subprocess", "retry", { attempt, elapsedMs: Date.now() - started, message: error instanceof Error ? error.message.split("\n")[0] : String(error) });
      if (attempt < 3) await new Promise(resolveDelay => setTimeout(resolveDelay, 500 * attempt));
    }
  }
  throw lastError;
}

async function request(path, options = {}) {
  const { timeoutMs = 10000, ...fetchOptions } = options;
  const method = fetchOptions.method ?? "GET";
  const attempts = method === "GET" ? 3 : 1;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${apiBase}${path}`, { ...fetchOptions, signal: AbortSignal.timeout(timeoutMs) });
      const body = await response.json().catch(() => ({}));
      return { status: response.status, body };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise(resolveDelay => setTimeout(resolveDelay, 500 * attempt));
    }
  }
  throw new Error(`${method} ${path}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
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
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await request("/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }), timeoutMs: 15000 });
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise(resolveDelay => setTimeout(resolveDelay, 500 * attempt));
    }
  }
  throw lastError;
}
async function emit(targetUserId, suffix, category = "system", resourceType = "notification", resourceId = `${runId}.${suffix}.resource`, targetUserIds = [targetUserId]) {
  const now = new Date().toISOString();
  const payload = {
    schemaVersion: "1.0",
    eventId: `${runId}.${suffix}.event`,
    eventType: `verify.ui011.${suffix}`,
    category,
    severity: suffix.includes("critical") ? "CRITICAL" : "INFO",
    resourceType,
    resourceId,
    requestId: `${runId}.${suffix}`,
    dedupKey: `${runId}.${suffix}`,
    title: `${runId} ${suffix}`,
    message: `UI-011 ${suffix} 검수 알림`,
    source: "ui011-harness",
    companyId: "moaworks.local",
    actorUserId: state.adminUserId,
    occurredAt: now,
    createdAt: now,
    payload: { runId, suffix },
    targets: targetUserIds,
    visibility: "user",
    links: {},
    delivery: {},
    auditing: { runId },
    targetAudience: "user",
  };
  let body;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      body = await ok("/internal/observability/events", { ...adminOptions("POST", payload), timeoutMs: 10000 });
      break;
    } catch (error) {
      lastError = error;
      await record("emit", "retry", { suffix, attempt, message: error instanceof Error ? error.message : String(error) });
      if (attempt < 3) await new Promise(resolveDelay => setTimeout(resolveDelay, 500 * attempt));
    }
  }
  if (!body) throw lastError;
  const notificationId = body.notificationId ?? `${runId}.${suffix}.event`;
  state.notificationIds.push(notificationId);
  state.notificationBySuffix[suffix] = notificationId;
  return body;
}

async function createAccessData() {
  const directory = await ok("/admin/directory", { ...adminOptions(), timeoutMs: 15000 });
  const department = directory.departments.find(item => item.status === "active");
  assert(department, "active department missing");
  const createRole = async (suffix, permissions) => {
    const name = `${runId}.${suffix}`;
    let role;
    let lastError;
    for (let attempt = 1; attempt <= 3 && !role; attempt += 1) {
      try {
        const response = await request("/admin/roles", { ...adminOptions("POST", { name, permissions }), timeoutMs: 15000 });
        if (response.status >= 200 && response.status < 300) role = response.body;
        else lastError = new Error(`role create ${response.status}`);
      } catch (error) {
        lastError = error;
      }
      if (!role) {
        try {
          const current = await ok("/admin/directory", { ...adminOptions(), timeoutMs: 15000 });
          role = current.roles.find(item => item.name === name && item.status !== "deleted");
        } catch (error) {
          lastError = error;
        }
      }
      if (!role && attempt < 3) await new Promise(resolveDelay => setTimeout(resolveDelay, 500 * attempt));
    }
    if (!role) throw lastError ?? new Error(`role create failed: ${name}`);
    state.roleIds.push(role.id);
    return role;
  };
  const forbiddenRole = await createRole("forbidden-role", ["messenger:read"]);
  const inactiveUserRole = await createRole("inactive-user-role", ["mail:read"]);
  const inactiveRole = await createRole("inactive-role", ["mail:read"]);
  const createUser = async (suffix, roleId, status) => {
    const name = `${runId}.${suffix}`;
    const loginId = `u6${Date.now().toString(36)}${suffix}`.toLowerCase();
    const payload = { name, loginId, password: verifyPassword, departmentId: department.id, roleId, status, userType: "user" };
    let user;
    let lastError;
    for (let attempt = 1; attempt <= 3 && !user; attempt += 1) {
      try {
        const response = await request("/admin/users", { ...adminOptions("POST", payload), timeoutMs: 15000 });
        if (response.status >= 200 && response.status < 300) user = response.body;
        else lastError = new Error(`user create ${response.status}`);
      } catch (error) {
        lastError = error;
      }
      if (!user) {
        try {
          const current = await ok("/admin/directory", { ...adminOptions(), timeoutMs: 15000 });
          const found = current.users.find(item => item.userName === name && item.status !== "deleted");
          if (found) user = found;
        } catch (error) {
          lastError = error;
        }
      }
      if (!user && attempt < 3) await new Promise(resolveDelay => setTimeout(resolveDelay, 500 * attempt));
    }
    if (!user) throw lastError ?? new Error(`user create failed: ${name}`);
    state.userIds.push(user.userId);
    if (status === "active") {
      let updated = false;
      for (let attempt = 1; attempt <= 2 && !updated; attempt += 1) {
        try {
          const response = await request(`/admin/users/${user.userId}`, { ...adminOptions("PATCH", { password: verifyPassword }), timeoutMs: 15000 });
          updated = response.status >= 200 && response.status < 300;
        } catch {}
      }
      assert(updated, `verification password update failed: ${name}`);
    }
    return { ...user, loginId };
  };
  const observerRole = await createRole("observer-role", ["mail:read"]);
  const forbidden = await createUser("forbidden", forbiddenRole.id, "active");
  const inactiveUser = await createUser("inactiveuser", inactiveUserRole.id, "inactive");
  const inactiveRoleUser = await createUser("inactiverole", inactiveRole.id, "active");
  const observer = await createUser("observer", observerRole.id, "active");
  let inactiveApplied = false;
  for (let attempt = 1; attempt <= 2 && !inactiveApplied; attempt += 1) {
    try {
      const response = await request(`/admin/roles/${inactiveRole.id}`, { ...adminOptions("PATCH", { status: "inactive" }), timeoutMs: 15000 });
      inactiveApplied = response.status >= 200 && response.status < 300;
    } catch {}
  }
  assert(inactiveApplied, "inactive role update failed");
  return { forbidden, inactiveUser, inactiveRoleUser, observer };
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
    "        cursor.execute(\"SELECT notification_id, resource_type, resource_id, recipient_user_ids, links, status FROM notifications WHERE notification_id = ANY(%s) ORDER BY created_at\", (notification_ids,))",
    "        notifications = cursor.fetchall()",
    "        cursor.execute(\"SELECT audit_id, actor_user_id, target_id, event_type, status, reason FROM notification_action_audit WHERE target_id = ANY(%s) OR payload->>'runId' = %s OR audit_id = ANY(%s) ORDER BY created_at\", (notification_ids, run_id, preference_audit_ids))",
    "        audit = cursor.fetchall()",
    "        cursor.execute(\"SELECT enabled, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, categories FROM notification_preferences WHERE user_id = %s\", (" + JSON.stringify(state.adminUserId) + ",))",
    "        preferences = cursor.fetchone()",
    "        cursor.execute(\"SELECT COUNT(*) AS count FROM users WHERE email IN ('admin@moaworks.local','cyhuh@moaworks.local','ysla@moaworks.local') AND status = 'active'\")",
    "        protected = cursor.fetchone()['count']",
    "print(json.dumps({'states': states, 'notifications': notifications, 'audit': audit, 'preferences': preferences, 'protectedAccountsActive': protected}, default=str))",
  ].join("\n");
  const { stdout } = await execDb(code);
  return JSON.parse(stdout.trim());
}

async function ownedRunData() {
  const code = [
    "import json",
    "from app.services.postgres_service import PostgresService",
    `run_id = ${JSON.stringify(runId)}`,
    "pattern = run_id + '.%'",
    "with PostgresService().connect() as connection:",
    "    with connection.cursor() as cursor:",
    "        cursor.execute(\"SELECT id, name, status FROM users WHERE name LIKE %s ORDER BY name\", (pattern,))",
    "        users = cursor.fetchall()",
    "        cursor.execute(\"SELECT id, name, status FROM roles WHERE name LIKE %s ORDER BY name\", (pattern,))",
    "        roles = cursor.fetchall()",
    "        cursor.execute(\"SELECT id, title, status FROM user_schedule_events WHERE title LIKE %s ORDER BY title\", (pattern,))",
    "        schedules = cursor.fetchall()",
    "        cursor.execute(\"SELECT notification_id, request_id, status FROM notifications WHERE request_id LIKE %s ORDER BY request_id\", (pattern,))",
    "        notifications = cursor.fetchall()",
    "        notification_ids = [row['notification_id'] for row in notifications]",
    "        cursor.execute(\"SELECT notification_id, user_id, status FROM notification_user_states WHERE notification_id = ANY(%s) ORDER BY notification_id, user_id\", (notification_ids,))",
    "        states = cursor.fetchall()",
    "        cursor.execute(\"SELECT audit_id, target_id, event_type, status, payload->>'runId' AS run_id FROM notification_action_audit WHERE target_id = ANY(%s) OR payload->>'runId' = %s ORDER BY created_at\", (notification_ids, run_id))",
    "        audit = cursor.fetchall()",
    "        cursor.execute(\"SELECT event_id, request_id FROM monitoring_events WHERE request_id LIKE %s ORDER BY request_id\", (pattern,))",
    "        events = cursor.fetchall()",
    "        cursor.execute(\"SELECT id, email, status FROM users WHERE email IN ('admin@moaworks.local','cyhuh@moaworks.local','ysla@moaworks.local') ORDER BY email\")",
    "        protected = cursor.fetchall()",
    "print(json.dumps({'users': users, 'roles': roles, 'schedules': schedules, 'notifications': notifications, 'states': states, 'audit': audit, 'events': events, 'protected': protected}, default=str))",
  ].join("\n");
  const { stdout } = await execDb(code);
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
  const { stdout } = await execDb(code);
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
  const apiCleanup = [];
  const firstSnapshot = await ownedRunData();
  await writeFile(resolve(evidenceDir, "cleanup-owned-before.json"), JSON.stringify(sanitize(firstSnapshot), null, 2));

  if (state.originalPreferences && state.adminToken) {
    const restoreError = await restorePreferences();
    if (restoreError) errors.push(restoreError);
  }

  const deleteBatch = async (pass, kind, ids, pathFor) => {
    const responses = await Promise.all(ids.map(async id => {
      const attempts = [];
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          const response = await request(pathFor(id), { ...adminOptions("DELETE"), timeoutMs: 5000 });
          attempts.push({ attempt, status: response.status });
          if ((response.status >= 200 && response.status < 300) || response.status === 404 || response.status === 409) break;
        } catch (error) {
          attempts.push({ attempt, status: 0, error: error instanceof Error ? error.message : String(error) });
        }
      }
      return { pass, kind, id, attempts };
    }));
    apiCleanup.push(...responses);
  };

  let after = firstSnapshot;
  for (let pass = 1; pass <= 3; pass += 1) {
    const owned = pass === 1 ? firstSnapshot : await ownedRunData();
    const scheduleIds = owned.schedules.filter(item => item.status !== "deleted").map(item => item.id);
    const userIds = owned.users.filter(item => item.status !== "deleted").map(item => item.id);
    const roleIds = owned.roles.filter(item => item.status !== "deleted").map(item => item.id);
    await deleteBatch(pass, "schedule", scheduleIds, id => `/workspace/schedules/${id}`);
    await deleteBatch(pass, "user", userIds, id => `/admin/users/${id}`);
    await deleteBatch(pass, "role", roleIds, id => `/admin/roles/${id}`);

    const notificationIds = owned.notifications.map(item => item.notification_id);
    const auditIds = [...new Set([...owned.audit.map(item => item.audit_id), ...state.preferenceAuditIds])];
    const eventIds = owned.events.map(item => item.event_id);
    const code = [
      "from app.services.postgres_service import PostgresService",
      `notification_ids = ${JSON.stringify(notificationIds)}`,
      `audit_ids = ${JSON.stringify(auditIds)}`,
      `event_ids = ${JSON.stringify(eventIds)}`,
      "with PostgresService().connect() as connection:",
      "    with connection.cursor() as cursor:",
      "        if notification_ids:",
      "            cursor.execute(\"DELETE FROM notification_user_states WHERE notification_id = ANY(%s)\", (notification_ids,))",
      "        if audit_ids:",
      "            cursor.execute(\"DELETE FROM notification_action_audit WHERE audit_id = ANY(%s)\", (audit_ids,))",
      "        if notification_ids:",
      "            cursor.execute(\"DELETE FROM notifications WHERE notification_id = ANY(%s)\", (notification_ids,))",
      "        if event_ids:",
      "            cursor.execute(\"DELETE FROM monitoring_events WHERE event_id = ANY(%s)\", (event_ids,))",
      "    connection.commit()",
      "print('cleanup=ok')",
    ].join("\n");
    await execDb(code);
    after = await ownedRunData();
    const remainingNow = [
      after.users.filter(item => item.status !== "deleted").length,
      after.roles.filter(item => item.status !== "deleted").length,
      after.schedules.filter(item => item.status !== "deleted").length,
      after.notifications.length,
      after.states.length,
      after.audit.length,
      after.events.length,
    ];
    if (remainingNow.every(count => count === 0)) break;
    await new Promise(resolveDelay => setTimeout(resolveDelay, 500));
  }

  await writeFile(resolve(evidenceDir, "cleanup-owned-after.json"), JSON.stringify(sanitize(after), null, 2));
  const remaining = {
    nonDeletedUsers: after.users.filter(item => item.status !== "deleted").length,
    nonDeletedRoles: after.roles.filter(item => item.status !== "deleted").length,
    activeSchedules: after.schedules.filter(item => item.status !== "deleted").length,
    notifications: after.notifications.length,
    states: after.states.length,
    testAudit: after.audit.length,
    events: after.events.length,
  };
  const protectedAccountsActive = after.protected.filter(item => item.status === "active").length;
  if (Object.values(remaining).some(count => count !== 0)) errors.push(`remaining:${JSON.stringify(remaining)}`);
  if (protectedAccountsActive !== 3) errors.push(`protected:${protectedAccountsActive}`);
  return {
    errors,
    apiCleanup,
    beforeCounts: {
      users: firstSnapshot.users.length,
      roles: firstSnapshot.roles.length,
      schedules: firstSnapshot.schedules.length,
      notifications: firstSnapshot.notifications.length,
      states: firstSnapshot.states.length,
      testAudit: firstSnapshot.audit.length,
      events: firstSnapshot.events.length,
    },
    remaining,
    protectedAccountsActive,
  };
}

async function scanEvidence() {
  const invalidJson = [];
  const sensitiveValueHits = [];
  const files = await readdir(evidenceDir, { withFileTypes: true });
  const sensitivePattern = /"(?:accessToken|refreshToken|token|password|authorization|cookie|secret)"\s*:\s*"(?!\[REDACTED\])[^"\r\n]+"|Bearer\s+(?!\[REDACTED\])[A-Za-z0-9._-]+/gi;
  for (const entry of files) {
    if (!entry.isFile() || !/\.(json|jsonl)$/.test(entry.name) || entry.name === "security-scan.json") continue;
    const path = resolve(evidenceDir, entry.name);
    const text = await readFile(path, "utf8");
    try {
      if (entry.name.endsWith(".jsonl")) {
        for (const line of text.split(/\r?\n/).filter(Boolean)) JSON.parse(line);
      } else {
        JSON.parse(text);
      }
    } catch (error) {
      invalidJson.push({ file: entry.name, error: error instanceof Error ? error.message : String(error) });
    }
    if (sensitivePattern.test(text)) sensitiveValueHits.push(entry.name);
    sensitivePattern.lastIndex = 0;
  }
  const nonSameOriginApiUrls = network.map(item => item.url).filter(url => !url.startsWith(`${webBase}/api/v1/`));
  return {
    runId,
    status: invalidJson.length === 0 && sensitiveValueHits.length === 0 && nonSameOriginApiUrls.length === 0 ? "passed" : "failed",
    invalidJson,
    sensitiveValueHits,
    apiRequestCount: network.length,
    nonSameOriginApiUrls,
  };
}

async function waitForNotificationFocus(page) {
  await page.waitForFunction(() => document.activeElement?.classList.contains("user-notification-entry"), null, { timeout: 3000 });
}

async function loginPage(page, loginId, password) {
  await page.goto(`${webBase}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.locator("input").first().fill(loginId);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: /로그인/i }).click();
}

let browser;
let failure;
try {
  await step("g0", async () => {
    for (const url of [`${apiBase}/health`, `${webBase}/api/v1/health`]) {
      let passed = false;
      let lastError = "no response";
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const started = Date.now();
        try {
          const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
          const body = await response.json();
          passed = response.status === 200 && body.initialized === true;
          lastError = passed ? "" : `status=${response.status}, initialized=${body.initialized}`;
          await record("g0-health", passed ? "success" : "retry", { url, attempt, elapsedMs: Date.now() - started, status: response.status, initialized: body.initialized });
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
          await record("g0-health", "retry", { url, attempt, elapsedMs: Date.now() - started, message: lastError });
        }
        if (passed) break;
      }
      assert(passed, `health failed: ${url}: ${lastError}`);
    }
    result.checks.g0 = "passed";
  }, 35000);

  const accessData = await step("prepare", async () => {
    const adminLogin = await login("admin@moaworks.local", adminPassword);
    assert(adminLogin.status === 200, `admin login ${adminLogin.status}`);
    state.adminToken = adminLogin.body.accessToken;
    state.adminUserId = adminLogin.body.user.userId;
    state.originalPreferences = await ok("/notifications/preferences", adminOptions());
    const access = await createAccessData();
    const observerLogin = await login(`${access.observer.loginId}@moaworks.local`, verifyPassword);
    assert(observerLogin.status === 200, `observer login ${observerLogin.status}`);
    state.observerToken = observerLogin.body.accessToken;
    state.observerUserId = observerLogin.body.user.userId;
    const startsAt = new Date(Date.now() + 3600000).toISOString();
    const endsAt = new Date(Date.now() + 7200000).toISOString();
    const schedulePayload = { title: `${runId}.schedule`, startsAt, endsAt, description: "UI-011 source navigation" };
    let schedule;
    let scheduleError;
    for (let attempt = 1; attempt <= 3 && !schedule; attempt += 1) {
      try {
        const response = await request("/workspace/schedules", { ...adminOptions("POST", schedulePayload), timeoutMs: 15000 });
        if (response.status >= 200 && response.status < 300) schedule = response.body;
        else scheduleError = new Error(`schedule create ${response.status}`);
      } catch (error) {
        scheduleError = error;
      }
      if (!schedule) {
        try {
          const current = await ok("/workspace/schedules", { ...adminOptions(), timeoutMs: 15000 });
          schedule = current.items?.find(item => item.title === schedulePayload.title && item.status !== "deleted");
        } catch (error) {
          scheduleError = error;
        }
      }
      if (!schedule && attempt < 3) await new Promise(resolveDelay => setTimeout(resolveDelay, 500 * attempt));
    }
    if (!schedule) throw scheduleError ?? new Error("schedule create failed");
    state.scheduleIds.push(schedule.id);
    await emit(state.adminUserId, "schedule-link", "schedule", "schedule", schedule.id);
    await emit(state.adminUserId, "read-all-a");
    await emit(state.adminUserId, "read-all-b");
    await emit(state.adminUserId, "archive");
    await emit(state.adminUserId, "shared", "system", "notification", `${runId}.shared.resource`, [state.adminUserId, state.observerUserId]);
    return access;
  }, 120000);

  if (process.env.MOAWORKS_UI011_FORCE_FAILURE_AFTER_PREPARE === "1") {
    throw new Error("UI-011 forced failure after prepare for cleanup verification");
  }

  await step("api-access", async () => {
    const noToken = await request("/notifications");
    assert(noToken.status === 401, `401 expected, got ${noToken.status}`);
    const forbiddenLogin = await login(`${accessData.forbidden.loginId}@moaworks.local`, verifyPassword);
    assert(forbiddenLogin.status === 200, `forbidden login ${forbiddenLogin.status}`);
    state.forbiddenToken = forbiddenLogin.body.accessToken;
    const forbiddenGet = await request(`/notifications/${state.notificationIds[0]}`, userOptions(state.forbiddenToken));
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

    const summaryBefore = await request("/notifications/summary", adminOptions());
    assert(summaryBefore.status === 200 && summaryBefore.body.unreadCount > 0, "server unread summary missing");
    const entry = page.locator(".user-notification-entry");
    await entry.waitFor();
    await page.waitForFunction(
      unreadCount => document.querySelector(".user-notification-entry")?.getAttribute("aria-label") === `알림, 미확인 ${unreadCount}건`,
      summaryBefore.body.unreadCount,
      { timeout: 10000 },
    );
    assert((await entry.getAttribute("aria-label")) === `알림, 미확인 ${summaryBefore.body.unreadCount}건`, "badge/server unread mismatch");
    assert((await entry.getAttribute("aria-expanded")) === "false", "notification entry initial state mismatch");

    await entry.click();
    const recentDialog = page.getByRole("dialog", { name: "최근 알림" });
    await recentDialog.waitFor();
    assert((await entry.getAttribute("aria-expanded")) === "true", "notification overlay expanded state missing");
    assert((await recentDialog.getAttribute("aria-labelledby")) === "recent-notification-title", "overlay accessible name link missing");
    const recentRows = recentDialog.locator(".user-notification-row");
    await recentRows.nth(4).waitFor({ timeout: 10000 });
    assert(await recentRows.count() === 5, "recent notification limit mismatch");
    const recentApi = await request("/notifications?limit=50&unreadOnly=false", adminOptions());
    assert(recentApi.status === 200 && recentApi.body.notifications.length >= 5, "recent API source missing");
    const visibleTitles = await recentRows.locator("strong").allTextContents();
    const visibleTimes = visibleTitles.map(title => recentApi.body.notifications.find(item => item.title === title)?.occurredAt);
    assert(visibleTimes.every(Boolean), "recent UI/API item mismatch");
    assert(visibleTimes.every((value, index) => index === 0 || new Date(visibleTimes[index - 1]).getTime() >= new Date(value).getTime()), "recent latest-order mismatch");
    const occurred = await recentRows.locator("small").allTextContents();
    assert(occurred.length === 5, "recent notification timestamps missing");
    await page.screenshot({ path: resolve(evidenceDir, "recent-overlay-open.png"), fullPage: false });
    await record("chrome-overlay-open", "success", { unreadCount: summaryBefore.body.unreadCount, visibleRows: 5 });

    await entry.click();
    await recentDialog.waitFor({ state: "hidden" });
    await waitForNotificationFocus(page);
    await entry.click();
    await recentDialog.waitFor();
    await page.keyboard.press("Escape");
    await recentDialog.waitFor({ state: "hidden" });
    await waitForNotificationFocus(page);
    await entry.click();
    await recentDialog.waitFor();
    await page.getByRole("button", { name: "알림 바깥 영역 닫기" }).click({ position: { x: 5, y: 5 } });
    await recentDialog.waitFor({ state: "hidden" });
    await waitForNotificationFocus(page);
    await record("chrome-overlay-close", "success", { methods: ["icon", "escape", "outside"] });

    await entry.click();
    await recentDialog.waitFor();
    const sourceRow = recentDialog.getByRole("button").filter({ hasText: `${runId} schedule-link` });
    await sourceRow.waitFor();
    await sourceRow.click();
    await page.getByRole("heading", { name: "일정", exact: true }).waitFor();
    await page.getByText(`${runId}.schedule`, { exact: true }).first().waitFor();
    const sourceState = await request(`/notifications/${state.notificationBySuffix["schedule-link"]}`, adminOptions());
    assert(sourceState.status === 200 && sourceState.body.status === "read", "source notification read state mismatch");
    const summaryAfterSource = await request("/notifications/summary", adminOptions());
    assert(summaryAfterSource.status === 200 && summaryAfterSource.body.unreadCount === summaryBefore.body.unreadCount - 1, "single-read badge decrement mismatch");
    await page.screenshot({ path: resolve(evidenceDir, "notification-source-read.png"), fullPage: false });
    await record("chrome-source-navigation", "success");

    await entry.click();
    await recentDialog.waitFor();
    let releaseReadAll;
    let markReadAllIntercepted;
    const readAllRelease = new Promise(resolveRelease => { releaseReadAll = resolveRelease; });
    const readAllIntercepted = new Promise(resolveIntercepted => { markReadAllIntercepted = resolveIntercepted; });
    const readAllPattern = "**/api/v1/notifications/read-all";
    await page.route(readAllPattern, async route => {
      markReadAllIntercepted();
      await readAllRelease;
      await route.continue();
    });
    await recentDialog.getByRole("button", { name: "모두 읽음", exact: true }).click();
    await Promise.race([
      readAllIntercepted,
      new Promise((_, reject) => setTimeout(() => reject(new Error("read-all intercept timeout")), 10000)),
    ]);
    await recentDialog.getByText("알림을 처리하는 중입니다.", { exact: true }).waitFor({ timeout: 5000 });
    releaseReadAll();

    await page.waitForFunction(() => document.querySelector(".user-notification-entry")?.getAttribute("aria-label") === "알림, 미확인 0건", null, { timeout: 10000 });
    assert(await entry.locator("span").count() === 0, "zero unread badge must be hidden");
    const readAllSummary = await request("/notifications/summary", adminOptions());
    assert(readAllSummary.status === 200 && readAllSummary.body.unreadCount === 0, "read-all summary mismatch");
    await page.screenshot({ path: resolve(evidenceDir, "recent-overlay-read-all.png"), fullPage: false });
    await record("chrome-read-all", "success");

    const overlayMeasurements = await page.evaluate(() => {
      const panel = document.querySelector(".user-notification-panel");
      const list = document.querySelector(".user-notification-panel-list");
      return {
        viewport: { width: innerWidth, height: innerHeight },
        page: { clientHeight: document.documentElement.clientHeight, scrollHeight: document.documentElement.scrollHeight, pageHasScroll: document.documentElement.scrollHeight > document.documentElement.clientHeight },
        panel: panel ? { top: panel.getBoundingClientRect().top, right: innerWidth - panel.getBoundingClientRect().right, bottom: innerHeight - panel.getBoundingClientRect().bottom } : null,
        list: list ? { clientHeight: list.clientHeight, scrollHeight: list.scrollHeight, overflowY: getComputedStyle(list).overflowY } : null,
      };
    });
    assert(overlayMeasurements.viewport.width === 1920 && overlayMeasurements.viewport.height === 1080, "viewport mismatch");
    assert(overlayMeasurements.page.pageHasScroll === false, "whole page scroll detected");
    assert(overlayMeasurements.panel && overlayMeasurements.panel.top >= 0 && overlayMeasurements.panel.right >= 0 && overlayMeasurements.panel.bottom >= 0, "overlay clipped outside viewport");
    assert(["auto", "scroll"].includes(overlayMeasurements.list?.overflowY), "overlay internal scroll contract missing");
    await writeFile(resolve(evidenceDir, "measurements.json"), JSON.stringify(overlayMeasurements, null, 2));

    await recentDialog.getByRole("button", { name: "전체 알림 보기", exact: true }).click();
    await page.getByRole("heading", { name: "전체 알림" }).waitFor();
    await recentDialog.waitFor({ state: "hidden" });
    await page.screenshot({ path: resolve(evidenceDir, "all-notifications-navigation.png"), fullPage: false });
    await record("chrome-all-notifications", "success");

    await page.getByRole("button", { name: "홈", exact: true }).click();
    await page.getByRole("button", { name: "로그아웃", exact: true }).click();
    await page.getByRole("button", { name: /로그인/i }).waitFor();
    assert(await page.locator(".user-notification-panel").count() === 0, "overlay remained after logout");
    result.checks.chrome = {
      badgeMatchesServer: true,
      recentLimit: 5,
      closeAndFocus: ["icon", "escape", "outside"],
      sourceNavigationAndRead: true,
      readAllConsistency: true,
      zeroBadgeHidden: true,
      allNotificationsNavigation: true,
      overlayRemovedAfterLogout: true,
      measurements: overlayMeasurements,
    };
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
    const emptyEntry = forbidden.getByRole("button", { name: /알림, 미확인 0건/ });
    await emptyEntry.click();
    const emptyDialog = forbidden.getByRole("dialog", { name: "최근 알림" });
    await emptyDialog.waitFor();
    await emptyDialog.getByText("최근 알림이 없습니다.", { exact: true }).waitFor({ timeout: 10000 });
    await emptyDialog.getByRole("button", { name: "알림 닫기" }).click();
    await record("chrome-loading-empty", "success", { loading: "read-all", empty: true });
    const forbiddenNotification = await emit(accessData.forbidden.userId, "forbidden-mail", "mail", "mail");
    let forbiddenVisible = false;
    for (let attempt = 1; attempt <= 10 && !forbiddenVisible; attempt += 1) {
      const current = await request("/notifications?limit=50&unreadOnly=false", userOptions(state.forbiddenToken));
      forbiddenVisible = current.status === 200 && current.body.notifications.some(item =>
        item.notificationId === forbiddenNotification.notificationId || item.title === `${runId} forbidden-mail`,
      );
      if (!forbiddenVisible) await new Promise(resolveDelay => setTimeout(resolveDelay, 500));
    }
    assert(forbiddenVisible, "forbidden notification API visibility missing");
    await forbidden.reload({ waitUntil: "domcontentloaded" });
    await forbidden.locator(".user-app-rail-menu").waitFor({ timeout: 15000 });
    await forbidden.waitForFunction(() => !document.querySelector(".user-notification-entry")?.getAttribute("aria-label")?.includes("미확인 0건"), null, { timeout: 15000 });
    await forbidden.getByRole("button", { name: /알림, 미확인 \d+건/ }).click();
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

  await step("contract-consistency", async () => {
    const sharedId = state.notificationBySuffix.shared;
    const scheduleId = state.notificationBySuffix["schedule-link"];
    const observerBefore = await request(`/notifications/${sharedId}`, userOptions(state.observerToken));
    assert(observerBefore.status === 200 && observerBefore.body.status === "unread", "observer unread state missing");
    const adminRepeatRead = await request("/notifications/bulk/read", adminOptions("POST", { notificationIds: [scheduleId] }));
    assert(adminRepeatRead.status === 200 && adminRepeatRead.body.updatedCount === 0, "read idempotency failed");
    const archiveOnce = await request("/notifications/bulk/archive", adminOptions("POST", { notificationIds: [sharedId] }));
    const archiveTwice = await request("/notifications/bulk/archive", adminOptions("POST", { notificationIds: [sharedId] }));
    assert(archiveOnce.status === 200 && archiveOnce.body.updatedCount === 1, "archive first update failed");
    assert(archiveTwice.status === 200 && archiveTwice.body.updatedCount === 0, "archive idempotency failed");
    const observerAfter = await request(`/notifications/${sharedId}`, userOptions(state.observerToken));
    assert(observerAfter.status === 200 && observerAfter.body.status === "unread", "recipient state isolation failed");
    const adminSummary = await request("/notifications/summary", adminOptions());
    assert(adminSummary.status === 200 && adminSummary.body.unreadCount === 0, "summary/read-all mismatch");
    const future = encodeURIComponent(new Date(Date.now() + 86400000).toISOString());
    const periodEmpty = await request(`/notifications?fromAt=${future}`, adminOptions());
    assert(periodEmpty.status === 200 && periodEmpty.body.notifications.length === 0, "period filter failed");
    const pageTwo = await request("/notifications?limit=2", userOptions(state.observerToken));
    assert(pageTwo.status === 200 && pageTwo.body.notifications.length <= 2, "pagination limit failed");
    const source = await request(`/notifications/${scheduleId}`, adminOptions());
    assert(source.status === 200 && source.body.resourceType === "schedule" && source.body.resourceId === state.scheduleIds[0], "source metadata mismatch");
    result.checks.contract = {
      userStateIsolation: true,
      readIdempotent: [0],
      archiveIdempotent: [1, 0],
      readAllUnreadCount: 0,
      periodFilter: true,
      pagination: true,
      sourceNavigation: true,
    };
  });

  await step("db-audit", async () => {
    const db = await dbEvidence();
    assert(db.states.some(item => item.status === "read"), "read state missing");
    assert(db.states.some(item => item.status === "archived"), "archived state missing");
    assert(db.notifications.some(item => item.resource_type === "schedule" && item.resource_id === state.scheduleIds[0]), "source DB metadata missing");
    assert(!db.states.some(item => item.user_id === state.observerUserId), "observer state must remain independent/unread");
    assert(db.audit.some(item => item.event_type === "notification.read"), "read audit missing");
    assert(db.audit.some(item => item.event_type === "notification.archived"), "archive audit missing");
    assert(db.protectedAccountsActive === 3, "protected accounts changed");
    result.checks.dbAudit = db;
    await writeFile(resolve(evidenceDir, "db-audit.json"), JSON.stringify(sanitize(db), null, 2));
  }, 45000);

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
      result.cleanup = await step("cleanup", cleanup, 120000);
      if (result.cleanup.errors.length > 0) {
        const cleanupError = new Error(`cleanup integrity failed: ${result.cleanup.errors.join(", ")}`);
        failure ??= cleanupError;
        result.status = "failed";
      }
    } catch (cleanupError) {
      result.cleanup = { ...(result.cleanup ?? {}), error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError) };
      failure ??= cleanupError;
      result.status = "failed";
    }
  }
  result.finishedAt = new Date().toISOString();
  await writeFile(resolve(evidenceDir, "cleanup-result.json"), JSON.stringify(sanitize(result.cleanup), null, 2));
  await writeFile(resolve(evidenceDir, "result.json"), JSON.stringify(sanitize(result), null, 2));
  const security = await scanEvidence();
  result.checks.security = security;
  if (security.status !== "passed") {
    const securityError = new Error("evidence security scan failed");
    failure ??= securityError;
    result.status = "failed";
  }
  await writeFile(resolve(evidenceDir, "security-scan.json"), JSON.stringify(sanitize(security), null, 2));
  await writeFile(resolve(evidenceDir, "result.json"), JSON.stringify(sanitize(result), null, 2));
  await record("complete", result.status);
}
if (failure) throw failure;
console.log(JSON.stringify({ runId, status: result.status, evidenceDir }));
