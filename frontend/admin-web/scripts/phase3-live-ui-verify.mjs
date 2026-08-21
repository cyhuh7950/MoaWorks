import { spawn } from "node:child_process";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";

const appUrl = process.env.MOAWORKS_ADMIN_URL ?? "http://127.0.0.1:3510/";
const chromePath = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const root = resolve(process.cwd(), "../..");
const runId = `${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${process.pid}-${Math.random().toString(36).slice(2, 7)}`;
const evidenceDir = resolve(root, "docs", "evidence", `trust-recovery-phase3-live-ui-${runId}`);
const profileDir = join(evidenceDir, "chrome-profile");
let debugPort = 0;
let sessionToken = "";
let currentStep = "initializing";
const progressFile = join(evidenceDir, "progress.jsonl");
const requestUrls = new Set();
const requestUrlById = new Map();
const completedRequestUrls = new Set();
const completedRequests = [];
const clickAudits = [];
const now = () => new Date().toISOString().replace(/[:.]/g, "-");

function sleep(ms) { return new Promise((resolveSleep) => setTimeout(resolveSleep, ms)); }

async function selectFreePort() {
  return await new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => error ? rejectPort(error) : resolvePort(address.port));
    });
  });
}

async function recordProgress(status, detail = {}) {
  await appendFile(progressFile, `${JSON.stringify({ timestamp: new Date().toISOString(), runId, step: currentStep, status, ...detail })}\n`);
}

async function runStep(name, action) {
  currentStep = name;
  const startedAt = Date.now();
  await recordProgress("started");
  try {
    const value = await action();
    await recordProgress("succeeded", { durationMs: Date.now() - startedAt });
    return value;
  } catch (error) {
    await recordProgress("failed", { durationMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

async function waitForChrome() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { return await fetch(`http://127.0.0.1:${debugPort}/json/version`).then((response) => response.json()); } catch { await sleep(250); }
  }
  throw new Error("Chrome remote debugging endpoint did not start.");
}

async function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
  const pending = new Map();
  let sequence = 0;
  await new Promise((resolveOpen, rejectOpen) => {
    const timeout = setTimeout(() => rejectOpen(new Error("CDP WebSocket connection timed out.")), 10000);
    socket.addEventListener("open", () => { clearTimeout(timeout); resolveOpen(); }, { once: true });
    socket.addEventListener("error", () => { clearTimeout(timeout); rejectOpen(new Error("CDP WebSocket connection failed.")); }, { once: true });
  });
  socket.addEventListener("message", async (event) => {
    const message = JSON.parse(typeof event.data === "string" ? event.data : await event.data.text());
    if (message.id) {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(`${message.error.message} (${message.error.code})`));
      else waiter.resolve(message.result ?? {});
      return;
    }
    if (message.method === "Network.requestWillBeSent") {
      requestUrls.add(message.params.request.url);
      requestUrlById.set(message.params.requestId, message.params.request.url);
    }
    if (message.method === "Network.loadingFinished") {
      const url = requestUrlById.get(message.params.requestId);
      if (url) { completedRequestUrls.add(url); completedRequests.push({ requestId: message.params.requestId, url, completedAt: new Date().toISOString() }); }
    }
  });
  return {
    send(method, params = {}) {
      const id = ++sequence;
      socket.send(JSON.stringify({ id, method, params }));
      const response = new Promise((resolveResult, rejectResult) => pending.set(id, { resolve: resolveResult, reject: rejectResult }));
      const timeout = new Promise((_, rejectResult) => setTimeout(() => { pending.delete(id); rejectResult(new Error(`CDP command timed out: ${method}`)); }, 15000));
      return Promise.race([response, timeout]);
    },
    close() { socket.close(); },
  };
}

async function cleanupVerificationData(token, prefix) {
  const result = { runId, prefix, tokenAvailable: Boolean(token), deletedUsers: [], deletedRoles: [], deletedDepartments: [], failed: [], remaining: null };
  if (!token) return result;
  const headers = { Authorization: `Bearer ${token}` };
  const apiUrl = (path) => new URL(`/api/v1${path}`, appUrl).toString();
  const request = async (path, options = {}) => fetch(apiUrl(path), { ...options, headers: { ...headers, ...(options.headers ?? {}) }, signal: AbortSignal.timeout(8000) });
  const remove = async (kind, id, name, path) => {
    try {
      const response = await request(path, { method: "DELETE" });
      const entry = { id, name, status: response.status };
      if (!response.ok) result.failed.push({ kind, ...entry });
      else result[`deleted${kind}`].push(entry);
    } catch (error) { result.failed.push({ kind, id, name, error: error instanceof Error ? error.message : String(error) }); }
  };
  try {
    const readDirectory = async () => {
      const response = await request("/admin/directory");
      if (!response.ok) throw new Error(`Directory cleanup read failed: ${response.status}`);
      return response.json();
    };
    let directory = await readDirectory();
    for (const user of directory.users.filter((item) => (item.userEmail ?? "").startsWith(prefix) && item.status !== "deleted")) await remove("Users", user.userId, user.userEmail, `/admin/users/${user.userId}`);
    directory = await readDirectory();
    for (const role of directory.roles.filter((item) => (item.name ?? "").includes(runId) && item.status !== "deleted")) await remove("Roles", role.id, role.name, `/admin/roles/${role.id}`);
    directory = await readDirectory();
    for (const department of directory.departments.filter((item) => (item.name ?? "").includes(runId) && item.status !== "deleted")) await remove("Departments", department.id, department.name, `/admin/departments/${department.id}`);
    directory = await readDirectory();
    result.remaining = {
      users: directory.users.filter((item) => (item.userEmail ?? "").startsWith(prefix) && item.status !== "deleted").map((item) => item.userEmail),
      roles: directory.roles.filter((item) => (item.name ?? "").includes(runId) && item.status !== "deleted").map((item) => item.name),
      departments: directory.departments.filter((item) => (item.name ?? "").includes(runId) && item.status !== "deleted").map((item) => item.name),
    };
  } catch (error) { result.failed.push({ kind: "directory", error: error instanceof Error ? error.message : String(error) }); }
  return result;
}

async function main() {
  await mkdir(evidenceDir, { recursive: true });
  await recordProgress("run-started", { appUrl });
  currentStep = "Chrome 시작";
  await recordProgress("started");
  debugPort = await selectFreePort();
  const chrome = spawn(chromePath, [
    "--headless=new", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profileDir}`,
    "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--window-size=1920,1080", "about:blank",
  ], { stdio: "ignore", windowsHide: true });
  let client;
  let verificationPrefix = '';
  try {
    await waitForChrome();
    await recordProgress("succeeded", { debugPort, profileDir });
    const target = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" }).then((response) => response.json());
    client = await connect(target.webSocketDebuggerUrl);
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Network.enable");
    await client.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });

    const evaluate = async (expression) => {
      const response = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || "Runtime evaluation failed.");
      return response.result.value;
    };
    const waitForNetwork = async (pathFragment, label, afterIndex = 0) => {
      for (let attempt = 0; attempt < 80; attempt += 1) {
        if (completedRequests.slice(afterIndex).some((request) => request.url.includes(pathFragment))) return;
        await sleep(150);
      }
      throw new Error(`Timed out waiting for completed request: ${label}. New requests: ${JSON.stringify(completedRequests.slice(afterIndex))}`);
    };
    const waitFor = async (expression, label) => {
      for (let attempt = 0; attempt < 80; attempt += 1) {
        if (await evaluate(expression)) return;
        await sleep(150);
      }
      throw new Error(`Timed out waiting for ${label}. Body: ${await evaluate("document.body.innerText")}`);
    };
    const dispatchMouseClick = async (target, clickCount = 1) => {
      await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: target.x, y: target.y, button: "none", buttons: 0 });
      await sleep(40);
      await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: target.x, y: target.y, button: "left", buttons: 1, clickCount });
      await sleep(40);
      await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: target.x, y: target.y, button: "left", buttons: 0, clickCount });
    };
    const clickButton = async (text, root = "document") => {
      const target = await evaluate(`(() => {
        const root = ${root};
        const visible = (element) => Boolean(element && element.offsetParent !== null && !element.disabled);
        const button = [...root.querySelectorAll('button')].find((item) => item.textContent.trim() === ${JSON.stringify(text)} && visible(item));
        if (!button) throw new Error('Button not found: ' + ${JSON.stringify(text)});
        button.scrollIntoView({ block: "center", inline: "center" });
        const rect = button.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, disabled: button.disabled };
      })()`);
      if (target.disabled) throw new Error(`Button disabled: ${text}`);
      await dispatchMouseClick(target);
      await sleep(80);
      clickAudits.push({ text, target, hit: await evaluate(`(() => { const item = document.elementFromPoint(${target.x}, ${target.y}); return item ? { tag: item.tagName, text: item.textContent.trim().slice(0, 80), className: item.className } : null; })()`) });
    };
    const clickSelector = async (selector, root = "document") => {
      const target = await evaluate(`(() => {
        const root = ${root};
        const element = root.querySelector(${JSON.stringify("__SELECTOR__")});
        if (!element || element.disabled || element.offsetParent === null) throw new Error("Clickable selector not ready: " + ${JSON.stringify("__SELECTOR__")});
        element.scrollIntoView({ block: "center", inline: "center" });
        const rect = element.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`.replaceAll("__SELECTOR__", selector));
      await dispatchMouseClick(target);
    };

    const setLabelValue = async (labelText, value, root = "document") => evaluate(`(() => {
      const root = ${root};
      const label = [...root.querySelectorAll('label')].find((item) => item.textContent.includes(${JSON.stringify(labelText)}));
      const input = label?.querySelector('input, select, textarea');
      if (!input) throw new Error('Field not found: ' + ${JSON.stringify(labelText)});
      const descriptor = Object.getOwnPropertyDescriptor(input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value');
      descriptor.set.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return input.value;
    })()`);
    const clickRowCheckbox = async (needle) => {
      const target = await evaluate(`(() => {
        const row = [...document.querySelectorAll('tr')].find((item) => item.innerText.includes(${JSON.stringify(needle)}));
        const checkbox = row?.querySelector('input[type="checkbox"]');
        if (!checkbox) throw new Error('Selectable row not found: ' + ${JSON.stringify(needle)});
        checkbox.scrollIntoView({ block: "center", inline: "center" });
        const rect = checkbox.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`);
      await dispatchMouseClick(target);
    };
    const doubleClickRow = async (needle) => {
      const target = await evaluate(`(() => {
        const row = [...document.querySelectorAll('tr')].find((item) => item.innerText.includes(${JSON.stringify(needle)}));
        if (!row) throw new Error('Row not found: ' + ${JSON.stringify(needle)});
        row.scrollIntoView({ block: "center", inline: "center" });
        const rect = row.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + Math.min(16, rect.height / 2) };
      })()`);
      await dispatchMouseClick(target, 2);
    };
    const screenshot = async (name) => {
      const data = await client.send("Page.captureScreenshot", { format: "png" });
      const file = join(evidenceDir, `${name}.png`);
      await writeFile(file, Buffer.from(data.data, "base64"));
      return file;
    };
    const measure = () => evaluate(`(() => { const scrolling = document.scrollingElement; return { viewport: { width: window.innerWidth, height: window.innerHeight }, scrollHeight: scrolling.scrollHeight, clientHeight: scrolling.clientHeight, pageHasScroll: scrolling.scrollHeight > scrolling.clientHeight + 1, consolePresent: Boolean(document.querySelector('.console-layout')) }; })()`);

    currentStep = "로그인";
    await recordProgress("started");
    await client.send("Page.navigate", { url: appUrl });
    await waitFor("document.readyState === 'complete'", "admin-web document");
    await waitFor("document.querySelector('input[type=password]') !== null", "admin login form");
    await evaluate(`(() => { const inputs = [...document.querySelectorAll('input')]; const login = inputs.find((item) => item.type === 'text' || item.type === 'email'); const password = inputs.find((item) => item.type === 'password'); const set = (input, value) => { const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); descriptor.set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); }; set(login, 'admin'); set(password, 'm@68150183'); const form = document.querySelector('.login-card form'); const submit = form?.querySelector('button[type=submit]'); if (!submit) throw new Error('Login submit button not found.'); submit.click(); return true; })()`);
    await waitFor("document.querySelector('.console-layout') !== null", "admin console");
    sessionToken = await evaluate("localStorage.getItem('moaworks.adminToken') || ''");
    if (!sessionToken) throw new Error("Admin session token was not stored after login.");
    await recordProgress("succeeded");
    currentStep = "사용자";
    await recordProgress("started");

    const results = { login: true, screenshots: [], measurements: {}, menus: {}, network: [] };
    for (const [key, label] of [["users", "사용자 관리"], ["departments", "부서 관리"], ["roles", "권한 관리"]]) {
      await clickButton(label, "document.querySelector('.console-sidebar')");
      await sleep(300);
      results.measurements[key] = await measure();
      results.screenshots.push(await screenshot(`phase3-${key}-list`));
      results.menus[key] = { listVisible: await evaluate(`document.body.innerText.includes(${JSON.stringify(label)})`) };
    }

    await clickButton("사용자 관리", "document.querySelector('.console-sidebar')");
    await waitFor("[...document.querySelectorAll('button')].some((item) => item.textContent.trim() === '사용자 등록' && !item.disabled)", "user registration action enabled");
    await clickButton("사용자 등록");
    await waitFor("document.querySelector('.management-editor-modal') !== null", "user create popup");
    results.menus.users.createPopup = true;
    results.screenshots.push(await screenshot("phase3-users-create-popup"));
    await clickButton("닫기", "document.querySelector('.management-editor-modal')");
    await waitFor("document.querySelector('.management-editor-modal') === null", "user popup close");

    await clickButton("부서 관리", "document.querySelector('.console-sidebar')");
    await waitFor("[...document.querySelectorAll('button')].some((item) => item.textContent.trim() === '부서 등록' && !item.disabled)", "department registration action enabled");
    await clickButton("부서 등록");
    await waitFor("document.querySelector('.management-editor-modal') !== null", "department create popup");
    results.menus.departments.createPopup = true;
    results.screenshots.push(await screenshot("phase3-departments-create-popup"));
    await clickButton("닫기", "document.querySelector('.management-editor-modal')");
    await waitFor("document.querySelector('.management-editor-modal') === null", "user popup close");

    await clickButton("권한 관리", "document.querySelector('.console-sidebar')");
    await waitFor("[...document.querySelectorAll('button')].some((item) => item.textContent.trim() === '새 권한 역할' && !item.disabled)", "role registration action enabled");
    await clickButton("새 권한 역할");
    await waitFor("document.querySelector('.management-role-modal') !== null", "role create popup");
    results.menus.roles.createPopup = true;
    results.menus.roles.rawPermissionEditor = await evaluate("Boolean(document.querySelector('.management-role-modal textarea')) || [...document.querySelectorAll('.management-role-modal label')].some((item) => item.textContent.includes('권한 문자열'))");
    results.screenshots.push(await screenshot("phase3-roles-create-popup"));
    await clickButton("닫기", "document.querySelector('.management-role-modal')");
    await waitFor("document.querySelector('.management-role-modal') === null", "role popup close");

    await clickButton("사용자 관리", "document.querySelector('.console-sidebar')");
    const firstUser = await evaluate("[...document.querySelectorAll('.ops-list-panel tr')].map((item) => item.innerText).find((item) => item.includes('@') && !item.includes('admin@moaworks.local')) || [...document.querySelectorAll('.ops-list-panel tr')].map((item) => item.innerText).find((item) => item.includes('@'))");
    if (firstUser) { await doubleClickRow(firstUser.split('\n')[0]); await waitFor("document.querySelector('.management-editor-modal') !== null", "user edit popup"); results.menus.users.doubleClickPopup = true; await clickButton("닫기", "document.querySelector('.management-editor-modal')"); await waitFor("document.querySelector('.management-editor-modal') === null", "user edit popup close"); }

    const stamp = runId;
    verificationPrefix = `verify.phase3.ui.${stamp}`;
    const clickToolbar = (text) => clickButton(text, "document.querySelector('.management-list-toolbar')");
    const waitToolbarAction = (text) => waitFor(`(() => { const button = [...document.querySelector('.management-list-toolbar').querySelectorAll('button')].find((item) => item.textContent.trim() === ${JSON.stringify(text)}); return Boolean(button && !button.disabled); })()`, `${text} toolbar enabled`);
    const rowStatus = (needle) => evaluate(`(() => [...document.querySelectorAll('.management-list-row')].find((item) => item.innerText.includes(${JSON.stringify(needle)}))?.innerText ?? '')()`);
    const waitRowStatus = (needle, status) => waitFor(`(() => { const row = [...document.querySelectorAll('.management-list-row')].find((item) => item.innerText.includes(${JSON.stringify(needle)})); return Boolean(row && [...row.querySelectorAll('.badge')].some((badge) => badge.textContent.trim() === ${JSON.stringify(status)})); })()`, `${needle} ${status}`);
    const waitSelectedCount = (count) => waitFor(`document.querySelector('.management-list-toolbar')?.innerText.includes(${JSON.stringify('선택 ')} + ${JSON.stringify(count)})`, `selected ${count}`);

    await waitFor("[...document.querySelectorAll('button')].some((item) => item.textContent.trim() === '사용자 등록' && !item.disabled)", "user registration action enabled");
    await clickButton("사용자 등록");
    await waitFor("document.querySelector('.management-editor-modal') !== null", "user registration popup");
    const userOne = `${verificationPrefix}.a`;
    await setLabelValue("사용자 이름", `검수3단계 화면사용자 A ${stamp}`, "document.querySelector('.management-editor-modal')");
    await setLabelValue("아이디", userOne, "document.querySelector('.management-editor-modal')");
    await clickButton("사용자 생성", "document.querySelector('.management-editor-modal')");
    await waitFor("document.querySelector('.management-editor-modal') === null", "user registration save");
    await waitFor(`document.body.innerText.includes(${JSON.stringify(userOne)})`, "first test user row");
    await waitFor("[...document.querySelectorAll('button')].some((item) => item.textContent.trim() === '사용자 등록' && !item.disabled)", "user registration action enabled");
    await clickButton("사용자 등록");
    await waitFor("document.querySelector('.management-editor-modal') !== null", "second user registration popup");
    const userTwo = `${verificationPrefix}.b`;
    await setLabelValue("사용자 이름", `검수3단계 화면사용자 B ${stamp}`, "document.querySelector('.management-editor-modal')");
    await setLabelValue("아이디", userTwo, "document.querySelector('.management-editor-modal')");
    await clickButton("사용자 생성", "document.querySelector('.management-editor-modal')");
    await waitFor("document.querySelector('.management-editor-modal') === null", "second user registration save");
    await waitFor(`document.body.innerText.includes(${JSON.stringify(userTwo)})`, "second test user row");
    await clickRowCheckbox(userOne); await clickRowCheckbox(userTwo);
    await waitToolbarAction("비활성화"); await clickToolbar("비활성화");
    await waitFor("document.querySelector('.management-confirm-modal') !== null", "user deactivate confirmation");
    results.menus.users.deactivateConfirmation = true;
    await clickButton("확인", "document.querySelector('.management-confirm-modal')");
    await waitRowStatus(userOne, "inactive"); await waitRowStatus(userTwo, "inactive");
    await clickRowCheckbox(userOne); await clickRowCheckbox(userTwo);
    await waitToolbarAction("활성화"); await clickToolbar("활성화");
    await waitFor("document.querySelector('.management-confirm-modal') !== null", "user activate confirmation");
    await clickButton("확인", "document.querySelector('.management-confirm-modal')");
    await waitRowStatus(userOne, "active"); await waitRowStatus(userTwo, "active");
    await clickRowCheckbox(userOne); await clickRowCheckbox(userTwo);
    await waitToolbarAction("삭제"); await clickToolbar("삭제");
    await waitFor("document.querySelector('.management-confirm-modal') !== null", "user delete confirmation");
    results.menus.users.deleteConfirmation = true;
    results.screenshots.push(await screenshot("phase3-users-delete-confirmation"));
    await clickButton("확인", "document.querySelector('.management-confirm-modal')");
    await waitFor(`!document.body.innerText.includes(${JSON.stringify(userOne)}) && !document.body.innerText.includes(${JSON.stringify(userTwo)})`, "deleted users removed from visible list");
    results.menus.users.bulkLifecycle = true;
    await recordProgress("succeeded");
    currentStep = "부서";
    await recordProgress("started");

    await clickButton("부서 관리", "document.querySelector('.console-sidebar')");
    await waitFor("[...document.querySelectorAll('button')].some((item) => item.textContent.trim() === '부서 등록' && !item.disabled)", "department registration action enabled");
    await clickButton("부서 등록");
    await waitFor("document.querySelector('.management-editor-modal') !== null", "department registration popup");
    const departmentName = `검수3단계 화면부서 ${stamp}`;
    await setLabelValue("부서명", departmentName, "document.querySelector('.management-editor-modal')");
    await evaluate(`(() => { const label = [...document.querySelectorAll('.management-editor-modal label')].find((item) => item.textContent.includes('상위 부서')); const select = label?.querySelector('select'); if (!select || select.options.length < 2) throw new Error('No parent department option.'); const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value'); descriptor.set.call(select, select.options[1].value); select.dispatchEvent(new Event('change', { bubbles: true })); return select.value; })()`);
    await clickButton("등록", "document.querySelector('.management-editor-modal')");
    await waitFor("document.querySelector('.management-editor-modal') === null", "department registration save");
    await waitFor(`document.body.innerText.includes(${JSON.stringify(departmentName)})`, "test department row");
    await doubleClickRow(departmentName); await waitFor("document.querySelector('.management-editor-modal') !== null", "department edit popup"); results.menus.departments.doubleClickPopup = true; await clickButton("닫기", "document.querySelector('.management-editor-modal')"); await waitFor("document.querySelector('.management-editor-modal') === null", "department edit popup close");
    await clickRowCheckbox(departmentName); await waitToolbarAction("비활성화"); await clickToolbar("비활성화"); await waitFor("document.querySelector('.management-confirm-modal') !== null", "department deactivate confirmation"); await clickButton("확인", "document.querySelector('.management-confirm-modal')"); await waitRowStatus(departmentName, "inactive");
    await clickRowCheckbox(departmentName); await waitToolbarAction("활성화"); await clickToolbar("활성화"); await waitFor("document.querySelector('.management-confirm-modal') !== null", "department activate confirmation"); await clickButton("확인", "document.querySelector('.management-confirm-modal')"); await waitRowStatus(departmentName, "active");
    await clickRowCheckbox(departmentName); await waitToolbarAction("삭제"); await clickToolbar("삭제"); await waitFor("document.querySelector('.management-confirm-modal') !== null", "department delete confirmation"); results.menus.departments.deleteConfirmation = true; await clickButton("확인", "document.querySelector('.management-confirm-modal')"); await waitFor(`!document.body.innerText.includes(${JSON.stringify(departmentName)})`, "deleted department removed from visible list"); results.menus.departments.bulkLifecycle = true;
    await recordProgress("succeeded");
    currentStep = "권한";
    await recordProgress("started");

    await clickButton("권한 관리", "document.querySelector('.console-sidebar')");
    await waitFor("[...document.querySelectorAll('button')].some((item) => item.textContent.trim() === '새 권한 역할' && !item.disabled)", "role registration action enabled");
    await clickButton("새 권한 역할"); await waitFor("document.querySelector('.management-role-modal') !== null", "role registration popup");
    const roleName = `검수3단계 화면역할 ${stamp}`;
    await setLabelValue("역할명", roleName, "document.querySelector('.management-role-modal')");
    await clickButton("권한 역할 등록", "document.querySelector('.management-role-modal')"); await waitFor("document.querySelector('.management-role-modal') === null", "role registration save"); await waitFor(`document.body.innerText.includes(${JSON.stringify(roleName)})`, "test role row");
    await doubleClickRow(roleName); await waitFor("document.querySelector('.management-role-modal') !== null", "role edit popup"); results.menus.roles.doubleClickPopup = true;
    await clickSelector('.management-role-modal input[type=checkbox]');
    await waitFor("[...document.querySelectorAll('.management-role-modal button')].some((item) => item.textContent.trim() === '권한 수정 저장' && !item.disabled)", "role update action enabled");
    const roleUpdateNetworkStart = completedRequests.length;
    await clickButton("권한 수정 저장", "document.querySelector('.management-role-modal')"); await waitForNetwork("/api/v1/admin/roles/", "role update", roleUpdateNetworkStart); await waitFor("document.querySelector('.management-role-modal') === null", "role permission update save");
    await doubleClickRow(roleName); await waitFor("document.querySelector('.management-role-modal') !== null", "role reentry popup"); results.menus.roles.permissionReentry = await evaluate("Boolean(document.querySelector('.management-role-modal input[type=checkbox]:checked'))"); if (!results.menus.roles.permissionReentry) throw new Error('Saved permission checkbox was not retained on role reentry.'); await clickButton("닫기", "document.querySelector('.management-role-modal')"); await waitFor("document.querySelector('.management-role-modal') === null", "role reentry close");
    await clickRowCheckbox(roleName); await waitToolbarAction("비활성화"); await clickToolbar("비활성화"); await waitFor("document.querySelector('.management-confirm-modal') !== null", "role deactivate confirmation"); await clickButton("확인", "document.querySelector('.management-confirm-modal')"); await waitRowStatus(roleName, "inactive");
    await clickRowCheckbox(roleName); await waitToolbarAction("활성화"); await clickToolbar("활성화"); await waitFor("document.querySelector('.management-confirm-modal') !== null", "role activate confirmation"); await clickButton("확인", "document.querySelector('.management-confirm-modal')"); await waitRowStatus(roleName, "active");
    await clickRowCheckbox(roleName); await waitToolbarAction("삭제"); await clickToolbar("삭제"); await waitFor("document.querySelector('.management-confirm-modal') !== null", "role delete confirmation"); results.menus.roles.deleteConfirmation = true; await clickButton("확인", "document.querySelector('.management-confirm-modal')"); await waitFor(`!document.body.innerText.includes(${JSON.stringify(roleName)})`, "deleted role removed from visible list"); results.menus.roles.bulkLifecycle = true;
    await recordProgress("succeeded");
    currentStep = "org import 보호 회귀";
    await recordProgress("started");

    await clickButton("사용자 관리", "document.querySelector('.console-sidebar')");
    await clickButton("조직/사용자 일괄 업로드");
    await waitFor("document.querySelector('.org-import-modal') !== null", "org import popup");
    const documentRoot = await client.send("DOM.getDocument", { depth: 1 });
    const fileInput = await client.send("DOM.querySelector", { nodeId: documentRoot.root.nodeId, selector: "#org-import-file" });
    const workbook = resolve(root, "docs", "evidence", "trust-recovery-phase1-2026-07-11", "org-import-missing_users.xlsx");
    await client.send("DOM.setFileInputFiles", { files: [workbook], nodeId: fileInput.nodeId });
    await evaluate("document.querySelector(\"#org-import-file\").dispatchEvent(new Event(\"change\", { bubbles: true })); true");
    await waitFor("document.querySelector(\".org-import-modal\")?.innerText.includes(\"org-import-missing_users.xlsx\")", "selected org import file");
    await clickButton("검증 실행", "document.querySelector('.org-import-modal')");
    await waitFor("document.querySelector('.org-import-modal')?.innerText.includes('보호 제외 사용자')", "org import protected users");
    results.menus.users.orgImportProtectedUsers = await evaluate("document.querySelector('.org-import-modal').innerText.includes('cyhuh@moaworks.local') && document.querySelector('.org-import-modal').innerText.includes('ysla@moaworks.local')");
    results.menus.users.orgImportApplyDisabled = await evaluate("[...document.querySelector('.org-import-modal').querySelectorAll('button')].find((item) => item.textContent.trim() === '적용 실행')?.disabled === true");
    results.screenshots.push(await screenshot("phase3-org-import-protected-users"));
    await clickButton("닫기", "document.querySelector('.org-import-modal')");
    await recordProgress("succeeded");
    currentStep = "DB 재조회";
    await recordProgress("started");
    const verificationDirectory = await fetch(new URL("/api/v1/admin/directory", appUrl), { headers: { Authorization: `Bearer ${sessionToken}` }, signal: AbortSignal.timeout(8000) }).then((response) => response.json());
    results.dbRecheck = { users: verificationDirectory.users.filter((item) => (item.userEmail ?? "").startsWith(verificationPrefix)).map((item) => ({ email: item.userEmail, status: item.status })), roles: verificationDirectory.roles.filter((item) => (item.name ?? "").includes(runId)).map((item) => ({ name: item.name, status: item.status })), departments: verificationDirectory.departments.filter((item) => (item.name ?? "").includes(runId)).map((item) => ({ name: item.name, status: item.status })) };
    await recordProgress("succeeded");

    results.network = [...requestUrls].filter((url) => url.includes("/api/v1/")).sort();
    await writeFile(join(evidenceDir, "measurements.json"), JSON.stringify(results, null, 2));
    await writeFile(join(evidenceDir, "network.json"), JSON.stringify({ runId, urls: results.network }, null, 2));
    console.log(JSON.stringify({ evidenceDir, results }, null, 2));
  } catch (error) {
    const failure = { runId, step: currentStep, error: error instanceof Error ? error.message : String(error), dom: null, network: [...requestUrls].filter((url) => url.includes("/api/v1/")).sort(), clickAudits };
    try {
      const domResponse = client ? await client.send("Runtime.evaluate", { expression: "document.body.innerText.slice(0, 8000)", returnByValue: true }) : null;
      failure.dom = domResponse?.result?.value ?? null;
      if (client) { const image = await client.send("Page.captureScreenshot", { format: "png" }); await writeFile(join(evidenceDir, "failure.png"), Buffer.from(image.data, "base64")); }
    } catch (captureError) { failure.captureError = captureError instanceof Error ? captureError.message : String(captureError); }
    await writeFile(join(evidenceDir, "failure.json"), JSON.stringify(failure, null, 2));
    await recordProgress("failed", { error: failure.error, domCaptured: Boolean(failure.dom) });
    throw error;
  } finally {
    currentStep = "정리";
    await recordProgress("started");
    const cleanup = await cleanupVerificationData(sessionToken, verificationPrefix);
    await writeFile(join(evidenceDir, "cleanup-result.json"), JSON.stringify(cleanup, null, 2));
    await recordProgress(cleanup.failed.length === 0 && (!cleanup.remaining || Object.values(cleanup.remaining).every((items) => items.length === 0)) ? "succeeded" : "failed", { cleanup });
    client?.close();
    chrome.kill();
  }
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });