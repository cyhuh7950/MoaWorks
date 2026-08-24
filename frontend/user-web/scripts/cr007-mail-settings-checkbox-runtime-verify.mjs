import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..");
const styles = await readFile(resolve(root, "src/global.css"), "utf8");
const browser = await chromium.launch({ channel: "chrome", headless: true });

try {
  const page = await browser.newPage();
  await page.setContent(`
    <style>${styles}</style>
    <div id="root">
      <section class="user-mail-settings">
        <fieldset>
          <label class="user-mail-setting-toggle">
            <span>발송 전 확인</span>
            <input type="checkbox" checked>
          </label>
        </fieldset>
      </section>
    </div>
  `);

  const size = await page.locator(".user-mail-setting-toggle input").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const computed = getComputedStyle(element);
    return {
      width: rect.width,
      height: rect.height,
      minHeight: computed.minHeight,
    };
  });

  assert.deepEqual(size, { width: 18, height: 18, minHeight: "18px" });
  console.log(JSON.stringify({ status: "passed", check: "CR-007 checkbox is 18x18", size }));
} finally {
  await browser.close();
}
