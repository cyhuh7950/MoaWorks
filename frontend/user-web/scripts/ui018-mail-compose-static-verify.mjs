import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const app = await readFile(resolve(root, "src/App.tsx"), "utf8");
const api = await readFile(resolve(root, "src/api.ts"), "utf8");
const css = await readFile(resolve(root, "src/global.css"), "utf8");

const checks = [
  ["Cc 상태와 입력", app.includes("mailComposeForm.cc") && app.includes('aria-label="mail-compose-cc"')],
  ["Bcc 상태와 입력", app.includes("mailComposeForm.bcc") && app.includes('aria-label="mail-compose-bcc"')],
  ["공통 수신자 선택 dialog", app.includes('aria-label="메일 수신자 선택"') && app.includes("recipientPickerTarget")],
  ["최근 수신자 API", api.includes("/mail/recent-recipients")],
  ["수신자 원본 부분 실패 허용", app.includes("Promise.allSettled") && app.includes("failedSourceCount")],
  ["실제 첨부 upload", api.includes('"/mail/attachments"') && app.includes("uploadMailAttachment")],
  ["서식 editor compose", app.includes("<MailRichTextEditor") && !app.includes('<textarea aria-label="mail-compose-body"')],
  ["본문 이미지 inline upload", app.includes('uploadMailAttachment(targetToken, file, "inline")') && app.includes("fetchMailInlinePreview")],
  ["첨부 제거와 합계", app.includes("removeMailComposeAttachment") && app.includes("mailComposeAttachmentBytes")],
  ["예약 발송", app.includes("scheduledAt") && app.includes('type="datetime-local"')],
  ["draft/send 검증 분리", app.includes('action === "draft"') && app.includes("hasDraftContent")],
  ["첨부 download", api.includes("/attachments/${attachmentId}") && app.includes("downloadMailAttachment")],
  ["작성창 전용 CSS", css.includes(".user-mail-compose-recipients") && css.includes(".user-mail-compose-attachments")],
  ["storageKey DOM 비공개", !app.includes("attachment.storageKey")],
  ["same-origin 유지", !/https?:\/\/(?:localhost|127\.0\.0\.1|server|[^/]+:\d+)\/api\//.test(app + api)],
];

const failures = checks.filter(([, passed]) => !passed);
for (const [name, passed] of checks) console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
if (failures.length) process.exitCode = 1;
