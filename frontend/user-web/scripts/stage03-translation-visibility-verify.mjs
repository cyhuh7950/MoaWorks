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
  app.includes('translationUiVisible && isInboxDetail') &&
    app.includes('aria-label="발신 메일 번역"') &&
    app.includes("번역 기본 언어") &&
    app.includes("발신 번역 방식"),
  "translation controls must be limited to inbound detail, outbound compose, and mail settings",
);
assert.ok(
  !app.includes('data-testid="user-translation-tool"') &&
    !app.includes("번역 기능은 핵심 업무를 막지 않는 보조 도구"),
  "generic profile translation tool must not render",
);
assert.ok(
  !app.includes("Provider: {translationStatus?.provider || \"unknown\"}"),
  "unconfigured provider placeholder must not be shown to users",
);
assert.ok(
  api.includes("fetchTranslationStatus(token: string)") &&
    api.includes('request<{ available: boolean; enabled: boolean; provider: string }>("/translation/status", {') &&
    api.includes("headers: authHeaders(token)") &&
    app.includes("fetchTranslationStatus(targetToken)"),
  "user translation status must use the authenticated tenant policy",
);
assert.ok(
  app.includes('normalizeClientError(error, "메일 번역 실패")') &&
    app.includes("setTranslationError") &&
    app.includes("showTranslatedMail ?"),
  "failed contextual translation must preserve the original mail and expose an error",
);

console.log("PASS stage03 contextual mail translation visibility contract (6 assertions)");
