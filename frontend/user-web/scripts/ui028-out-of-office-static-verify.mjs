import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const app = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
const api = fs.readFileSync(path.join(root, "src", "api.ts"), "utf8");
const css = fs.readFileSync(path.join(root, "src", "global.css"), "utf8");

for (const marker of ["MailOutOfOfficePanel", "부재중응답 사용", "시작일", "종료일", "응답 제목", "응답 메시지", "대상 범위", "마지막 응답 결과", "외부 발송 잠금", "activationConfirm", 'role="switch"', "CommonPopup"]) {
  if (!app.includes(marker)) throw new Error(`App.tsx missing ${marker}`);
}
const closeStart = app.indexOf("function closeMailBasicSettings()");
const closeEnd = app.indexOf("\n  function ", closeStart + 1);
const closeSection = app.slice(closeStart, closeEnd > closeStart ? closeEnd : app.length);
for (const marker of ["outOfOfficeDirty", "outOfOfficeSettings", "savedOutOfOfficeSettings", "window.confirm", "setOutOfOfficeSettings(savedOutOfOfficeSettings)"]) {
  if (!closeSection.includes(marker)) throw new Error(`closeMailBasicSettings missing ${marker}`);
}
if (!closeSection.includes("basicDirty || signatureDirty || outOfOfficeDirty")) {
  throw new Error("closeMailBasicSettings must include out-of-office changes in the shared dirty confirmation");
}
const openStart = app.indexOf("async function openMailSettings(tab: MailSettingsTab)");
const openEnd = app.indexOf("\n  async function ", openStart + 1);
const openSection = app.slice(openStart, openEnd > openStart ? openEnd : app.length);
for (const marker of ["outOfOfficeNavigationDirty", 'mailSettingsTab === "outOfOffice"', 'tab !== "outOfOffice"', "window.confirm", "setOutOfOfficeSettings(savedOutOfOfficeSettings)"]) {
  if (!openSection.includes(marker)) throw new Error(`openMailSettings missing dirty navigation guard ${marker}`);
}
if (!openSection.includes('if (outOfOfficeNavigationDirty && !window.confirm("저장하지 않은 변경을 취소하고 다른 설정으로 이동할까요?")) return;')) {
  throw new Error("openMailSettings must keep current tab and input when dirty navigation is cancelled");
}
if (openSection.indexOf("setOutOfOfficeSettings(savedOutOfOfficeSettings)") > openSection.indexOf("setMailSettingsTab(tab)")) {
  throw new Error("openMailSettings must restore saved out-of-office input before opening the target tab");
}
for (const component of ["MailBasicSettingsPanel", "MailSignatureSettingsPanel", "MailboxSettingsPanel", "MailSpamSettingsPanel", "MailAutoClassificationPanel", "MailAutoForwardingPanel"]) {
  const start = app.indexOf(`function ${component}(`);
  const end = app.indexOf("\nfunction ", start + 1);
  const section = app.slice(start, end > start ? end : app.length);
  if (start < 0) throw new Error(`App.tsx missing ${component}`);
  if (component === "MailAutoForwardingPanel") {
    if (!section.includes('"outOfOffice"')) throw new Error(`${component} missing out-of-office tab route`);
  } else if (!section.includes("onOpenOutOfOffice")) throw new Error(`${component} missing out-of-office navigation callback`);
  if (!/disabled=\{index > [67]\}/.test(section) && !section.includes(component === "MailAutoForwardingPanel" ? '"recent"' : "openRecentMailTab")) throw new Error(`${component} must enable completed mail settings tabs`);
}
if (!api.includes('/mail/settings/out-of-office')) throw new Error("api.ts missing out-of-office endpoint");
for (const forbidden of ["http://localhost", "http://127.0.0.1", "NEXT_PUBLIC_API_BASE_URL"]) {
  if (app.includes(forbidden) || api.includes(forbidden)) throw new Error(`same-origin violation: ${forbidden}`);
}
for (const marker of [".user-mail-out-of-office", "font-size: 12px", "overflow: auto", "font-size: 10px"]) {
  if (!css.includes(marker)) throw new Error(`global.css missing ${marker}`);
}
console.log("UI-028 out-of-office static verifier: PASS");
