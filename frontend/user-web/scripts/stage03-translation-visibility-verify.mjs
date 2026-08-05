import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const app = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
const api = fs.readFileSync(path.join(root, "src", "api.ts"), "utf8");
const workspacePanels = fs.readFileSync(path.join(root, "src", "WorkspacePanels.tsx"), "utf8");
const settingsHelpPanel = fs.readFileSync(path.join(root, "src", "SettingsHelpPanel.tsx"), "utf8");

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
  app.includes("const translationTool = translationUiVisible ? (") &&
    app.includes('data-testid="user-translation-tool"') &&
    app.includes("translationTool={translationTool}") &&
    workspacePanels.includes("translationTool?: React.ReactNode") &&
    workspacePanels.includes("translationTool={translationTool}") &&
    settingsHelpPanel.includes("translationTool?: React.ReactNode") &&
    settingsHelpPanel.includes("{settingsDetail}{translationTool}"),
  "configured translation tool must be reachable from the current user settings route",
);
assert.ok(
  api.includes("fetchTranslationStatus(token: string)") &&
    api.includes('request<{ available: boolean; enabled: boolean; provider: string }>("/translation/status", {') &&
    api.includes("headers: authHeaders(token)") &&
    app.includes("fetchTranslationStatus(token)"),
  "user translation status must use the authenticated tenant policy",
);
assert.ok(
  app.includes('data-testid="translation-fallback-status"') &&
    app.includes("원문을 유지했습니다."),
  "user translation fallback must explain the safe original-text recovery",
);

console.log("PASS stage03 user translation visibility contract (6 assertions)");
