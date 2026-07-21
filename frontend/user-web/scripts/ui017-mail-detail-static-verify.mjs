import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const api = fs.readFileSync(path.join(root, "src", "api.ts"), "utf8");
const app = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src", "global.css"), "utf8");
const failures = [];

function requireText(source, expected, message) {
  if (!source.includes(expected)) failures.push(message);
}

requireText(api, "export type MailAttachmentView", "상세 응답용 첨부 타입이 없습니다.");
requireText(api, "attachments: MailAttachmentView[]", "메일 상세가 안전한 첨부 view를 사용하지 않습니다.");
requireText(api, 'request<MailDetail>(`/mail/${mailId}`', "메일 상세가 same-origin 상대 경로를 사용하지 않습니다.");
requireText(app, "mailDetailLoading", "상세 전용 loading 상태가 없습니다.");
requireText(app, "mailDetailError", "상세 전용 error 상태가 없습니다.");
requireText(app, "loadMailDetail", "상세만 재조회하는 함수가 없습니다.");
requireText(app, "withMailSubjectPrefix", "답장/전달 제목 prefix 중복 방지 함수가 없습니다.");
requireText(app, 'recipientKind === "to"', "To 수신자 그룹이 없습니다.");
requireText(app, 'recipientKind === "cc"', "Cc 수신자 그룹이 없습니다.");
requireText(app, "formatFileSize", "첨부 크기 표시 함수가 없습니다.");
requireText(app, "canReplyToSelectedMail", "메일함별 답장 노출 계약이 없습니다.");
requireText(app, "canForwardSelectedMail", "메일함별 전달 노출 계약이 없습니다.");
for (const name of ["user-mail-detail-header", "user-mail-detail-meta", "user-mail-detail-actions", "user-mail-detail-body", "user-mail-detail-attachments"]) {
  requireText(app, `className="${name}`, `${name} 화면 구조가 없습니다.`);
  requireText(css, `.${name}`, `${name} CSS가 없습니다.`);
}
requireText(app, 'storageKey="moaworks.user.mail.split-ratio.v1"', "기존 SplitView 저장 키를 재사용하지 않습니다.");
requireText(css, "white-space: pre-wrap", "plain text 본문 줄바꿈 유지가 없습니다.");

for (const value of ["dangerouslySetInnerHTML", "item.provider", "item.attemptCount", "item.lastError"]) {
  if (app.includes(value)) failures.push(`상세 화면 금지 렌더링이 있습니다: ${value}`);
}
for (const value of ["http://localhost", "https://localhost", "http://127.0.0.1", "https://127.0.0.1"]) {
  if (api.includes(value) || app.includes(value)) failures.push(`금지 브라우저 API 주소가 있습니다: ${value}`);
}

if (failures.length) {
  console.error(JSON.stringify({ result: "FAIL", failures }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ result: "PASS", checks: 27 }, null, 2));
