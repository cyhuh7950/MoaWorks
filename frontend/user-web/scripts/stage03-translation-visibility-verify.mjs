import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const app = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
const settingsStart = app.indexOf('if (activePortalMenu === "settings")');
const settingsEnd = app.indexOf('if (activePortalMenu === "help")', settingsStart);
const settingsBlock = app.slice(settingsStart, settingsEnd);

assert.ok(
  app.includes("const translationUiVisible = translationStatus?.available === true;"),
  "user translation UI visibility must follow server availability",
);
assert.ok(
  app.includes("{translationUiVisible ? (") && app.includes("번역 기능은 핵심 업무를 막지 않는 보조 도구"),
  "user translation panel must render only while the configured provider is available",
);
assert.ok(
  !app.includes("Provider: {translationStatus?.provider || \"unknown\"}"),
  "unconfigured provider placeholder must not be shown to users",
);
assert.ok(
  settingsStart >= 0 &&
    settingsEnd > settingsStart &&
    settingsBlock.includes("translationUiVisible") &&
    settingsBlock.includes('data-testid="user-translation-tool"'),
  "configured translation tool must be reachable from the current user settings route",
);

console.log("PASS stage03 user translation visibility contract (4 assertions)");
