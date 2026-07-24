import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const app = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
const api = fs.readFileSync(path.join(root, "src", "api.ts"), "utf8");
const css = fs.readFileSync(path.join(root, "src", "global.css"), "utf8");
for (const marker of ["MailAutoForwardingPanel", "자동전달 사용", "원본 보관", "자동전달 메일 주소", "예외 자동전달 규칙", "외부 발송 잠금", "대체 주소로 전달", "전달 안 함", "activationConfirm", "role=\"switch\"", "CommonPopup"]) {
  if (!app.includes(marker)) throw new Error(`App.tsx missing ${marker}`);
}
for (const component of ["MailSignatureSettingsPanel", "MailboxSettingsPanel", "MailSpamSettingsPanel"]) {
  const start = app.indexOf(`function ${component}(`);
  const end = app.indexOf("\nfunction ", start + 1);
  const section = app.slice(start, end > start ? end : app.length);
  if (start < 0) throw new Error(`App.tsx missing ${component}`);
  if (!section.includes("onOpenForwarding")) throw new Error(`${component} missing auto-forward navigation callback`);
  if (!/disabled=\{index > [67]\}/.test(section) && !section.includes("openRecentMailTab")) throw new Error(`${component} must preserve completed settings tabs`);
}
for (const component of ["MailSignatureSettingsPanel", "MailboxSettingsPanel", "MailSpamSettingsPanel"]) {
  const marker = `<${component}`;
  const start = app.indexOf(marker);
  const end = app.indexOf("/>", start);
  const render = app.slice(start, end + 2);
  if (!render.includes('onOpenForwarding={() => void openMailSettings("forwarding")}')) {
    throw new Error(`${component} render missing auto-forward navigation callback`);
  }
}
for (const endpoint of ["/mail/settings/auto-forwarding", "/mail/settings/auto-forwarding/targets", "/mail/settings/auto-forwarding/targets/delete", "/mail/settings/auto-forwarding/exceptions", "/mail/settings/auto-forwarding/exceptions/delete"]) {
  if (!api.includes(endpoint)) throw new Error(`api.ts missing ${endpoint}`);
}
for (const forbidden of ["http://localhost", "http://127.0.0.1", "NEXT_PUBLIC_API_BASE_URL"]) {
  if (app.includes(forbidden) || api.includes(forbidden)) throw new Error(`same-origin violation: ${forbidden}`);
}
for (const marker of [".user-mail-auto-forwarding", "font-size: 12px", "overflow: auto", "font-size: 10px"]) {
  if (!css.includes(marker)) throw new Error(`global.css missing ${marker}`);
}
console.log("UI-027 auto forwarding static verifier: PASS");
