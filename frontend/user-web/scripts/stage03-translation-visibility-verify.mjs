import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const app = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");

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

console.log("PASS stage03 user translation visibility contract (3 assertions)");
