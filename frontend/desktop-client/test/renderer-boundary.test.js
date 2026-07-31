const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const renderer = fs.readFileSync(path.join(root, "index.html"), "utf8");
const main = fs.readFileSync(path.join(root, "electron", "main.js"), "utf8");

test("renderer delegates privileged operations without direct network or session access", () => {
  assert.match(renderer, /window\.moaworksDesktop/);
  assert.doesNotMatch(renderer, /\bfetch\s*\(/);
  assert.doesNotMatch(renderer, /moaworks\.(?:userToken|apiBase)/);
  assert.doesNotMatch(renderer, /\bAuthorization\b/);
  assert.doesNotMatch(renderer, /https?:\/\/[^"'\s]+\/api\/v1/);
});

test("BrowserWindow enforces the approved Electron isolation boundary", () => {
  assert.match(main, /preload\s*:/);
  assert.match(main, /nodeIntegration\s*:\s*false/);
  assert.match(main, /contextIsolation\s*:\s*true/);
  assert.match(main, /sandbox\s*:\s*true/);
});

test("preload exposes only named desktop operations", () => {
  const preload = fs.readFileSync(path.join(root, "electron", "preload.js"), "utf8");
  for (const operation of ["getAppInfo", "login", "logout", "request", "saveArchive", "showArchive"]) {
    assert.match(preload, new RegExp(`${operation}\\s*:`));
  }
  assert.doesNotMatch(preload, /invoke\s*:\s*\([^)]*channel/);
});

test("offline archive button delegates reopening to the approved desktop API", () => {
  assert.match(renderer, /onclick="showLatestArchive\(\)"[^>]*>오프라인 보기<\/button>/);
  assert.match(renderer, /async function showLatestArchive\(\)/);
  assert.match(renderer, /await desktopApi\.showArchive\(\)/);
  assert.match(renderer, /result\.shown/);
});
