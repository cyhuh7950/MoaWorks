import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const port = 43520;
const baseUrl = `http://127.0.0.1:${port}`;
const userWebRoot = fileURLToPath(new URL("..", import.meta.url));
const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
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
  assert.match(app, /async function loadTranslationState\(targetToken = token\)/, "번역 상태 loader가 명시적 토큰을 받을 수 있어야 합니다.");
  assert.match(app, /fetchTranslationStatus\(targetToken\)/, "번역 상태 조회가 명시적으로 전달된 토큰을 사용해야 합니다.");
  assert.match(app, /await loadTranslationState\(response\.accessToken\)/, "로그인 직후 번역 상태 조회는 로그인 응답 토큰을 사용해야 합니다.");
  console.log("PASS user-web unauthenticated bootstrap skips translation status");
  console.log("PASS login bootstrap uses the fresh access token for translation status");
} finally {
  await browser?.close();
  server.kill();
}
