import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const api = read("src/api.ts");
const app = read("src/App.tsx");
const settings = read("src/SettingsHelpPanel.tsx");
const panels = read("src/WorkspacePanels.tsx");
const css = read("src/global.css");

const checks = [
  [api.includes('request<WorkspaceProfile>("/workspace/profile", { method: "PUT"'), "personal profile update API"],
  [api.includes("/workspace/profile/photo?expectedVersion="), "versioned profile photo API"],
  [api.includes("cache: \"no-store\""), "private photo fetch avoids browser cache"],
  [settings.includes("이름·회사·부서·역할·계정 이메일은 조직 관리 정보"), "organization fields stay read-only"],
  [settings.includes("externalEmail") && settings.includes("mobilePhone") && settings.includes("officePhone"), "personal contact fields"],
  [settings.includes("introduction") && settings.includes("postalCode") && settings.includes("addressLine1") && settings.includes("memo") && settings.includes("anniversary"), "personal profile detail fields"],
  [settings.includes('accept="image/jpeg,image/png,image/webp"'), "profile photo selection restricts file types"],
  [app.includes('aria-label="내 프로필 수정"') && app.includes('setPortalMenu("settings")'), "header profile opens settings"],
  [app.includes("headerProfilePhotoUrl") && app.includes("fetchWorkspaceProfilePhoto"), "registered photo is shown in header"],
  [panels.includes("onProfileSaved"), "saved profile refreshes header"],
  [css.includes(".user-profile-entry__avatar") && css.includes("object-fit:cover"), "avatar is consistently cropped"],
];

for (const [passed, label] of checks) assert.ok(passed, label);
console.log(`CR-033 personal profile verifier: ${checks.length}/${checks.length} passed`);
