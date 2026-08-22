import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "../../..");
const backend = resolve(root, "backend");
const apiBase = "http://127.0.0.1:8514/api/v1";
const webBase = "http://127.0.0.1:3520";
const password = "Vfy!20260713";
const runId = `verify.phase5.access.${Date.now()}.${randomUUID().slice(0, 8)}`;
const loginPrefix = `vfy${Date.now().toString(36)}${randomUUID().slice(0, 4)}`.toLowerCase();
const evidence = resolve(root, "docs/evidence/phase5-mail-access", runId);
const state = { adminToken: "", userIds: [], roleIds: [] };

await mkdir(evidence, { recursive: true });

async function request(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, options);
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function requireOk(path, options = {}) {
  const response = await request(path, options);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${path}:${response.status}/${response.body?.code ?? "REQUEST_FAILED"}`);
  }
  return response.body;
}

function adminOptions(method = "GET", body) {
  return {
    method,
    headers: { authorization: `Bearer ${state.adminToken}`, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
}

async function dbSummary() {
  const code = [
    "import json",
    "from app.services.postgres_service import PostgresService",
    `role_prefix = ${JSON.stringify(`${runId}.%`)}`,
    `email_prefix = ${JSON.stringify(`${loginPrefix}%@moaworks.local`)}`,
    "with PostgresService().connect() as connection:",
    "    with connection.cursor() as cursor:",
    "        cursor.execute(\"SELECT status, COUNT(*) AS count FROM users WHERE email LIKE %s GROUP BY status ORDER BY status\", (email_prefix,))",
    "        users = cursor.fetchall()",
    "        cursor.execute(\"SELECT status, COUNT(*) AS count FROM roles WHERE name LIKE %s GROUP BY status ORDER BY status\", (role_prefix,))",
    "        roles = cursor.fetchall()",
    "        cursor.execute(\"SELECT COUNT(*) AS count FROM users WHERE email IN ('admin@moaworks.local', 'cyhuh@moaworks.local', 'ysla@moaworks.local') AND status = 'active'\")",
    "        protected = cursor.fetchone()['count']",
    "print(json.dumps({'users': users, 'roles': roles, 'protectedAccountsActive': protected}))",
  ].join("\n");
  const { stdout } = await execFileAsync("uv", ["run", "python", "-c", code], { cwd: backend });
  return JSON.parse(stdout.trim());
}

async function createData() {
  const admin = await requireOk("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin@moaworks.local", password: "m@68150183" }),
  });
  state.adminToken = admin.accessToken;
  const current = await requireOk("/admin/directory", adminOptions());
  const department = current.departments.find((item) => item.status === "active");
  if (!department) throw new Error("ACTIVE_DEPARTMENT_NOT_FOUND");
  const createRole = async (suffix, permissions) => {
    const role = await requireOk("/admin/roles", adminOptions("POST", { name: `${runId}.${suffix}`, permissions }));
    state.roleIds.push(role.id);
    return role;
  };
  const forbiddenRole = await createRole("forbidden", ["messenger:read"]);
  const allowedRole = await createRole("allowed", ["mail:read"]);
  const inactiveRole = await createRole("inactive-role", ["mail:read"]);
  const createUser = async (suffix, roleId, status) => {
    const loginId = `${loginPrefix}${suffix}`;
    const user = await requireOk("/admin/users", adminOptions("POST", {
      name: `${runId}.${suffix}`, loginId, password, departmentId: department.id, roleId, status, userType: "user",
    }));
    state.userIds.push(user.userId);
    return { ...user, loginId };
  };
  const forbiddenUser = await createUser("403", forbiddenRole.id, "active");
  await requireOk(`/admin/users/${forbiddenUser.userId}`, adminOptions("PATCH", { password }));
  const inactiveUser = await createUser("user423", allowedRole.id, "inactive");
  const inactiveRoleUser = await createUser("role423", inactiveRole.id, "active");
  await requireOk(`/admin/roles/${inactiveRole.id}`, adminOptions("PATCH", { status: "inactive" }));
  return { forbiddenRole, allowedRole, inactiveRole, forbiddenUser, inactiveUser, inactiveRoleUser };
}

async function assertPreconditions(data) {
  const current = await requireOk("/admin/directory", adminOptions());
  const byUser = (id) => current.users.find((item) => item.userId === id);
  const byRole = (id) => current.roles.find((item) => item.id === id);
  const forbiddenUser = byUser(data.forbiddenUser.userId);
  const inactiveUser = byUser(data.inactiveUser.userId);
  const inactiveRoleUser = byUser(data.inactiveRoleUser.userId);
  const forbiddenRole = byRole(data.forbiddenRole.id);
  const allowedRole = byRole(data.allowedRole.id);
  const inactiveRole = byRole(data.inactiveRole.id);
  const checks = {
    forbidden: Boolean(forbiddenUser && forbiddenRole && forbiddenUser.status === "active" && forbiddenUser.mailAccountStatus === "active" && forbiddenRole.status === "active" && !forbiddenRole.permissions.includes("mail:read") && !forbiddenUser.mustChangePassword),
    inactiveUser: Boolean(inactiveUser && allowedRole && inactiveUser.status === "inactive" && allowedRole.status === "active"),
    inactiveRole: Boolean(inactiveRoleUser && inactiveRole && inactiveRoleUser.status === "active" && inactiveRole.status === "inactive"),
  };
  if (Object.values(checks).some((value) => !value)) throw new Error(`PRECONDITION_FAILED:${JSON.stringify(checks)}`);
  return checks;
}

async function cleanup() {
  const errors = [];
  for (const id of state.userIds) {
    const response = await request(`/admin/users/${id}`, adminOptions("DELETE"));
    if (response.status < 200 || response.status >= 300) errors.push(`user:${response.status}`);
  }
  for (const id of state.roleIds) {
    const response = await request(`/admin/roles/${id}`, adminOptions("DELETE"));
    if (response.status < 200 || response.status >= 300) errors.push(`role:${response.status}`);
  }
  const summary = await dbSummary();
  const usersDeleted = summary.users.length === 1 && summary.users[0].status === "deleted" && summary.users[0].count === state.userIds.length;
  const rolesDeleted = summary.roles.length === 1 && summary.roles[0].status === "deleted" && summary.roles[0].count === state.roleIds.length;
  if (errors.length || !usersDeleted || !rolesDeleted || summary.protectedAccountsActive !== 3) {
    throw new Error(`CLEANUP_FAILED:${JSON.stringify({ errors, summary })}`);
  }
  return summary;
}

function safeResponse(response) {
  return {
    status: response.status,
    code: response.body?.code ?? null,
    userMessage: response.body?.userMessage ?? null,
  };
}

async function apiLogin(loginId) {
  const response = await fetch(`${apiBase}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `${loginId}@moaworks.local`, password }),
  });
  const body = await response.json();
  return { status: response.status, body };
}

async function assertApi(loginId, expectedStatus, expectedCode) {
  const login = await apiLogin(loginId);
  if (expectedStatus === 403) {
    if (login.status !== 200) throw new Error(`${loginId}: 로그인 ${login.status}`);
    const inbox = await fetch(`${apiBase}/mail/inbox`, {
      headers: { authorization: `Bearer ${login.body.accessToken}` },
    });
    const body = await inbox.json();
    if (inbox.status !== 403 || body.code !== expectedCode) {
      throw new Error(`${loginId}: 메일 차단 ${inbox.status}/${body.code}`);
    }
    return { login: { status: login.status }, mail: safeResponse({ status: inbox.status, body }) };
  }
  if (login.status !== expectedStatus || login.body.code !== expectedCode) {
    throw new Error(`${loginId}: 로그인 차단 ${login.status}/${login.body.code}`);
  }
  return { login: safeResponse(login) };
}

async function fillAndLogin(page, loginId) {
  await page.goto(`${webBase}/`, { waitUntil: "networkidle" });
  await page.locator("input").first().fill(loginId);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: /로그인/i }).click();
}

async function verifyScreen(browser, loginId, expectedText, filename, openMail) {
  const network = [];
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on("request", (request) => {
    if (!request.url().includes("/api/v1/")) return;
    network.push(request.url().replace(/token=[^&]*/i, "token=[REDACTED]"));
  });
  await fillAndLogin(page, loginId);
  if (openMail) {
    await page.waitForSelector('button:has-text("메일")');
    await page.getByRole("button", { name: /메일.*건 확인/ }).click();
  }
  await page.getByText(expectedText, { exact: false }).waitFor({ timeout: 10000 });
  const bodyText = await page.locator("body").innerText();
  if (!bodyText.includes(expectedText)) throw new Error(`${loginId}: 화면 문구 미노출`);
  const measurements = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
    pageHasScroll: document.documentElement.scrollHeight > document.documentElement.clientHeight,
  }));
  if (measurements.pageHasScroll) throw new Error(`${loginId}: 전체 페이지 스크롤`);
  if (network.some((url) => !url.startsWith(`${webBase}/api/v1/`))) {
    throw new Error(`${loginId}: same-origin API 위반`);
  }
  await page.screenshot({ path: resolve(evidence, filename), fullPage: false });
  await page.close();
  return { measurements, network };
}

const result = { runId, preconditions: null, api: null, screens: null, dbBefore: null, dbAfter: null, cleanup: "pending" };
let failure = null;
try {
  const data = await createData();
  result.preconditions = await assertPreconditions(data);
  result.dbBefore = await dbSummary();
  result.api = {
    forbidden: await assertApi(data.forbiddenUser.loginId, 403, "FORBIDDEN"),
    inactiveUser: await assertApi(data.inactiveUser.loginId, 423, "AUTH_ACCOUNT_LOCKED"),
    inactiveRole: await assertApi(data.inactiveRoleUser.loginId, 423, "AUTH_ACCOUNT_LOCKED"),
  };
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    result.screens = {
      forbidden: await verifyScreen(browser, data.forbiddenUser.loginId, "요청한 기능을 수행할 권한이 없습니다.", "forbidden-403.png", true),
      inactiveUser: await verifyScreen(browser, data.inactiveUser.loginId, "비활성화된 사용자 계정입니다.", "inactive-user-423.png", false),
      inactiveRole: await verifyScreen(browser, data.inactiveRoleUser.loginId, "사용자의 권한 역할이 비활성화되어 로그인할 수 없습니다.", "inactive-role-423.png", false),
    };
  } finally {
    await browser.close();
  }
} catch (error) {
  failure = error;
} finally {
  if (state.adminToken) {
    result.dbAfter = await cleanup();
    result.cleanup = "deleted";
  }
  await writeFile(resolve(evidence, "result.json"), JSON.stringify(result, null, 2));
}
if (failure) throw failure;
console.log(JSON.stringify({ runId, cleanup: result.cleanup }));
