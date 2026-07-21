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

requireText(api, "export type MailListQuery", "메일 목록 query 타입이 없습니다.");
requireText(api, "new URLSearchParams()", "서버 목록 query 생성이 없습니다.");
for (const key of ["q", "read", "starred", "attachment", "category", "sort", "limit", "offset"]) {
  requireText(api, `query.set("${key}"`, `목록 query ${key} 전달이 없습니다.`);
}
requireText(api, "previewText: string", "plain text preview 응답 계약이 없습니다.");
for (const key of ["total: number", "limit: number", "offset: number", "hasMore: boolean"]) {
  requireText(api, key, `목록 metadata ${key} 계약이 없습니다.`);
}
requireText(api, '"move"', "분류 이동 bulk action이 없습니다.");
requireText(api, "targetCategory", "분류 이동 대상 전달이 없습니다.");
requireText(api, "request<MailListResponse>(mailListPath", "메일 목록이 same-origin helper를 사용하지 않습니다.");

requireText(app, 'aria-label="현재 페이지 전체 선택"', "현재 페이지 전체 선택 checkbox가 없습니다.");
requireText(app, 'aria-label={`메일 선택:', "행 선택 checkbox의 접근 가능한 이름이 없습니다.");
requireText(app, "event.stopPropagation()", "행 checkbox 클릭 전파 차단이 없습니다.");
requireText(app, "selectedMailIds", "bulk 선택 상태가 없습니다.");
requireText(app, "selectedMailId", "상세 선택 상태가 없습니다.");
requireText(app, "setSelectedMailIds([])", "query 또는 bulk 완료 후 선택 초기화가 없습니다.");
requireText(app, 'runBulkMailAction("move"', "받은편지함 분류 이동 실행이 없습니다.");
requireText(app, "mailListQuery", "서버 query 화면 상태가 없습니다.");
requireText(app, "mailListMeta", "pagination metadata 화면 상태가 없습니다.");
requireText(app, "mailBulkReloadError", "bulk 저장 성공 후 재조회 실패 구분이 없습니다.");
requireText(app, "<ConfirmModal", "삭제 확인 modal을 재사용하지 않습니다.");
requireText(app, 'className="user-mail-toolbar"', "compact 목록 toolbar가 없습니다.");
requireText(app, 'className="user-mail-row"', "메일 목록 행 구조가 없습니다.");

requireText(css, ".user-mail-toolbar", "메일 목록 toolbar CSS가 없습니다.");
requireText(css, ".user-mail-row", "메일 목록 행 CSS가 없습니다.");
const compactCss = css.slice(css.indexOf(".user-mail-toolbar"), css.indexOf(".user-mail-row") + 200);
requireText(compactCss, "font-size: 12px", "메일 목록 toolbar 12px 기준이 없습니다.");
requireText(css, "overflow: auto", "메일 목록 내부 스크롤 계약이 없습니다.");

const forbidden = ["http://localhost", "https://localhost", "http://127.0.0.1", "https://127.0.0.1"];
for (const value of forbidden) {
  if (api.includes(value) || app.includes(value)) failures.push(`금지 브라우저 API 주소가 있습니다: ${value}`);
}

if (failures.length) {
  console.error(JSON.stringify({ result: "FAIL", failures }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ result: "PASS", checks: 31 }, null, 2));
