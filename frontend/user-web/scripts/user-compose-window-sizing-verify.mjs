import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const app = read("src/App.tsx");
const popup = read("src/components/CommonPopup.tsx");
const css = read("src/global.css");

const rule = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|})\\s*${escaped}\\s*\\{([^}]*)\\}`, "m"));
  assert.ok(match, `${selector} rule missing`);
  return match[1];
};

const checks = [];
const check = async (name, callback) => {
  try { await callback(); checks.push([name, true]); }
  catch (error) { checks.push([name, false, error.message]); }
};

let browser;
const measurements = {};
const measure = async (name, markup, selector) => {
  browser ??= await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  try {
    await page.setContent(`<style>${css}</style>${markup}`);
    const box = await page.locator(selector).boundingBox();
    assert.ok(box, `${selector} bounding box missing`);
    const rounded = Object.fromEntries(Object.entries(box).map(([key, value]) => [key, Math.round(value)]));
    measurements[name] = rounded;
    return rounded;
  } finally {
    await page.close();
  }
};
const mailMarkup = (mode) => `<form class="user-mail-compose-popup is-${mode}"><div class="user-mail-compose-titlebar"></div><div class="user-mail-compose-body"></div></form>`;
const approvalMarkup = (mode) => `<div class="common-popup-backdrop"><section class="common-popup ui033-compose-popup is-${mode}"><header class="common-popup-header"></header><p class="common-popup-description"></p><div class="common-popup-body"><form class="ui033-compose"><div class="ui033-compose__tabs"></div><section class="ui033-compose__panel"><label><input></label><label class="ui033-compose__content"><textarea></textarea></label><section class="ui033-compose__attachments"><header></header><div></div><div class="ui033-file-list"></div></section></section><footer class="ui033-compose__footer"></footer></form></div></section></div>`;
const translationMarkup = `<div class="common-popup-backdrop"><section class="common-popup user-mail-translation-popup is-normal"><header class="common-popup-header"></header><div class="common-popup-body"><section class="user-mail-translation-workspace"><header></header><div class="user-mail-translation-comparison"><article></article><article></article></div><footer></footer></section></div></section></div>`;

await check("mail compose defaults to centered 960x760", async () => {
  const normal = rule(".user-mail-compose-popup");
  assert.match(normal, /left:\s*50%/);
  assert.match(normal, /top:\s*50%/);
  assert.match(normal, /transform:\s*translate\(-50%,\s*-50%\)/);
  assert.match(normal, /width:\s*min\(960px,\s*calc\(100vw\s*-\s*48px\)\)/);
  assert.match(normal, /height:\s*min\(760px,\s*calc\(100vh\s*-\s*48px\)\)/);
  assert.deepEqual(await measure("mailNormal", mailMarkup("normal"), ".user-mail-compose-popup"), { x: 480, y: 160, width: 960, height: 760 });
});

await check("mail compose maximizes to a 12px viewport margin", async () => {
  const maximized = rule(".user-mail-compose-popup.is-maximized");
  assert.match(maximized, /inset:\s*12px/);
  assert.match(maximized, /width:\s*calc\(100vw\s*-\s*24px\)/);
  assert.match(maximized, /height:\s*calc\(100vh\s*-\s*24px\)/);
  assert.match(maximized, /transform:\s*none/);
  assert.deepEqual(await measure("mailMaximized", mailMarkup("maximized"), ".user-mail-compose-popup"), { x: 12, y: 12, width: 1896, height: 1056 });
});

await check("mail compose minimizes to a compact bottom-right titlebar", () => {
  const minimized = rule(".user-mail-compose-popup.is-minimized");
  assert.match(minimized, /left:\s*auto/);
  assert.match(minimized, /top:\s*auto/);
  assert.match(minimized, /right:\s*20px/);
  assert.match(minimized, /bottom:\s*20px/);
  assert.match(minimized, /width:\s*min\(360px,\s*calc\(100vw\s*-\s*24px\)\)/);
  assert.match(rule(".user-mail-compose-popup.is-minimized .user-mail-compose-body"), /display:\s*none/);
});

await check("mail compose maximize control exposes restore action in maximized state", () => {
  assert.match(app, /setComposeWindow\(\(current\) => current === "maximized" \? "normal" : "maximized"\)/);
  assert.match(app, /composeWindow === "maximized" \? "원래 크기" : "확대"/);
});
await check("mail compose body receives remaining vertical space", () => {
  assert.match(rule(".user-mail-compose-popup"), /grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)/);
  assert.match(rule(".user-mail-compose-body"), /overflow:\s*auto/);
  assert.match(rule(".user-mail-compose-field.is-body"), /min-height:\s*0/);
  assert.match(app, /className="user-mail-compose-field is-body"[\s\S]*?<span>본문<\/span>[\s\S]*?aria-label="mail-compose-body"/);
});

await check("approval compose and mail translation comparison opt into CommonPopup maximize", () => {
  assert.match(popup, /maximizable\?:\s*boolean/);
  assert.match(popup, /floating\s*\|\|\s*maximizable/);
  const optIns = [...app.matchAll(/\bmaximizable(?:=\{true\})?/g)];
  assert.equal(optIns.length, 2, "maximizable must be enabled for the two approved workspaces");
  const composePopup = app.match(/<CommonPopup[\s\S]*?className="ui033-compose-popup"[\s\S]*?>/);
  assert.ok(composePopup, "approval compose popup missing");
  assert.match(composePopup[0], /\bmaximizable\b/);
  const translationPopup = app.match(/<CommonPopup[^>]*title="메일 번역 미리보기"[^>]*className="user-mail-translation-popup"[^>]*>/);
  assert.ok(translationPopup, "mail translation comparison popup missing");
  assert.match(translationPopup[0], /\bmaximizable\b/);
});

await check("common popups escape transformed compose ancestors through a body portal", () => {
  assert.match(popup, /import\s+\{[^}]*createPortal[^}]*\}\s+from\s+[\"']react-dom[\"']/s);
  assert.match(popup, /createPortal\(popupContent,\s*document\.body\)/);
});

await check("mail translation comparison opens as a wide two-column workspace", async () => {
  assert.match(rule(".common-popup.user-mail-translation-popup"), /width:\s*min\(1100px,\s*calc\(100vw\s*-\s*48px\)\)/);
  assert.match(rule(".user-mail-translation-comparison"), /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/);
  const measured = await measure("translationNormal", translationMarkup, ".user-mail-translation-popup");
  assert.equal(measured.width, 1100);
});

await check("approval compose prioritizes a 300px body and bounded attachments", async () => {
  assert.match(rule(".ui033-compose__panel"), /minmax\(300px,\s*1fr\)/);
  assert.match(rule(".ui033-compose__content textarea"), /min-height:\s*300px/);
  assert.match(rule(".ui033-compose__attachments"), /max-height:\s*150px/);
  assert.match(rule(".ui033-file-list"), /overflow:\s*auto/);
  assert.deepEqual(await measure("approvalNormal", approvalMarkup("normal"), ".ui033-compose-popup"), { x: 480, y: 160, width: 960, height: 760 });
});

await check("approval maximize and mobile viewport margins remain bounded", async () => {
  const maximized = rule(".ui033-compose-popup.is-maximized");
  assert.match(maximized, /position:\s*fixed/);
  assert.match(maximized, /inset:\s*12px/);
  assert.match(maximized, /width:\s*calc\(100vw\s*-\s*24px\)/);
  assert.match(maximized, /height:\s*calc\(100vh\s*-\s*24px\)/);
  assert.match(maximized, /transform:\s*none/);
  assert.match(css, /@media\s*\(max-width:\s*720px\)[\s\S]*?\.ui033-compose-popup\s*\{[^}]*width:\s*calc\(100vw\s*-\s*24px\)[^}]*height:\s*calc\(100vh\s*-\s*24px\)/);
  assert.deepEqual(await measure("approvalMaximized", approvalMarkup("maximized"), ".ui033-compose-popup"), { x: 12, y: 12, width: 1896, height: 1056 });
});

await browser?.close();

for (const [name, passed, error] of checks) console.log(`${passed ? "PASS" : "FAIL"} ${name}${error ? `: ${error}` : ""}`);
console.log(`MEASUREMENTS ${JSON.stringify({ viewport: { width: 1920, height: 1080 }, ...measurements })}`);
const failures = checks.filter(([, passed]) => !passed);
console.log(`${checks.length - failures.length}/${checks.length} PASS`);
if (failures.length) process.exit(1);
