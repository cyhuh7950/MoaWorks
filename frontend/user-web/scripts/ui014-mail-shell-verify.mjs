import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright";

const execFileAsync = promisify(execFile);
const runId = process.argv[2] || `verify.ui014.${Date.now()}.${randomUUID().slice(0, 8)}`;
const adminPassword = process.env.MOAWORKS_TEST_PASSWORD;
const root = resolve(import.meta.dirname, "../../..");
const backend = resolve(root, "backend");
const backendPython = process.env.MOAWORKS_BACKEND_PYTHON || resolve(backend, ".venv/Scripts/python.exe");
const apiBase = (process.env.MOAWORKS_API_BASE || "http://127.0.0.1:8510/api/v1").replace(/\/$/, "");
const webBase = (process.env.MOAWORKS_WEB_BASE || "http://127.0.0.1:3520").replace(/\/$/, "");
const evidenceDir = resolve(root, "docs/evidence/ui014-mail-shell", runId);
const progressPath = resolve(evidenceDir, "progress.jsonl");
await mkdir(evidenceDir, { recursive: true });

const state = { adminToken: "", adminUserId: "", companyId: "", userEmail: "" };
const network = [];
const consoleErrors = [];
const httpErrors = [];
const result = { runId, status: "running", startedAt: new Date().toISOString(), checks: {} };

const sanitize = (value, key = "") => {
  if (value == null) return value;
  if (/token|authorization|cookie|password|secret/i.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, sanitize(entryValue, entryKey)]));
  if (typeof value === "string") return value
    .replace(/Bearer\s+[A-Za-z0-9._=-]+/gi, "Bearer [REDACTED]")
    .replace(/([?&](?:token|access_token)=)[^&]+/gi, "$1[REDACTED]");
  return value;
};
const record = (stage, status, detail = {}) => appendFile(progressPath, `${JSON.stringify(sanitize({ timestamp: new Date().toISOString(), runId, stage, status, summary: detail.summary ?? "", evidence: detail.evidence ?? "" }))}\n`);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
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
    await record(stage, "FAIL", { summary: error instanceof Error ? error.message : String(error) });
    throw error;
  }
};

async function request(path, options = {}) {
  const { timeoutMs = 10000, ...fetchOptions } = options;
  const response = await fetch(`${apiBase}${path}`, { ...fetchOptions, signal: AbortSignal.timeout(timeoutMs) });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}
const adminOptions = () => ({ headers: { authorization: `Bearer ${state.adminToken}` } });
async function login(email, password) {
  return request("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
    timeoutMs: 15000,
  });
}
async function execDb(code) {
  const { stdout } = await execFileAsync(backendPython, ["-c", code], { cwd: backend, timeout: 30000, maxBuffer: 1024 * 1024 * 4 });
  return stdout.trim();
}
async function dbStorageEvidence() {
  const code = [
    "import json",
    "from app.services.postgres_service import PostgresService",
    `company_id = ${JSON.stringify(state.companyId)}`,
    `user_id = ${JSON.stringify(state.adminUserId)}`,
    `user_email = ${JSON.stringify(state.userEmail.toLowerCase())}`,
    "with PostgresService().connect() as connection:",
    "    with connection.cursor() as cursor:",
    "        cursor.execute(\"\"\"WITH accessible_messages AS (SELECT DISTINCT m.id, m.subject, m.body_text, m.body_html FROM mail_messages m LEFT JOIN mail_recipients r ON r.message_id = m.id WHERE m.company_id = %s AND (m.sender_user_id = %s OR r.recipient_user_id = %s OR LOWER(r.recipient_email) = %s)), message_sizes AS (SELECT am.id, OCTET_LENGTH(COALESCE(am.subject, '')) + OCTET_LENGTH(COALESCE(am.body_text, '')) + OCTET_LENGTH(COALESCE(am.body_html, '')) + COALESCE(SUM(a.size_bytes), 0) AS used_bytes FROM accessible_messages am LEFT JOIN mail_attachments a ON a.message_id = am.id GROUP BY am.id, am.subject, am.body_text, am.body_html), usage AS (SELECT COALESCE(SUM(used_bytes), 0)::BIGINT AS used_bytes FROM message_sizes) SELECT ma.quota_mb, usage.used_bytes FROM mail_accounts ma JOIN users u ON u.id = ma.user_id CROSS JOIN usage WHERE ma.user_id = %s AND u.company_id = %s AND ma.status = 'active'\"\"\", (company_id, user_id, user_id, user_email, user_id, company_id))",
    "        row = cursor.fetchone()",
    "        cursor.execute(\"EXPLAIN (FORMAT JSON) WITH accessible_messages AS (SELECT DISTINCT m.id, m.subject, m.body_text, m.body_html FROM mail_messages m LEFT JOIN mail_recipients r ON r.message_id = m.id WHERE m.company_id = %s AND (m.sender_user_id = %s OR r.recipient_user_id = %s OR LOWER(r.recipient_email) = %s)) SELECT COUNT(*) FROM accessible_messages\", (company_id, user_id, user_id, user_email))",
    "        plan = cursor.fetchone()['QUERY PLAN']",
    "used_bytes = max(0, int(row['used_bytes'] or 0))",
    "quota_bytes = max(0, int(row['quota_mb'] or 0) * 1024 * 1024)",
    "usage_percent = round((used_bytes / quota_bytes) * 100, 2) if quota_bytes else 0.0",
    "print(json.dumps({'usedBytes': used_bytes, 'quotaBytes': quota_bytes, 'usagePercent': usage_percent, 'selectOnly': True, 'plan': plan}, default=str))",
  ].join("\n");
  return JSON.parse(await execDb(code));
}
async function forbiddenToken() {
  const code = [
    "import json",
    "from app.services.directory_store import DirectoryStore",
    "from app.services.postgres_service import PostgresService",
    "from app.services.token_service import TokenService",
    "with PostgresService().connect() as connection:",
    "    with connection.cursor() as cursor:",
    "        cursor.execute(\"SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE u.status = 'active' AND r.status = 'active' AND NOT ((r.permissions ? 'admin:*') OR (r.permissions ? 'mail:read')) ORDER BY u.created_at LIMIT 1\")",
    "        row = cursor.fetchone()",
    "if row is None:",
    "    print(json.dumps({'available': False}))",
    "else:",
    "    user = DirectoryStore().get_user_summary(row['id'])",
    "    print(json.dumps({'available': True, 'accessToken': TokenService().issue_access_token(user)}))",
  ].join("\n");
  return JSON.parse(await execDb(code));
}
async function verificationToken() {
  const code = [
    "import json",
    "from app.services.directory_store import DirectoryStore",
    "from app.services.postgres_service import PostgresService",
    "from app.services.token_service import TokenService",
    "with PostgresService().connect() as connection:",
    "    with connection.cursor() as cursor:",
    "        cursor.execute(\"SELECT id FROM users WHERE LOWER(email) = 'admin@moaworks.local' AND status = 'active'\")",
    "        row = cursor.fetchone()",
    "if row is None:",
    "    raise RuntimeError('active verification admin missing')",
    "user = DirectoryStore().get_user_summary(row['id'])",
    "print(json.dumps({'accessToken': TokenService().issue_access_token(user), 'userId': user.userId, 'companyId': user.companyId, 'userEmail': user.userEmail}))",
  ].join("\n");
  return JSON.parse(await execDb(code));
}
async function scanEvidence() {
  const invalidJson = [];
  const sensitiveValueHits = [];
  const sensitivePattern = /"(?:accessToken|refreshToken|token|password|authorization|cookie|secret)"\s*:\s*"(?!\[REDACTED\])[^"\r\n]+"|Bearer\s+(?!\[REDACTED\])[A-Za-z0-9._=-]+/gi;
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
  const nonSameOriginApiUrls = network.map((item) => item.url).filter((url) => !url.startsWith(`${webBase}/api/v1/`));
  return { status: invalidJson.length || sensitiveValueHits.length || nonSameOriginApiUrls.length ? "failed" : "passed", invalidJson, sensitiveValueHits, apiRequestCount: network.length, nonSameOriginApiUrls };
}

let browser;
let failure;
let apiStorage;
await step("g0-runtime", async () => {
  for (const url of [`${apiBase}/health`, `${webBase}/api/v1/health`]) {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const body = await response.json();
    assert(response.status === 200 && body.initialized === true, `health failed: ${url}`);
  }
  result.checks.health = { api: 200, userWebProxy: 200 };
});
await step("access-control-unauth", async () => {
  assert((await request("/mail/storage")).status === 401, "unauthenticated storage request was not 401");
  result.checks.unauthenticated = 401;
});
await step("api-db-preflight", async () => {
  const verification = await verificationToken();
  state.adminToken = verification.accessToken;
  state.adminUserId = verification.userId;
  state.companyId = verification.companyId;
  state.userEmail = verification.userEmail;
  const response = await request("/mail/storage", adminOptions());
  assert(response.status === 200, `storage API ${response.status}`);
  for (const key of ["usedBytes", "quotaBytes", "usagePercent"]) assert(Number.isFinite(response.body[key]) && response.body[key] >= 0, `${key} invalid`);
  apiStorage = response.body;
  const dbStorage = await dbStorageEvidence();
  assert(dbStorage.usedBytes === apiStorage.usedBytes, "usedBytes API/DB mismatch");
  assert(dbStorage.quotaBytes === apiStorage.quotaBytes, "quotaBytes API/DB mismatch");
  assert(dbStorage.usagePercent === apiStorage.usagePercent, "usagePercent API/DB mismatch");
  const forbidden = await forbiddenToken();
  if (forbidden.available) {
    const forbiddenResponse = await request("/mail/storage", { headers: { authorization: `Bearer ${forbidden.accessToken}` } });
    assert(forbiddenResponse.status === 403, `missing mail:read response ${forbiddenResponse.status}`);
  }
  await writeFile(resolve(evidenceDir, "db-storage.json"), JSON.stringify(sanitize({ api: apiStorage, db: dbStorage }), null, 2));
  result.checks.apiDb = { status: 200, matched: true, selectOnly: true };
  result.checks.accessControl = { unauthenticated: result.checks.unauthenticated, missingPermission: forbidden.available ? 403 : "no-active-candidate" };
});
if (!adminPassword) {
  result.status = "blocked";
  result.error = "MOAWORKS_TEST_PASSWORD is required for Chrome login verification";
  await record("local-chrome", "WAIT", { summary: result.error });
} else {
  try {
    await step("access-control", async () => {
      const loginResponse = await login("admin@moaworks.local", adminPassword);
      assert(loginResponse.status === 200, `admin login ${loginResponse.status}`);
      assert(loginResponse.body.user.userId === state.adminUserId, "Chrome login user differs from API/DB preflight user");
      state.adminToken = loginResponse.body.accessToken;
      state.adminUserId = loginResponse.body.user.userId;
      state.companyId = loginResponse.body.user.companyId;
      state.userEmail = loginResponse.body.user.userEmail;
      result.checks.chromeLogin = true;
    });

    await step("local-chrome", async () => {
      browser = await chromium.launch({ channel: "chrome", headless: true });
      const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      const page = await context.newPage();
      let storageFailureInjected = false;
      await page.route("**/api/v1/mail/storage", async (route) => {
        if (!storageFailureInjected) {
          storageFailureInjected = true;
          await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "UI014_EXPECTED_STORAGE_ERROR" }) });
          return;
        }
        await route.continue();
      });
      page.on("request", (request) => {
        if (request.url().includes("/api/v1/")) network.push({ method: request.method(), url: sanitize(request.url()) });
      });
      page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
      page.on("response", (response) => { if (response.status() >= 400) httpErrors.push({ status: response.status(), url: sanitize(response.url()) }); });

      await page.goto(`${webBase}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.locator("input").first().fill("admin");
      await page.locator('input[type="password"]').fill(adminPassword);
      await page.getByRole("button", { name: /로그인/i }).click();
      await page.locator(".user-app-rail-menu").waitFor({ timeout: 15000 });
      await page.getByRole("button", { name: "메일", exact: true }).click();
      const shell = page.locator(".user-mail-shell");
      await shell.waitFor();
      const measurements = await shell.evaluate((element) => ({
        width: Math.round(element.getBoundingClientRect().width),
        fontSize: getComputedStyle(element).fontSize,
        viewport: { width: innerWidth, height: innerHeight },
        pageHasScroll: document.documentElement.scrollHeight > document.documentElement.clientHeight,
      }));
      assert(measurements.width === 136, `mail shell width ${measurements.width}`);
      assert(measurements.fontSize === "12px", `mail shell font ${measurements.fontSize}`);
      assert(measurements.viewport.width === 1920 && measurements.viewport.height === 1080, "viewport mismatch");
      assert(measurements.pageHasScroll === false, "whole page scroll detected");

      await shell.getByRole("button", { name: "메일쓰기", exact: true }).click();
      const compose = page.locator(".user-mail-compose-popup");
      await compose.getByText("새 메일", { exact: true }).waitFor();
      await compose.getByRole("button", { name: "닫기", exact: true }).click();
      for (const name of ["중요", "안 읽은 메일", "받은편지함", "보낸편지함", "임시보관함"]) {
        await shell.getByRole("button", { name: new RegExp(`^${name}`) }).click();
      }
      for (const name of ["예약메일함", "스팸메일함", "휴지통", "사용자 메일함", "태그"]) {
        const item = shell.getByRole("button", { name: new RegExp(`^${name}`) });
        assert(await item.getAttribute("aria-disabled") === "true", `${name} aria-disabled missing`);
        await item.focus();
        assert((await item.getAttribute("data-tooltip"))?.length > 0, `${name} tooltip missing`);
      }

      const retry = shell.getByRole("button", { name: "용량 다시 시도", exact: true });
      await retry.waitFor();
      assert(await page.locator(".user-mail-list-panel").isVisible(), "storage failure blocked mail list");
      await retry.click();
      await shell.getByText(new RegExp(`${apiStorage.quotaBytes === 0 ? "할당량 미설정" : "/"}`)).waitFor();
      await page.screenshot({ path: resolve(evidenceDir, "mail-shell.png"), fullPage: false });

      await shell.getByRole("button", { name: "빠른 검색", exact: true }).click();
      const search = page.getByLabel("통합 검색");
      assert(await search.evaluate((element) => element === document.activeElement), "search focus missing");
      await search.fill("메일");
      await page.getByRole("dialog", { name: "통합 검색 결과" }).waitFor();
      assert(await page.locator('[data-search-filter="mail"]').getAttribute("aria-pressed") === "true", "mail filter missing");
      await page.getByRole("button", { name: "검색 닫기" }).click();

      await shell.getByRole("button", { name: "환경설정", exact: true }).click();
      await page.getByText("사용자 설정", { exact: true }).waitFor();
      await page.screenshot({ path: resolve(evidenceDir, "settings-navigation.png"), fullPage: false });

      await page.getByRole("button", { name: "메일", exact: true }).click();
      await page.locator(".user-split-view").waitFor();
      const mailRows = page.locator(".user-mail-list-panel > button");
      assert(await mailRows.count() > 0, "mail regression requires at least one mail row");
      await mailRows.first().click();
      await page.locator(".user-mail-detail-panel").waitFor();
      const expand = page.getByRole("button", { name: "메일 상세 전체 보기" });
      await expand.click();
      assert((await page.locator(".user-mail-workbench").getAttribute("class")).includes("is-detail-expanded"), "detail expand missing");
      await page.getByRole("button", { name: "메일 상세 분할 보기" }).click();

      await writeFile(resolve(evidenceDir, "measurements.json"), JSON.stringify(measurements, null, 2));
      result.checks.chrome = { shell: true, compose: true, supportedFolders: 5, unsupportedTooltips: 5, storageErrorIsolationAndRetry: true, quickSearch: true, settings: true, splitViewAndDetail: true, measurements };
      await context.close();
    }, 120000);

    await step("api-db-network", async () => {
      assert(network.length > 0, "no browser API requests captured");
      assert(network.every((item) => item.url.startsWith(`${webBase}/api/v1/`)), "non same-origin browser API request");
      assert(network.some((item) => item.url === `${webBase}/api/v1/mail/storage`), "storage browser request missing");
      assert(consoleErrors.length === 0, `unexpected console errors: ${consoleErrors.length}`);
      await writeFile(resolve(evidenceDir, "network.json"), JSON.stringify(sanitize(network), null, 2));
      await writeFile(resolve(evidenceDir, "console-errors.json"), JSON.stringify(sanitize(consoleErrors), null, 2));
      await writeFile(resolve(evidenceDir, "http-errors.json"), JSON.stringify(sanitize(httpErrors), null, 2));
      result.checks.network = { requestCount: network.length, sameOrigin: true, storageRequest: true, expectedStorageError: httpErrors.some((item) => item.status === 500) };
    });

    result.status = "passed";
  } catch (error) {
    failure = error;
    result.status = "failed";
    result.error = error instanceof Error ? error.message : String(error);
  } finally {
    await browser?.close().catch(() => {});
  }
}

result.finishedAt = new Date().toISOString();
await writeFile(resolve(evidenceDir, "result.json"), JSON.stringify(sanitize(result), null, 2));
const security = await scanEvidence();
result.checks.security = security;
if (security.status !== "passed") {
  failure ??= new Error("evidence security scan failed");
  result.status = "failed";
}
await writeFile(resolve(evidenceDir, "security-scan.json"), JSON.stringify(sanitize(security), null, 2));
await writeFile(resolve(evidenceDir, "result.json"), JSON.stringify(sanitize(result), null, 2));
await record("security-scan", security.status === "passed" ? "OK" : "FAIL", { evidence: resolve(evidenceDir, "security-scan.json") });
await record("complete", result.status === "passed" ? "OK" : result.status === "blocked" ? "WAIT" : "FAIL", { evidence: evidenceDir });

if (failure) throw failure;
if (result.status === "blocked") {
  console.error(result.error);
  process.exitCode = 2;
} else {
  console.log(JSON.stringify({ runId, status: result.status, evidenceDir }));
}
