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
const runId = `verify.phase6.approval.${Date.now()}.${randomUUID().slice(0, 8)}`;
const loginPrefix = `vfyapproval${Date.now().toString(36)}${randomUUID().slice(0, 4)}`.toLowerCase();
const evidence = resolve(root, "docs/evidence/phase6-user-approval", runId);
const state = { adminToken: "", userIds: [], roleIds: [], documentIds: [] };

await mkdir(evidence, { recursive: true });

async function request(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, options);
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

function safe(response) {
  return { status: response.status, code: response.body?.code ?? null, userMessage: response.body?.userMessage ?? null };
}

async function requireStatus(path, expected, options = {}) {
  const response = await request(path, options);
  if (response.status !== expected) throw new Error(`${path}: expected ${expected}, received ${response.status}/${response.body?.code ?? ""}`);
  return response.body;
}

function adminOptions(method = "GET", body) {
  return {
    method,
    headers: { authorization: `Bearer ${state.adminToken}`, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
}

async function login(loginId, expected = 200) {
  const response = await request("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `${loginId}@moaworks.local`, password }),
  });
  if (response.status !== expected) throw new Error(`login ${loginId}: ${response.status}/${response.body?.code ?? ""}`);
  return response.body;
}

async function dbSummary() {
  const code = [
    "import json",
    "from app.services.postgres_service import PostgresService",
    `run_id = ${JSON.stringify(runId)}`,
    `email_prefix = ${JSON.stringify(`${loginPrefix}%@moaworks.local`)}`,
    "with PostgresService().connect() as connection:",
    "    with connection.cursor() as cursor:",
    "        cursor.execute(\"SELECT status, COUNT(*) AS count FROM approval_documents WHERE title LIKE %s GROUP BY status ORDER BY status\", (run_id + '%',))",
    "        documents = cursor.fetchall()",
    "        cursor.execute(\"SELECT event, COUNT(*) AS count FROM audit_logs WHERE target_type = 'approval_document' AND target_id IN (SELECT id FROM approval_documents WHERE title LIKE %s) GROUP BY event ORDER BY event\", (run_id + '%',))",
    "        audit = cursor.fetchall()",
    "        cursor.execute(\"SELECT status, COUNT(*) AS count FROM users WHERE email LIKE %s GROUP BY status ORDER BY status\", (email_prefix,))",
    "        users = cursor.fetchall()",
    "        cursor.execute(\"SELECT status, COUNT(*) AS count FROM roles WHERE name LIKE %s GROUP BY status ORDER BY status\", (run_id + '.%',))",
    "        roles = cursor.fetchall()",
    "        cursor.execute(\"SELECT COUNT(*) AS count FROM users WHERE email IN ('admin@moaworks.local', 'cyhuh@moaworks.local', 'ysla@moaworks.local') AND status = 'active'\")",
    "        protected = cursor.fetchone()['count']",
    "print(json.dumps({'documents': documents, 'audit': audit, 'users': users, 'roles': roles, 'protectedAccountsActive': protected}))",
  ].join("\n");
  const { stdout } = await execFileAsync("uv", ["run", "python", "-c", code], { cwd: backend });
  return JSON.parse(stdout.trim());
}

async function cleanup() {
  if (!state.adminToken) return null;
  const errors = [];
  for (const id of state.userIds) {
    const response = await request(`/admin/users/${id}`, adminOptions("DELETE"));
    if (response.status < 200 || response.status >= 300) errors.push(`user:${response.status}`);
  }
  for (const id of state.roleIds) {
    const response = await request(`/admin/roles/${id}`, adminOptions("DELETE"));
    if (response.status < 200 || response.status >= 300) errors.push(`role:${response.status}`);
  }
  const code = [
    "import json",
    "from app.services.postgres_service import PostgresService",
    `run_id = ${JSON.stringify(runId)}`,
    "with PostgresService().connect() as connection:",
    "    with connection.cursor() as cursor:",
    "        cursor.execute(\"DELETE FROM approval_documents WHERE title LIKE %s RETURNING id\", (run_id + '%',))",
    "        removed = [row['id'] for row in cursor.fetchall()]",
    "    connection.commit()",
    "print(json.dumps({'deletedDocumentIds': removed}))",
  ].join("\n");
  const { stdout } = await execFileAsync("uv", ["run", "python", "-c", code], { cwd: backend });
  const deletedDocuments = JSON.parse(stdout.trim());
  const summary = await dbSummary();
  const usersDeleted = summary.users.length === 1 && summary.users[0].status === "deleted" && summary.users[0].count === state.userIds.length;
  const rolesDeleted = summary.roles.length === 1 && summary.roles[0].status === "deleted" && summary.roles[0].count === state.roleIds.length;
  if (errors.length || !usersDeleted || !rolesDeleted || summary.protectedAccountsActive !== 3) {
    throw new Error(`CLEANUP_FAILED:${JSON.stringify({ errors, summary })}`);
  }
  return { deletedDocuments, summary };
}

async function createVerificationData() {
  const admin = await requireStatus("/auth/login", 200, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "admin@moaworks.local", password: "m@68150183" }) });
  state.adminToken = admin.accessToken;
  const directory = await requireStatus("/admin/directory", 200, adminOptions());
  const department = directory.departments.find((item) => item.status === "active");
  if (!department) throw new Error("ACTIVE_DEPARTMENT_NOT_FOUND");
  const createRole = async (suffix, permissions) => {
    const role = await requireStatus("/admin/roles", 200, adminOptions("POST", { name: `${runId}.${suffix}`, permissions }));
    state.roleIds.push(role.id);
    return role;
  };
  const creatorRole = await createRole("creator", ["approval:read", "approval:create", "approval:submit", "approval:withdraw", "approval:rework"]);
  const approverRole = await createRole("approver", ["approval:read", "approval:act"]);
  const forbiddenRole = await createRole("forbidden", ["mail:read"]);
  const inactiveRole = await createRole("inactive-role", ["approval:read"]);
  const createUser = async (suffix, roleId, status = "active") => {
    const loginId = `${loginPrefix}${suffix}`;
    const user = await requireStatus("/admin/users", 200, adminOptions("POST", { name: `${runId}.${suffix}`, loginId, password, departmentId: department.id, roleId, status, userType: "user" }));
    state.userIds.push(user.userId);
    return { ...user, loginId };
  };
  const creator = await createUser("creator", creatorRole.id);
  const approver = await createUser("approver", approverRole.id);
  const approverTwo = await createUser("approvertwo", approverRole.id);
  const forbidden = await createUser("forbidden", forbiddenRole.id);
  const inactiveUser = await createUser("inactiveuser", creatorRole.id, "inactive");
  const inactiveRoleUser = await createUser("inactiverole", inactiveRole.id);
  for (const user of [creator, approver, approverTwo, forbidden]) await requireStatus(`/admin/users/${user.userId}`, 200, adminOptions("PATCH", { password }));
  await requireStatus(`/admin/roles/${inactiveRole.id}`, 200, adminOptions("PATCH", { status: "inactive" }));
  return { creator, approver, approverTwo, forbidden, inactiveUser, inactiveRoleUser };
}

async function apiAccessChecks(data) {
  const unauthenticated = await request("/approvals");
  if (unauthenticated.status !== 401) throw new Error(`401 expected, got ${unauthenticated.status}`);
  const forbiddenLogin = await login(data.forbidden.loginId);
  const forbidden = await request("/approvals", { headers: { authorization: `Bearer ${forbiddenLogin.accessToken}` } });
  if (forbidden.status !== 403) throw new Error(`403 expected, got ${forbidden.status}`);
  const inactiveUser = await request("/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `${data.inactiveUser.loginId}@moaworks.local`, password }) });
  const inactiveRole = await request("/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `${data.inactiveRoleUser.loginId}@moaworks.local`, password }) });
  if (inactiveUser.status !== 423 || inactiveRole.status !== 423) throw new Error(`423 expected: ${inactiveUser.status}/${inactiveRole.status}`);
  return { unauthenticated: safe(unauthenticated), forbidden: safe(forbidden), inactiveUser: safe(inactiveUser), inactiveRole: safe(inactiveRole) };
}

async function browserLogin(page, loginId, expectAuthenticated = true) {
  await page.goto(`${webBase}/`, { waitUntil: "networkidle" });
  await page.locator("input").first().fill(loginId);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: /로그인/i }).click();
  if (expectAuthenticated) {
    await page.getByRole("button", { name: "로그아웃", exact: true }).waitFor({ timeout: 10000 });
  }
}

async function openApproval(page) {
  await page.getByText("결재", { exact: true }).first().click();
  await page.getByRole("button", { name: "새 결재 작성", exact: true }).waitFor();
}

async function createAndSubmit(page, approverName, suffix, edit = false, secondApproverName = "") {
  const title = `${runId}.${suffix}`;
  await page.getByRole("button", { name: "새 결재 작성", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /결재 create 팝업/ });
  await dialog.getByLabel("결재 제목").fill(title);
  await dialog.getByLabel("결재 본문").fill(`${title} 본문`);
  await dialog.getByLabel("결재선 사용자 검색").fill(approverName);
  await dialog.getByText(approverName, { exact: false }).first().click();
  if (secondApproverName) {
    await dialog.getByLabel("결재선 사용자 검색").fill(secondApproverName);
    await dialog.getByText(secondApproverName, { exact: false }).first().click();
    const selectedLines = dialog.getByLabel("선택된 결재선");
    await selectedLines.getByRole("button", { name: "위", exact: true }).last().click();
    await selectedLines.getByRole("button", { name: "제거", exact: true }).last().click();
  }
  await dialog.getByRole("button", { name: "초안 저장", exact: true }).click();
  await page.getByText(title, { exact: true }).first().waitFor();
  await page.getByText(title, { exact: true }).first().click();
  if (edit) {
    await page.getByRole("button", { name: "수정", exact: true }).click();
    const editDialog = page.getByRole("dialog", { name: /결재 edit 팝업/ });
    await editDialog.getByLabel("결재 제목").fill(`${title}.수정`);
    await editDialog.getByRole("button", { name: "수정 저장", exact: true }).click();
    await page.getByText(`${title}.수정`, { exact: true }).first().click();
    return `${title}.수정`;
  }
  return title;
}

async function selectDocument(page, title) {
  const item = page.getByText(title, { exact: true }).first();
  await item.waitFor();
  await item.click();
}

async function confirmAction(page, trigger, action, reason = "") {
  await page.getByLabel("결재 상세").getByRole("button", { name: trigger, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: new RegExp(`결재 ${action} 팝업`) });
  if (reason) await dialog.getByLabel("처리 의견").fill(reason);
  await dialog.getByRole("button", { name: action === "approve" ? "승인" : action === "reject" ? "반려" : "확인", exact: true }).click();
  try {
    await dialog.waitFor({ state: "detached", timeout: 10000 });
  } catch (error) {
    const dialogText = await dialog.innerText();
    await page.screenshot({ path: resolve(evidence, `action-failure-${action}.png`), fullPage: false });
    throw new Error(`ACTION_NOT_CLOSED:${action}:${dialogText}`);
  }
  await page.waitForTimeout(600);
}

async function verifyApprovalUi(data) {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const creatorNetwork = [];
  const approverNetwork = [];
  try {
    const creator = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    creator.on("request", (request) => { if (request.url().includes("/api/v1/")) creatorNetwork.push(request.url().replace(/token=[^&]*/i, "token=[REDACTED]")); });
    await browserLogin(creator, data.creator.loginId);
    await openApproval(creator);
    const approvedTitle = await createAndSubmit(creator, `${runId}.approver`, "approved", true, `${runId}.approvertwo`);
    await selectDocument(creator, approvedTitle);
    await confirmAction(creator, "상신", "submit");
    await creator.getByLabel("결재 상세").getByText("submitted", { exact: true }).waitFor();
    const rejectedTitle = await createAndSubmit(creator, `${runId}.approver`, "rejected", false, `${runId}.approvertwo`);
    await selectDocument(creator, rejectedTitle);
    await confirmAction(creator, "상신", "submit");
    await creator.screenshot({ path: resolve(evidence, "creator-submitted.png"), fullPage: false });
    await creator.close();

    const approver = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    approver.on("request", (request) => { if (request.url().includes("/api/v1/")) approverNetwork.push(request.url().replace(/token=[^&]*/i, "token=[REDACTED]")); });
    await browserLogin(approver, data.approverTwo.loginId);
    await openApproval(approver);
    await selectDocument(approver, approvedTitle);
    await confirmAction(approver, "승인", "approve", "검수 승인");
    await selectDocument(approver, rejectedTitle);
    await confirmAction(approver, "반려", "reject", "검수 반려");
    await approver.screenshot({ path: resolve(evidence, "approver-actions.png"), fullPage: false });
    await approver.close();

    const creatorAfter = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    creatorAfter.on("request", (request) => { if (request.url().includes("/api/v1/")) creatorNetwork.push(request.url().replace(/token=[^&]*/i, "token=[REDACTED]")); });
    await browserLogin(creatorAfter, data.creator.loginId);
    await openApproval(creatorAfter);
    await selectDocument(creatorAfter, rejectedTitle);
    await confirmAction(creatorAfter, "재기안", "redraft");
    await confirmAction(creatorAfter, "상신", "submit");
    await confirmAction(creatorAfter, "회수", "withdraw");
    const measurements = await creatorAfter.evaluate(() => ({ scrollHeight: document.documentElement.scrollHeight, clientHeight: document.documentElement.clientHeight, pageHasScroll: document.documentElement.scrollHeight > document.documentElement.clientHeight }));
    if (measurements.pageHasScroll) throw new Error(`PAGE_SCROLL:${JSON.stringify(measurements)}`);
    await creatorAfter.screenshot({ path: resolve(evidence, "creator-redraft-withdraw.png"), fullPage: false });
    await creatorAfter.close();

    const allNetwork = [...creatorNetwork, ...approverNetwork];
    if (allNetwork.some((url) => !url.startsWith(`${webBase}/api/v1/`))) throw new Error(`NON_SAME_ORIGIN:${allNetwork.find((url) => !url.startsWith(`${webBase}/api/v1/`))}`);
    return { approvedTitle, rejectedTitle, measurements, network: allNetwork };
  } finally { await browser.close(); }
}

async function verifyBlockedScreens(data) {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const checks = {};
    for (const [key, loginId, expected] of [["401", "missing", "로그인"], ["403", data.forbidden.loginId, "요청한 기능을 수행할 권한이 없습니다."], ["423user", data.inactiveUser.loginId, "비활성화된 사용자 계정입니다."], ["423role", data.inactiveRoleUser.loginId, "사용자의 권한 역할이 비활성화되어 로그인할 수 없습니다."]]) {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      if (key === "401") {
        await page.goto(`${webBase}/`, { waitUntil: "networkidle" });
        await page.locator("input").first().fill(loginId);
        await page.locator('input[type="password"]').fill("wrong-password");
        await page.getByRole("button", { name: /로그인/i }).click();
      } else {
        await browserLogin(page, loginId, key === "403");
        if (key === "403") await page.getByText("결재", { exact: true }).first().click();
      }
      await page.getByText(expected, { exact: false }).waitFor({ timeout: 10000 });
      await page.screenshot({ path: resolve(evidence, `blocked-${key}.png`), fullPage: false });
      checks[key] = expected;
      await page.close();
    }
    return checks;
  } finally { await browser.close(); }
}

const result = { runId, api: null, ui: null, blockedScreens: null, dbBeforeCleanup: null, cleanup: null };
let failure = null;
try {
  const data = await createVerificationData();
  result.api = await apiAccessChecks(data);
  result.ui = await verifyApprovalUi(data);
  result.blockedScreens = await verifyBlockedScreens(data);
  result.dbBeforeCleanup = await dbSummary();
  const events = new Set((result.dbBeforeCleanup.audit ?? []).map((row) => row.event));
  for (const event of ["approval.created", "approval.updated", "approval.submitted", "approval.approved", "approval.rejected", "approval.redrafted", "approval.withdrawn"]) {
    if (!events.has(event)) throw new Error(`AUDIT_MISSING:${event}`);
  }
} catch (error) {
  failure = error;
} finally {
  try { result.cleanup = await cleanup(); } catch (cleanupError) { if (!failure) failure = cleanupError; else failure = new Error(`${failure.message}; ${cleanupError.message}`); }
  await writeFile(resolve(evidence, "result.json"), JSON.stringify(result, null, 2));
}
if (failure) throw failure;
console.log(JSON.stringify({ runId, evidence, cleanup: "completed" }));
