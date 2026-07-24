import fs from "node:fs";
const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const api = fs.readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../src/global.css", import.meta.url), "utf8");
for (const token of ["MailExternalPanel", "설정된 외부메일이 없습니다.", "연결 테스트", "지금 수집", "서버 원본 삭제", "passwordConfigured", "expectedVersion", "externalAccountDirty"]) {
  if (!app.includes(token)) throw new Error(`UI-029 missing: ${token}`);
}
for (const token of ["/mail/settings/external-accounts", "testExternalMailAccount", "collectExternalMailAccount"]) {
  if (!api.includes(token)) throw new Error(`UI-029 API missing: ${token}`);
}
if (!css.includes("user-mail-external")) throw new Error("UI-029 CSS missing");
if (/https?:\/\/|localhost|127\.0\.0\.1|NEXT_PUBLIC_API_BASE_URL/.test(api)) throw new Error("browser API must remain same-origin");
console.log("UI-029 external-mail static verification passed.");
