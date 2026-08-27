import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..");
const evidence = resolve(root, "evidence", "phase5-mail-popup");
const qa = `${crypto.randomUUID()}@phase5.invalid`;
const password = crypto.randomUUID();
const fixturePort = 3521;
const webPort = 3520;
const env = { ...process.env, PHASE5_QA_EMAIL: qa, PHASE5_QA_PASSWORD: password, PHASE5_FIXTURE_PORT: String(fixturePort), VITE_PROXY_TARGET: `http://127.0.0.1:${fixturePort}` };
const children = [];
const start = (command, args) => new Promise((resolveReady, rejectReady) => {
  const child = spawn(command, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  let output = "";
  const receive = (chunk) => { output += String(chunk); };
  child.stdout.on("data", receive); child.stderr.on("data", receive); child.once("exit", (code) => rejectReady(new Error(`phase5 child exited ${code}`)));
  setTimeout(() => resolveReady(child), 250);
});
const waitFor = async (url) => { for (let attempt = 0; attempt < 80; attempt += 1) { try { if ((await fetch(url)).ok) return; } catch {} await new Promise((resolve) => setTimeout(resolve, 100)); } throw new Error(`phase5 ready timeout: ${url}`); };
const stop = async () => {
  const exits = [];
  for (const child of children.reverse()) {
    if (child.exitCode !== null) continue;
    exits.push(new Promise((resolveExit) => {
      const timeout = setTimeout(() => { if (child.exitCode === null) child.kill("SIGKILL"); }, 2_000);
      child.once("exit", () => { clearTimeout(timeout); resolveExit(); });
      child.kill("SIGTERM");
    }));
  }
  await Promise.allSettled(exits);
};

let browser;
try {
  process.stdout.write("PHASE5_STEP setup\n");
  await rm(evidence, { recursive: true, force: true }); await mkdir(evidence, { recursive: true });
  await start(process.execPath, [resolve(root, "scripts", "phase5-mail-popup-fixture-server.mjs")]);
  await waitFor(`http://127.0.0.1:${fixturePort}/health`);
  const wrongLogin = await fetch(`http://127.0.0.1:${fixturePort}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: qa, password: `${password}-wrong` }) });
  if (wrongLogin.status !== 401) throw new Error("phase5 fixture accepted invalid credentials");
  const unknownResponse = await fetch(`http://127.0.0.1:${fixturePort}/api/v1/phase5-unknown`);
  if (unknownResponse.status !== 404) throw new Error("phase5 fixture accepted an unknown route");
  const wrongMethod = await fetch(`http://127.0.0.1:${fixturePort}/api/v1/mail/inbox`, { method: "POST" });
  if (wrongMethod.status !== 405) throw new Error("phase5 fixture accepted a wrong method");
  await start(process.execPath, [resolve(root, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", String(webPort)]);
  await waitFor(`http://127.0.0.1:${webPort}/`);
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 650 } });
  page.setDefaultTimeout(5_000);
  const network = [];
  const apiResponses = [];
  const pageErrors = [];
  page.on("request", (request) => { if (request.url().includes("/api/")) network.push(new URL(request.url()).origin); });
  page.on("response", (response) => { const url = new URL(response.url()); if (url.pathname.startsWith("/api/")) apiResponses.push({ path: url.pathname, status: response.status() }); });
  page.on("pageerror", (error) => pageErrors.push(error.message.replaceAll(qa, "<redacted>").replaceAll(password, "<redacted>")));
  await page.goto(`http://127.0.0.1:${webPort}/`, { waitUntil: "networkidle" });
  process.stdout.write("PHASE5_STEP login\n");
  await page.getByLabel("아이디").fill(qa.split("@", 1)[0]);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: /로그인/i }).click();
  process.stdout.write("PHASE5_STEP mail-menu\n");
  await page.locator(".user-app-rail-menu").waitFor({ state: "visible" });
  await page.locator(".user-app-rail-item").filter({ hasText: /^메일/ }).click();
  process.stdout.write("PHASE5_STEP compose-entry\n");
  const composeButton = page.getByRole("button", { name: "메일쓰기" });
  const composeVisible = await composeButton.isVisible({ timeout: 5_000 }).catch(() => false);
  const loginVisible = await page.getByLabel("아이디").isVisible().catch(() => false);
  const portalVisible = await page.locator(".user-app-rail-menu").isVisible().catch(() => false);
  const storedToken = await page.evaluate(() => Boolean(window.localStorage.getItem("moaworks.userToken")));
  const activeMenu = await page.locator(".user-app-rail-item[aria-current='page']").textContent().catch(() => null);
  await writeFile(resolve(evidence, "result.json"), JSON.stringify({ localOnly: true, stage: "post-login", composeVisible, loginVisible, portalVisible, storedToken, activeMenu, apiResponses, pageErrors }, null, 2));
  if (!composeVisible) throw new Error("phase5 local App did not reach the compose entrypoint");
  await composeButton.click();
  await page.getByLabel("mail-compose-to").fill("receiver@phase5.invalid");
  await page.getByLabel("mail-compose-subject").fill("phase5 local fixture");
  const boldButton = page.getByRole("button", { name: /굵게/ });
  await boldButton.click();
  const boldPressed = await boldButton.getAttribute("aria-pressed") === "true";
  if (!boldPressed) throw new Error("phase5 rich editor bold state did not change");
  const editorSurface = page.locator(".mail-rich-text-editor__surface");
  await editorSurface.fill(Array.from({ length: 18 }, (_, index) => `rich compose line ${index + 1}`).join("\n"));
  const draftButton = page.getByRole("button", { name: "임시저장" });
  await draftButton.scrollIntoViewIfNeeded();
  const draftButtonBox = await draftButton.boundingBox();
  if (!draftButtonBox) throw new Error("phase5 draft button has no layout box");
  const draftHitTest = await page.evaluate(({ x, y }) => {
    const draft = [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "임시저장");
    const hit = document.elementFromPoint(x, y);
    const bodyField = document.querySelector(".user-mail-compose-field.is-body");
    const editor = document.querySelector(".mail-rich-text-editor");
    const surface = document.querySelector(".mail-rich-text-editor__surface");
    const actions = document.querySelector(".user-mail-compose-submit-actions");
    const rect = (element) => element ? Object.fromEntries(["x", "y", "width", "height"].map((key) => [key, element.getBoundingClientRect()[key]])) : null;
    return {
      topmost: Boolean(draft && hit && (hit === draft || draft.contains(hit))),
      hit: hit ? `${hit.tagName}.${hit.className}` : null,
      bodyField: rect(bodyField), editor: rect(editor), surface: rect(surface), actions: rect(actions),
    };
  }, { x: draftButtonBox.x + draftButtonBox.width / 2, y: draftButtonBox.y + draftButtonBox.height / 2 });
  const draftButtonIsTopmost = draftHitTest.topmost;
  if (!draftButtonIsTopmost) throw new Error(`phase5 rich editor content covers the draft action: ${JSON.stringify(draftHitTest)}`);
  await page.screenshot({ path: resolve(evidence, "compose.png"), fullPage: false });
  if (network.some((origin) => origin !== `http://127.0.0.1:${webPort}`)) throw new Error("phase5 used a non-local API origin");
  if (pageErrors.length) throw new Error(`phase5 page errors: ${pageErrors.join(" | ")}`);
  if (apiResponses.some(({ status }) => status >= 400)) throw new Error("phase5 received a failing API response");
  await writeFile(resolve(evidence, "result.json"), JSON.stringify({ localOnly: true, stage: "rich-compose", composeVisible, loginVisible, portalVisible, storedToken, activeMenu, boldPressed, draftButtonIsTopmost, fixtureGuards: { wrongLogin: wrongLogin.status, unknownRoute: unknownResponse.status, wrongMethod: wrongMethod.status }, networkCount: network.length, apiResponses, pageErrors }, null, 2));
  process.stdout.write("PHASE5_PASS\n");
} catch (error) {
  process.stderr.write(`PHASE5_FAIL ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally { await browser?.close(); await stop(); }
