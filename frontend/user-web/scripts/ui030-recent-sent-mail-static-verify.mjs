import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const app = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
const api = fs.readFileSync(path.join(root, "src", "api.ts"), "utf8");
const css = fs.readFileSync(path.join(root, "src", "global.css"), "utf8");
const checks = [
  ["recent tab enabled", app.includes('"recent"') && app.includes('aria-current={index===8?"page":undefined}')],
  ["settings list", app.includes("최근 보낸 메일주소가 없습니다.") && app.includes("최근 보낸메일 주소 목록")],
  ["selection and delete", app.includes("선택 삭제") && app.includes("전체 삭제") && app.includes("전체 선택")],
  ["confirmation and busy", app.includes("최근 주소 삭제 확인") && app.includes("busy={busy}")],
  ["reload", app.includes("새로고침") && app.includes("loadRecentRecipients")],
  ["tooltip", app.includes("최근 주소는 실제 발송 완료 시")],
  ["same origin settings API", api.includes('request<MailRecentRecipientSettingsResponse>("/mail/settings/recent-recipients"')],
  ["same origin bulk delete", api.includes('"/mail/settings/recent-recipients/bulk-delete"')],
  ["same origin individual delete", api.includes('`/mail/settings/recent-recipients/${recipientId}`')],
  ["table scroll", css.includes(".user-mail-recent__table-wrap") && css.includes("overflow: auto")],
  ["12px standard", css.includes(".user-mail-recent") && css.includes("font-size: 12px")],
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error(JSON.stringify({ status: "FAIL", failed: failed.map(([name]) => name) }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ status: "PASS", checks: checks.length }, null, 2));
