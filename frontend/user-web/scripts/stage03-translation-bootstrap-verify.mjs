import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const port = 43520;
const baseUrl = `http://127.0.0.1:${port}`;
const userWebRoot = fileURLToPath(new URL("..", import.meta.url));
const viteBin = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
const server = spawn(process.execPath, [viteBin, "--host", "127.0.0.1", "--port", String(port)], {
  cwd: userWebRoot,
  stdio: "ignore",
});

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("USER_WEB_DEV_SERVER_TIMEOUT");
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const translationCalls = [];

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/api/v1/translation/status") {
      translationCalls.push({ authorization: request.headers().authorization ?? "" });
    }
    if (pathname === "/api/v1/ui-contract") {
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      return;
    }
    await route.fulfill({ status: 401, contentType: "application/json", body: "{}" });
  });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  assert.deepEqual(
    translationCalls,
    [],
    "로그인 토큰이 없는 초기 화면은 /translation/status를 호출하지 않아야 합니다.",
  );
  console.log("PASS user-web unauthenticated bootstrap skips translation status");
} finally {
  await browser?.close();
  server.kill();
}
