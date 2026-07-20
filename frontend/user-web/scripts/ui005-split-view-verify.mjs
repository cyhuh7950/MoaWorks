import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const runId = process.argv[2] || `verify.ui005.${Date.now()}`;
const password = process.env.MOAWORKS_TEST_PASSWORD;
if (!password) throw new Error("MOAWORKS_TEST_PASSWORD is required");
const root = resolve(import.meta.dirname, "../../..");
const evidenceDir = resolve(root, "docs/evidence/ui005-split-view", runId);
const progressPath = resolve(evidenceDir, "progress.jsonl");
await mkdir(evidenceDir, { recursive: true });
const network = [];
const consoleErrors = [];
const httpErrors = [];
const result = { runId, status: "running", startedAt: new Date().toISOString(), checks: {} };
const record = (step, status, details = {}) => appendFile(progressPath, JSON.stringify({ at: new Date().toISOString(), step, status, ...details }) + "\n");
const step = async (name, action) => {
  await record(name, "start");
  try {
    const value = await action();
    await record(name, "success");
    return value;
  } catch (error) {
    await record(name, "failure", { message: error instanceof Error ? error.message : String(error) });
    throw error;
  }
};
const assert = (condition, message) => { if (!condition) throw new Error(message); };
let browser;
let page;
try {
  await step("g0", async () => {
    const response = await fetch("http://127.0.0.1:3520/", { signal: AbortSignal.timeout(5000) });
    const body = await response.text();
    assert(response.status === 200, `user-web status ${response.status}`);
    assert(body.includes('<div id="root"></div>'), "user-web root markup missing");
    result.checks.runtime = { status: response.status, appRoot: true };
  });

  await step("chrome-login", async () => {
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    page = await context.newPage();
    page.on("request", (request) => {
      if (!request.url().includes("/api/v1/")) return;
      const url = new URL(request.url());
      for (const key of ["token", "access_token", "password"]) if (url.searchParams.has(key)) url.searchParams.set(key, "[REDACTED]");
      network.push({ method: request.method(), url: url.toString() });
    });
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    page.on("response", (response) => { if (response.status() >= 400) httpErrors.push({ status: response.status(), url: response.url() }); });
    await page.goto("http://127.0.0.1:3520/", { waitUntil: "domcontentloaded", timeout: 10000 });
    if (await page.locator('input[type="password"]').isVisible().catch(() => false)) {
      await page.locator("input").first().fill("admin");
      await page.locator('input[type="password"]').fill(password);
      const loginResponsePromise = page.waitForResponse((response) => response.url().includes("/api/v1/auth/login"));
      await page.getByRole("button", { name: /로그인/i }).click();
      const loginResponse = await loginResponsePromise;
      const loginPayload = await loginResponse.json();
      assert(loginResponse.status() === 200, `login status ${loginResponse.status()}`);
      result.checks.login = { status: loginResponse.status(), userStatus: loginPayload.user?.status, mustChangePassword: loginPayload.user?.mustChangePassword };
    }
    await page.locator(".user-app-rail-menu").waitFor({ timeout: 15000 });
    await page.evaluate(() => localStorage.removeItem("moaworks.user.mail.split-ratio.v1"));
  });

  await step("default-split", async () => {
    await page.getByRole("button", { name: /^메일/ }).first().click();
    await page.locator(".user-split-view").waitFor();
    const separator = page.getByRole("separator", { name: "메일 목록과 상세 영역 너비 조절" });
    assert((await separator.getAttribute("aria-valuenow")) === "50", "default split ratio is not 50");
    result.checks.defaultRatio = 50;
  });

  await step("keyboard-resize", async () => {
    const separator = page.getByRole("separator", { name: "메일 목록과 상세 영역 너비 조절" });
    await separator.focus();
    await separator.press("ArrowRight");
    assert((await separator.getAttribute("aria-valuenow")) === "52", "keyboard split adjustment failed");
    assert((await separator.getAttribute("aria-valuemin")) === "25", "separator min aria mismatch");
    assert((await separator.getAttribute("aria-valuemax")) === "75", "separator max aria mismatch");
    result.checks.keyboardRatio = 52;
  });

  await step("pointer-resize-persist", async () => {
    const split = page.locator(".user-split-view");
    const separator = page.getByRole("separator", { name: "메일 목록과 상세 영역 너비 조절" });
    const box = await split.boundingBox();
    const handle = await separator.boundingBox();
    assert(box && handle, "split bounds unavailable");
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.62, handle.y + handle.height / 2, { steps: 4 });
    await page.mouse.up();
    const pointerRatio = Number(await separator.getAttribute("aria-valuenow"));
    assert(pointerRatio >= 60 && pointerRatio <= 64, `pointer ratio unexpected: ${pointerRatio}`);
    const storedRatio = Number(await page.evaluate(() => localStorage.getItem("moaworks.user.mail.split-ratio.v1")));
    assert(Math.round(storedRatio) === pointerRatio, `local storage ratio mismatch: ${storedRatio}`);
    await page.getByRole("button", { name: /^홈/ }).first().click();
    await page.getByRole("button", { name: /^메일/ }).first().click();
    const restored = page.getByRole("separator", { name: "메일 목록과 상세 영역 너비 조절" });
    await restored.waitFor();
    const restoredRatio = Number(await restored.getAttribute("aria-valuenow"));
    assert(restoredRatio === pointerRatio, `stored ratio mismatch: ${pointerRatio}/${restoredRatio}`);
    result.checks.pointerRatio = pointerRatio;
    result.checks.restoredRatio = restoredRatio;
  });

  await step("mail-regression", async () => {
    const rows = page.locator(".user-mail-list-panel > button");
    await rows.first().waitFor({ timeout: 15000 });
    assert((await rows.count()) > 0, "mail list has no selectable rows");
    await rows.first().click();
    await page.locator(".user-mail-detail-panel h2").filter({ hasNotText: "메일을 선택하세요" }).waitFor({ timeout: 10000 });
    const maximize = page.getByRole("button", { name: "메일 상세 전체 보기" });
    await maximize.click();
    assert((await page.locator(".user-split-view").getAttribute("class")).includes("is-secondary-maximized"), "detail maximize failed");
    assert((await page.getByRole("button", { name: "메일 상세 분할 보기" }).getAttribute("aria-pressed")) === "true", "maximize aria state missing");
    await page.getByRole("button", { name: "메일 상세 분할 보기" }).click();
    assert(!(await page.locator(".user-split-view").getAttribute("class")).includes("is-secondary-maximized"), "detail restore failed");
    await page.getByLabel("mail-detail-read-action").click();
    const star = page.getByLabel("mail-detail-star-action");
    const before = (await star.textContent())?.trim();
    const firstStarResponse = page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/star"));
    await star.click();
    assert((await firstStarResponse).status() === 200, "star API did not return 200");
    await page.waitForFunction((beforeText) => document.querySelector('[aria-label="mail-detail-star-action"]')?.textContent?.trim() !== beforeText, before);
    const secondStarResponse = page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/star"));
    await star.click();
    assert((await secondStarResponse).status() === 200, "star restore API did not return 200");
    await page.waitForFunction((beforeText) => document.querySelector('[aria-label="mail-detail-star-action"]')?.textContent?.trim() === beforeText, before);
    await page.getByRole("button", { name: "답장", exact: true }).click();
    await page.getByLabel("mail-compose-to").waitFor();
    assert((await page.getByLabel("mail-compose-to").inputValue()).length > 0, "reply recipient missing");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "닫기", exact: true }).click();
    await page.getByRole("button", { name: "전달", exact: true }).click();
    await page.getByLabel("mail-compose-subject").waitFor();
    assert((await page.getByLabel("mail-compose-subject").inputValue()).startsWith("Fwd:"), "forward subject missing");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "닫기", exact: true }).click();
    await page.getByRole("button", { name: "메일 작성", exact: true }).last().click();
    await page.getByLabel("mail-compose-to").waitFor();
    await page.getByRole("button", { name: "닫기", exact: true }).click();
    result.checks.mailRegression = ["detail", "read", "star-toggle-restore", "reply", "forward", "compose"];
  });

  await step("layout-network", async () => {
    const measurements = await page.evaluate(() => {
      const measure = (element) => element ? { clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, overflowY: getComputedStyle(element).overflowY } : null;
      const separator = document.querySelector('[role="separator"]');
      return {
        viewport: { width: innerWidth, height: innerHeight },
        page: { clientHeight: document.documentElement.clientHeight, scrollHeight: document.documentElement.scrollHeight, hasScroll: document.documentElement.scrollHeight > document.documentElement.clientHeight },
        list: measure(document.querySelector(".user-mail-list-panel")),
        detail: measure(document.querySelector(".user-mail-detail-panel")),
        separator: separator ? { role: separator.getAttribute("role"), tabIndex: separator.tabIndex, valueNow: separator.getAttribute("aria-valuenow") } : null,
      };
    });
    assert(measurements.viewport.width === 1920 && measurements.viewport.height === 1080, "viewport mismatch");
    assert(measurements.page.hasScroll === false, "whole page scroll detected");
    assert(measurements.list?.overflowY === "auto", "mail list independent scroll missing");
    assert(measurements.detail?.overflowY === "auto", "mail detail independent scroll missing");
    assert(measurements.separator?.role === "separator" && measurements.separator.tabIndex === 0, "separator accessibility mismatch");
    assert(network.length > 0, "no API requests captured");
    assert(httpErrors.every((entry) => !entry.url.includes("/api/v1/")), "API HTTP error captured");
    assert(network.every((entry) => entry.url.startsWith("http://127.0.0.1:3520/api/v1/")), "non same-origin API request captured");
    result.checks.measurements = measurements;
    result.checks.sameOriginRequests = network.length;
    await page.screenshot({ path: resolve(evidenceDir, "mail-split-view-1920x1080.png"), fullPage: false });
    await writeFile(resolve(evidenceDir, "measurements.json"), JSON.stringify(measurements, null, 2));
    await writeFile(resolve(evidenceDir, "network.json"), JSON.stringify(network, null, 2));
    await writeFile(resolve(evidenceDir, "console-errors.json"), JSON.stringify(consoleErrors, null, 2));
    await writeFile(resolve(evidenceDir, "http-errors.json"), JSON.stringify(httpErrors, null, 2));
  });

  result.status = "passed";
  result.finishedAt = new Date().toISOString();
  await writeFile(resolve(evidenceDir, "result.json"), JSON.stringify(result, null, 2));
  await record("complete", "success");
  console.log(JSON.stringify({ runId, status: result.status, evidenceDir }));
} catch (error) {
  result.status = "failed";
  result.finishedAt = new Date().toISOString();
  result.error = error instanceof Error ? error.message : String(error);
  if (page) {
    await page.screenshot({ path: resolve(evidenceDir, "failure.png"), fullPage: false }).catch(() => {});
    await writeFile(resolve(evidenceDir, "failure-dom.html"), await page.content().catch(() => "")).catch(() => {});
  }
  await writeFile(resolve(evidenceDir, "network.json"), JSON.stringify(network, null, 2)).catch(() => {});
  await writeFile(resolve(evidenceDir, "console-errors.json"), JSON.stringify(consoleErrors, null, 2)).catch(() => {});
  await writeFile(resolve(evidenceDir, "result.json"), JSON.stringify(result, null, 2)).catch(() => {});
  throw error;
} finally {
  await browser?.close().catch(() => {});
}
