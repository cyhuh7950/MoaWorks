import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "../../..");
const evidence = resolve(root, "docs/evidence/phase5-mail-popup");
await mkdir(evidence, { recursive: true });
const network = [];
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on("request", (request) => {
  if (!request.url().includes("/api/v1/")) return;
  const url = new URL(request.url());
  if (url.searchParams.has("token")) url.searchParams.set("token", "[REDACTED]");
  network.push(url.toString());
});

await page.goto("http://127.0.0.1:3520/", { waitUntil: "networkidle" });
await page.locator("input").first().fill("admin");
await page.locator('input[type="password"]').fill("m@68150183");
await page.getByRole("button", { name: /로그인/i }).click();
await page.waitForSelector('button:has-text("메일")');
await page.getByRole("button", { name: /메일.*건 확인/ }).click();
await page.getByRole("button", { name: /메일 작성|편지 쓰기/ }).click();
await page.getByLabel("mail-compose-to").fill("admin@moaworks.local");
await page.getByLabel("mail-compose-subject").fill("verify.phase5.popup");
await page.getByLabel("mail-compose-body").fill("popup verification");
await page.getByRole("button", { name: "최소화" }).click();
await page.getByRole("button", { name: "최소화" }).click();
await page.getByRole("button", { name: "확대" }).click();
await page.getByRole("button", { name: "확대" }).click();
await page.getByRole("button", { name: "발송" }).click();
await page.getByText("받은편지함", { exact: true }).first().click();
await page.getByText("verify.phase5.popup", { exact: true }).first().click();
await page.getByRole("button", { name: "답장", exact: true }).click();
await page.getByLabel("mail-compose-to").waitFor();
if ((await page.getByLabel("mail-compose-to").inputValue()) !== "admin@moaworks.local") throw new Error("답장 수신자 불일치");
if (!(await page.getByLabel("mail-compose-subject").inputValue()).startsWith("Re: verify.phase5.popup")) throw new Error("답장 제목 불일치");
page.once("dialog", (dialog) => dialog.accept());
await page.getByRole("button", { name: "닫기", exact: true }).click();
await page.getByRole("button", { name: "전달", exact: true }).click();
await page.getByLabel("mail-compose-to").waitFor();
if (await page.getByLabel("mail-compose-to").inputValue()) throw new Error("전달 수신자가 비어 있지 않습니다.");
if (!(await page.getByLabel("mail-compose-subject").inputValue()).startsWith("Fwd: verify.phase5.popup")) throw new Error("전달 제목 불일치");
if (!(await page.getByLabel("mail-compose-body").inputValue()).includes("--- 원문 ---")) throw new Error("전달 인용 본문 누락");
page.once("dialog", (dialog) => dialog.accept());
await page.getByRole("button", { name: "닫기", exact: true }).click();
await page.screenshot({ path: resolve(evidence, "mail-popup.png"), fullPage: false });
const measurements = await page.evaluate(() => ({
  scrollHeight: document.documentElement.scrollHeight,
  clientHeight: document.documentElement.clientHeight,
  pageHasScroll: document.documentElement.scrollHeight > document.documentElement.clientHeight,
}));
if (measurements.pageHasScroll) throw new Error("전체 페이지 스크롤이 남아 있습니다.");
if (network.some((url) => !url.startsWith("http://127.0.0.1:3520/api/v1/"))) throw new Error("same-origin API 위반");
await writeFile(resolve(evidence, "measurements.json"), JSON.stringify(measurements, null, 2));
await writeFile(resolve(evidence, "network.json"), JSON.stringify(network, null, 2));
await browser.close();
