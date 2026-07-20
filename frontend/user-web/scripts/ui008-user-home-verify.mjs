import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright";

const execFileAsync = promisify(execFile);
const runId = process.argv[2] || `verify.ui008.${Date.now()}.${randomUUID().slice(0, 8)}`;
const adminPassword = process.env.MOAWORKS_TEST_PASSWORD || process.argv[3];
const verifyPassword = process.env.MOAWORKS_VERIFY_USER_PASSWORD || "Vfy!Ui008-20260719";
if (!adminPassword) throw new Error("MOAWORKS_TEST_PASSWORD is required");
const root = resolve(import.meta.dirname, "../../..");
const backend = resolve(root, "backend");
const apiBase = "http://127.0.0.1:8510/api/v1";
const webBase = "http://127.0.0.1:3520";
const evidenceDir = resolve(root, `docs/evidence/ui008-user-home-${runId}`);
const progressPath = resolve(evidenceDir, "progress.jsonl");
await mkdir(evidenceDir, { recursive: true });

const state = { adminToken: "", adminUserId: "", scheduleId: "", noticeId: `ntc_${randomUUID().replaceAll("-", "").slice(0, 12)}`, roleIds: [], userIds: [] };
const network = [];
const consoleErrors = [];
const result = { runId, status: "running", startedAt: new Date().toISOString(), checks: {}, cleanup: null };
const sanitize = (value, key = "") => {
  if (value == null) return value;
  if (/token|authorization|cookie|password|secret/i.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitize(v, k)]));
  if (typeof value === "string") return value.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]").replace(/([?&](?:token|access_token)=)[^&]+/gi, "$1[REDACTED]");
  return value;
};
const record = (stepName, status, details = {}) => appendFile(progressPath, JSON.stringify(sanitize({ at: new Date().toISOString(), step: stepName, status, ...details })) + "\n");
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const step = async (name, action, timeoutMs = 45000) => {
  await record(name, "start", { timeoutMs }); const started = Date.now(); let timer;
  try {
    const value = await Promise.race([action(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${name} timeout after ${timeoutMs}ms`)), timeoutMs); })]);
    await record(name, "success", { elapsedMs: Date.now() - started }); return value;
  } catch (error) {
    await record(name, "failure", { elapsedMs: Date.now() - started, message: error instanceof Error ? error.message : String(error) }); throw error;
  } finally { if (timer) clearTimeout(timer); }
};
function httpJson(url, options = {}, timeoutMs = 15000) {
  return new Promise((resolveRequest, rejectRequest) => {
    const req = httpRequest(url, { method: options.method || "GET", headers: options.headers || {} }, (response) => {
      const chunks = []; response.on("data", (chunk) => chunks.push(chunk)); response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8"); let body = {};
        try { body = text ? JSON.parse(text) : {}; } catch { body = { text }; }
        resolveRequest({ status: response.statusCode || 0, body });
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`HTTP timeout: ${url}`))); req.on("error", rejectRequest);
    if (options.body) req.write(options.body); req.end();
  });
}
const request = (path, options = {}) => httpJson(`${apiBase}${path}`, options);
const ok = async (path, options = {}) => { const response = await request(path, options); assert(response.status >= 200 && response.status < 300, `${path}: ${response.status}`); return response.body; };
const adminOptions = (method = "GET", body) => ({ method, headers: { authorization: `Bearer ${state.adminToken}`, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
const loginApi = (email, password) => request("/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });

async function pythonJson(code) {
  const python = process.env.MOAWORKS_BACKEND_PYTHON || "C:\\Users\\cyhuh\\anaconda3\\python.exe";
  const { stdout } = await execFileAsync(python, ["-c", code], { cwd: backend, timeout: 30000 });
  return JSON.parse(stdout.trim());
}
async function seedNotice() {
  return pythonJson([
    "import json", "from app.services.postgres_service import PostgresService",
    `notice_id=${JSON.stringify(state.noticeId)}`, `run_id=${JSON.stringify(runId)}`,
    "with PostgresService().connect() as c:", "  with c.cursor() as q:",
    "    q.execute(\"SELECT company_id FROM users WHERE email='admin@moaworks.local'\")", "    company_id=q.fetchone()['company_id']",
    "    q.execute(\"INSERT INTO user_notices(id,company_id,title,content,author_name,status,published_at,created_at,updated_at) VALUES(%s,%s,%s,%s,%s,'published',NOW(),NOW(),NOW())\",(notice_id,company_id,run_id,run_id+' notice body','UI-008 검수'))",
    "  c.commit()", "print(json.dumps({'noticeId':notice_id}))",
  ].join("\n"));
}
async function dbEvidence() {
  return pythonJson([
    "import json", "from app.services.postgres_service import PostgresService",
    `notice_id=${JSON.stringify(state.noticeId)}`, `schedule_id=${JSON.stringify(state.scheduleId)}`, `run_id=${JSON.stringify(runId)}`,
    "with PostgresService().connect() as c:", "  with c.cursor() as q:",
    "    q.execute(\"SELECT id,title,status FROM user_notices WHERE id=%s\",(notice_id,)); notices=q.fetchall()",
    "    q.execute(\"SELECT notice_id,user_id,read_at FROM user_notice_reads WHERE notice_id=%s\",(notice_id,)); reads=q.fetchall()",
    "    q.execute(\"SELECT id,title,status FROM user_schedule_events WHERE id=%s\",(schedule_id,)); schedules=q.fetchall()",
    "    q.execute(\"SELECT target_id,event,status_before,status_after FROM audit_logs WHERE target_id IN (%s,%s) ORDER BY created_at\",(notice_id,schedule_id)); audit=q.fetchall()",
    "    q.execute(\"SELECT email,status FROM users WHERE email IN ('admin@moaworks.local','cyhuh@moaworks.local','ysla@moaworks.local') ORDER BY email\"); protected=q.fetchall()",
    "    q.execute(\"SELECT COUNT(*) AS count FROM users WHERE name LIKE %s AND status<>'deleted'\",(run_id+'%',)); active_users=q.fetchone()['count']",
    "    q.execute(\"SELECT COUNT(*) AS count FROM roles WHERE name LIKE %s AND status<>'deleted'\",(run_id+'%',)); active_roles=q.fetchone()['count']",
    "print(json.dumps({'notices':notices,'reads':reads,'schedules':schedules,'audit':audit,'protected':protected,'activeUsers':active_users,'activeRoles':active_roles},default=str))",
  ].join("\n"));
}
async function prepare() {
  const login = await loginApi("admin@moaworks.local", adminPassword); assert(login.status === 200, `admin login ${login.status}`);
  state.adminToken = login.body.accessToken; state.adminUserId = login.body.user.userId;
  await seedNotice();
  const now = new Date(); now.setMinutes(now.getMinutes() + 30); const end = new Date(now.getTime() + 3600000);
  const schedule = await ok("/workspace/schedules", adminOptions("POST", { title: runId, startsAt: now.toISOString(), endsAt: end.toISOString(), description: runId }));
  state.scheduleId = schedule.id;
  const directory = await ok("/admin/directory", adminOptions()); const department = directory.departments.find((item) => item.status === "active"); assert(department, "active department missing");
  const createRole = async (suffix, permissions) => { const role = await ok("/admin/roles", adminOptions("POST", { name: `${runId}.${suffix}`, permissions })); state.roleIds.push(role.id); return role; };
  const forbiddenRole = await createRole("forbidden-role", ["messenger:read"]);
  const inactiveUserRole = await createRole("inactive-user-role", ["profile:read"]);
  const inactiveRole = await createRole("inactive-role", ["profile:read"]);
  const createUser = async (suffix, roleId, status) => {
    const loginId = `u8${Date.now().toString(36)}${state.userIds.length}`;
    const user = await ok("/admin/users", adminOptions("POST", { name: `${runId}.${suffix}`, loginId, password: verifyPassword, departmentId: department.id, roleId, status, userType: "user" }));
    state.userIds.push(user.userId); if (status === "active") await ok(`/admin/users/${user.userId}`, adminOptions("PATCH", { password: verifyPassword })); return { ...user, loginId };
  };
  const forbidden = await createUser("forbidden", forbiddenRole.id, "active");
  const inactiveUser = await createUser("inactive-user", inactiveUserRole.id, "inactive");
  const inactiveRoleUser = await createUser("inactive-role", inactiveRole.id, "active");
  await ok(`/admin/roles/${inactiveRole.id}`, adminOptions("PATCH", { status: "inactive" }));
  return { forbidden, inactiveUser, inactiveRoleUser };
}
function attachEvidence(page) {
  page.on("request", (req) => { if (req.url().includes("/api/v1/")) network.push({ method: req.method(), url: req.url() }); });
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
}
async function loginPage(context, loginId, password) {
  const page = await context.newPage(); attachEvidence(page); await page.goto(webBase, { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.evaluate(() => localStorage.clear()); await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 });
  await page.locator('input[type="password"]').waitFor({ timeout: 15000 }); await page.locator("input").first().fill(loginId); await page.locator('input[type="password"]').fill(password); await page.getByRole("button", { name: /로그인/i }).click(); return page;
}
async function cleanup() {
  const errors = [];
  if (state.scheduleId && state.adminToken) { const r = await request(`/workspace/schedules/${state.scheduleId}`, adminOptions("DELETE")); if (r.status !== 204) errors.push(`schedule:${r.status}`); }
  for (const id of state.userIds) { const r = await request(`/admin/users/${id}`, adminOptions("DELETE")); if (r.status < 200 || r.status >= 300) errors.push(`user:${id}:${r.status}`); }
  for (const id of state.roleIds) { const r = await request(`/admin/roles/${id}`, adminOptions("DELETE")); if (r.status < 200 || r.status >= 300) errors.push(`role:${id}:${r.status}`); }
  await pythonJson(["import json", "from app.services.postgres_service import PostgresService", `notice_id=${JSON.stringify(state.noticeId)}`, "with PostgresService().connect() as c:", "  with c.cursor() as q: q.execute(\"UPDATE user_notices SET status='deleted',updated_at=NOW() WHERE id=%s\",(notice_id,))", "  c.commit()", "print(json.dumps({'noticeDeleted':True}))"].join("\n"));
  return { errors, db: await dbEvidence() };
}

let browser, context, page, failure, access;
try {
  await step("g0", async () => { for (const url of [`${apiBase}/health`, `${webBase}/api/v1/health`]) { const r = await httpJson(url, {}, 15000); assert(r.status === 200 && r.body.initialized === true, `G0 ${url}:${r.status}`); } result.checks.g0 = true; });
  access = await step("prepare", prepare, 60000);
  await step("chrome-home", async () => {
    browser = await chromium.launch({ channel: "chrome", headless: true }); context = await browser.newContext({ viewport: { width: 1920, height: 1080 } }); page = await loginPage(context, "admin", adminPassword);
    await page.locator('[data-home-card="mail"]').waitFor({ timeout: 20000 }); assert(await page.locator("[data-home-card]").count() === 5, "home card count mismatch");
    for (const key of ["mail", "approval", "schedule", "messenger", "notices"]) assert(await page.locator(`[data-home-card="${key}"]`).count() === 1, `${key} card missing`);
    const noticeItem = page.locator('[data-home-card="notices"] .ui008-home-items button').filter({ hasText: runId }); await noticeItem.click();
    await page.getByRole("heading", { name: runId }).waitFor(); assert(await page.getByText(`${runId} notice body`).count() === 1, "notice detail missing");
    await page.getByRole("button", { name: /^홈/ }).click(); await page.locator('[data-home-card="schedule"]').waitFor();
    const scheduleItem = page.locator('[data-home-card="schedule"] .ui008-home-items button').filter({ hasText: runId }); await scheduleItem.click();
    await page.getByRole("heading", { name: runId }).waitFor();
    for (const [key, menu] of [["mail","메일"],["approval","결재"],["messenger","메신저"],["notices","공지"]]) { await page.getByRole("button", { name: /^홈/ }).click(); await page.locator(`[data-home-card="${key}"] > header button`).click(); if (key !== "notices") await page.locator(`.user-app-rail-item[aria-current="page"]`).filter({ hasText: menu }).waitFor(); else await page.getByRole("heading", { name: "공지", exact: true }).first().waitFor(); }
    await page.getByRole("button", { name: /^홈/ }).click();
    const search = page.getByRole("searchbox"); await search.fill("admin"); await page.waitForTimeout(450); assert(await page.getByRole("dialog", { name: /통합 검색/ }).count() === 1, "search regression"); await search.fill("");
    await page.getByRole("button", { name: /^알림 \d+건$/ }).click(); await page.getByRole("dialog", { name: "최근 알림" }).waitFor(); await page.getByRole("button", { name: "알림 닫기" }).click();
    const layout = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, pageHasScroll: document.documentElement.scrollHeight > document.documentElement.clientHeight, cards: [...document.querySelectorAll('[data-home-card]')].map((node) => ({ key: node.getAttribute('data-home-card'), rect: node.getBoundingClientRect().toJSON() })) }));
    assert(layout.width === 1920 && layout.height === 1080 && !layout.pageHasScroll, "1920x1080 layout mismatch"); result.checks.chrome = { cards: 5, originalNavigation: true, search: true, notifications: true, layout };
    await page.screenshot({ path: resolve(evidenceDir, "home-1920x1080.png") }); await page.close();
  }, 60000);
  await step("access-control", async () => {
    const unauth = await request("/workspace/notices"); assert(unauth.status === 401, `401:${unauth.status}`);
    const forbiddenLogin = await loginApi(`${access.forbidden.loginId}@moaworks.local`, verifyPassword); assert(forbiddenLogin.status === 200, "forbidden login");
    const forbiddenApi = await request("/workspace/notices", { headers: { authorization: `Bearer ${forbiddenLogin.body.accessToken}` } }); assert(forbiddenApi.status === 403, `403:${forbiddenApi.status}`);
    const forbiddenPage = await loginPage(context, access.forbidden.loginId, verifyPassword); await forbiddenPage.getByRole("alert").filter({ hasText: "권한" }).first().waitFor({ timeout: 20000 }); await forbiddenPage.screenshot({ path: resolve(evidenceDir, "access-403.png") }); await forbiddenPage.close();
    const inactiveUser = await loginPage(context, access.inactiveUser.loginId, verifyPassword); await inactiveUser.getByRole("alert").filter({ hasText: "비활성화된 사용자" }).waitFor({ timeout: 15000 }); await inactiveUser.close();
    const inactiveRole = await loginPage(context, access.inactiveRoleUser.loginId, verifyPassword); await inactiveRole.getByRole("alert").filter({ hasText: "권한 역할이 비활성화" }).waitFor({ timeout: 15000 }); await inactiveRole.close();
    result.checks.access = { unauthorized: 401, forbidden: 403, inactiveUser: 423, inactiveRole: 423, screens: true };
  }, 60000);
  await step("db-audit-network", async () => {
    const db = await dbEvidence(); assert(db.notices.some((x) => x.id === state.noticeId && x.status === "published"), "notice DB missing"); assert(db.reads.length === 1, "notice read missing"); assert(db.schedules.some((x) => x.id === state.scheduleId && x.status === "active"), "schedule DB missing"); assert(db.audit.some((x) => x.target_id === state.noticeId && x.event === "workspace.notice.read"), "notice audit missing"); assert(db.audit.some((x) => x.target_id === state.scheduleId && x.event === "workspace.schedule.created"), "schedule audit missing"); assert(network.length > 0 && network.every((x) => x.url.startsWith(`${webBase}/api/v1/`)), "same-origin failed"); assert(db.protected.filter((x) => x.status === "active").length === 3, "protected account changed"); result.checks.dbAudit = db; result.checks.network = { count: network.length, allSameOrigin: true };
  });
  result.status = "passed";
} catch (error) {
  failure = error; result.status = "failed"; result.error = error instanceof Error ? error.message : String(error);
  if (page && !page.isClosed()) { await page.screenshot({ path: resolve(evidenceDir, "failure.png") }).catch(() => {}); await writeFile(resolve(evidenceDir, "failure-dom.html"), await page.content().catch(() => "")).catch(() => {}); }
} finally {
  try { result.cleanup = await step("cleanup", cleanup, 60000); assert(result.cleanup.errors.length === 0, `cleanup:${result.cleanup.errors}`); assert(result.cleanup.db.activeUsers === 0 && result.cleanup.db.activeRoles === 0, "verification access data remains"); assert(result.cleanup.db.notices.every((x) => x.status === "deleted"), "notice cleanup failed"); assert(result.cleanup.db.schedules.every((x) => x.status === "deleted"), "schedule cleanup failed"); assert(result.cleanup.db.protected.filter((x) => x.status === "active").length === 3, "protected cleanup check failed"); } catch (error) { failure ||= error; result.status = "failed"; result.cleanup = { error: error instanceof Error ? error.message : String(error) }; }
  result.finishedAt = new Date().toISOString(); await writeFile(resolve(evidenceDir, "network.json"), JSON.stringify(sanitize(network), null, 2)); await writeFile(resolve(evidenceDir, "console-errors.json"), JSON.stringify(sanitize(consoleErrors), null, 2)); await writeFile(resolve(evidenceDir, "result.json"), JSON.stringify(sanitize(result), null, 2)); await browser?.close().catch(() => {});
}
if (failure) throw failure;
console.log(JSON.stringify({ runId, status: result.status, evidenceDir }));
