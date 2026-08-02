import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

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
const check = (name, callback) => {
  try { callback(); checks.push([name, true]); }
  catch (error) { checks.push([name, false, error.message]); }
};

check("mail compose defaults to centered 960x760", () => {
  const normal = rule(".user-mail-compose-popup");
  assert.match(normal, /left:\s*50%/);
  assert.match(normal, /top:\s*50%/);
  assert.match(normal, /transform:\s*translate\(-50%,\s*-50%\)/);
  assert.match(normal, /width:\s*min\(960px,\s*calc\(100vw\s*-\s*48px\)\)/);
  assert.match(normal, /height:\s*min\(760px,\s*calc\(100vh\s*-\s*48px\)\)/);
});

check("mail compose maximizes to a 12px viewport margin", () => {
  const maximized = rule(".user-mail-compose-popup.is-maximized");
  assert.match(maximized, /inset:\s*12px/);
  assert.match(maximized, /width:\s*auto/);
  assert.match(maximized, /height:\s*auto/);
  assert.match(maximized, /transform:\s*none/);
});

check("mail compose minimizes to a compact bottom-right titlebar", () => {
  const minimized = rule(".user-mail-compose-popup.is-minimized");
  assert.match(minimized, /left:\s*auto/);
  assert.match(minimized, /top:\s*auto/);
  assert.match(minimized, /right:\s*20px/);
  assert.match(minimized, /bottom:\s*20px/);
  assert.match(minimized, /width:\s*min\(360px,\s*calc\(100vw\s*-\s*24px\)\)/);
  assert.match(rule(".user-mail-compose-popup.is-minimized .user-mail-compose-body"), /display:\s*none/);
});

check("mail compose body receives remaining vertical space", () => {
  assert.match(rule(".user-mail-compose-popup"), /grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)/);
  assert.match(rule(".user-mail-compose-body"), /overflow:\s*auto/);
  assert.match(rule(".user-mail-compose-field.is-body"), /min-height:\s*0/);
  assert.match(app, /className="user-mail-compose-field is-body"[\s\S]*?<span>본문<\/span>[\s\S]*?aria-label="mail-compose-body"/);
});

check("only approval compose opts into CommonPopup maximize", () => {
  assert.match(popup, /maximizable\?:\s*boolean/);
  assert.match(popup, /floating\s*\|\|\s*maximizable/);
  const optIns = [...app.matchAll(/\bmaximizable(?:=\{true\})?/g)];
  assert.equal(optIns.length, 1, "maximizable must be enabled exactly once");
  const composePopup = app.match(/<CommonPopup[\s\S]*?className="ui033-compose-popup"[\s\S]*?>/);
  assert.ok(composePopup, "approval compose popup missing");
  assert.match(composePopup[0], /\bmaximizable\b/);
});

check("approval compose prioritizes a 300px body and bounded attachments", () => {
  assert.match(rule(".ui033-compose__panel"), /minmax\(300px,\s*1fr\)/);
  assert.match(rule(".ui033-compose__content textarea"), /min-height:\s*300px/);
  assert.match(rule(".ui033-compose__attachments"), /max-height:\s*150px/);
  assert.match(rule(".ui033-file-list"), /overflow:\s*auto/);
});

check("approval maximize and mobile viewport margins remain bounded", () => {
  const maximized = rule(".ui033-compose-popup.is-maximized");
  assert.match(maximized, /width:\s*calc\(100vw\s*-\s*24px\)/);
  assert.match(maximized, /height:\s*calc\(100vh\s*-\s*24px\)/);
  assert.match(css, /@media\s*\(max-width:\s*720px\)[\s\S]*?\.ui033-compose-popup\s*\{[^}]*width:\s*calc\(100vw\s*-\s*24px\)[^}]*height:\s*calc\(100vh\s*-\s*24px\)/);
});

for (const [name, passed, error] of checks) console.log(`${passed ? "PASS" : "FAIL"} ${name}${error ? `: ${error}` : ""}`);
const failures = checks.filter(([, passed]) => !passed);
console.log(`${checks.length - failures.length}/${checks.length} PASS`);
if (failures.length) process.exit(1);
