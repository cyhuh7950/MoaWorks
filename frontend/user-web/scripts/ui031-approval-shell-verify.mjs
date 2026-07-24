import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const appPath = path.join(root, "src", "App.tsx");
const apiPath = path.join(root, "src", "api.ts");
const cssPath = path.join(root, "src", "global.css");
const helperPath = path.join(root, "src", "approvalShell.ts");
const app = fs.readFileSync(appPath, "utf8");
const api = fs.readFileSync(apiPath, "utf8");
const css = fs.readFileSync(cssPath, "utf8");
const helper = fs.existsSync(helperPath) ? fs.readFileSync(helperPath, "utf8") : "";

const menuLabels = [
  "결재 대기",
  "수신",
  "참조·열람 대기",
  "예정",
  "개인 문서함",
  "부서 문서함",
  "환경설정",
];

const checks = [
  ["ui031 전용 2영역 Shell", app.includes('className="ui031-shell"') && app.includes('className="ui031-shell__sidebar"') && app.includes('className="ui031-shell__main"')],
  ["보조 메뉴 7개", menuLabels.every((label) => app.includes(label))],
  ["업무·문서함 그룹", app.includes("전자결재 업무 메뉴") && app.includes("전자결재 문서함")],
  ["새 결재 진행 권한 연결", app.includes("새 결재 진행") && app.includes('disabled={!canAct.create}') && app.includes('openApprovalEditor("create")')],
  ["선택 메뉴 접근성", app.includes('aria-label="전자결재 보조 메뉴"') && app.includes('aria-current={isCurrent ? "page" : undefined}') && app.includes('aria-labelledby="ui031-content-title"')],
  ["데이터 계약 준비 상태", app.includes("후속 데이터 계약이 필요합니다") && app.includes("UI-035~036")],
  ["기존 목록·상세 유지", app.includes('aria-label="결재 목록"') && app.includes('aria-label="결재 상세"') && app.includes('aria-label="결재 검색"')],
  ["기존 처리 action 유지", ["수정", "상신", "회수", "재기안", "승인", "반려", "처리 이력"].every((label) => app.includes(label))],
  ["actor ID pure helper", helper.includes("classifyApprovalDocuments") && helper.includes("approverUserId === actorUserId") && helper.includes("creatorUserId === actorUserId") && !helper.includes("approverUserName") && !helper.includes("creatorUserName")],
  ["same-origin approvals API", api.includes('request<ApprovalListResponse>("/approvals"') && !/request<ApprovalListResponse>\(\s*[`"]https?:\/\//.test(api)],
  ["12·10·16px 표준", css.includes(".ui031-shell") && css.includes("font-size: 12px") && css.includes("font-size: 10px") && css.includes("font-size: 16px")],
  ["overflow·focus·tooltip", css.includes(".ui031-shell__body") && css.includes("overflow: auto") && css.includes(".ui031-menu-item:focus-visible") && css.includes(".ui031-help[data-tooltip]")],
  ["1100px 반응형", css.includes("@media (max-width: 1100px)") && css.includes(".ui031-shell") && css.includes("grid-template-columns: minmax(0, 1fr)")],
];

if (helper) {
  try {
    const { classifyApprovalDocuments } = await import(`${pathToFileURL(helperPath).href}?ui031=${Date.now()}`);
    const actorUserId = "user-actor";
    const otherUserId = "user-other";
    const makeLine = (sequence, approverUserId, status) => ({
      id: `line-${sequence}-${approverUserId}-${status}`,
      documentId: "fixture",
      approverUserId,
      approverUserName: approverUserId === actorUserId ? "동명이인 아님" : "user-actor",
      sequence,
      status,
    });
    const makeDocument = (id, overrides = {}) => ({
      id,
      title: id,
      content: id,
      creatorUserId: otherUserId,
      creatorUserName: "user-actor",
      status: "submitted",
      createdAt: "2026-07-25T00:00:00Z",
      updatedAt: "2026-07-25T00:00:00Z",
      currentLineIndex: 1,
      lines: [],
      ...overrides,
    });
    const documents = [
      makeDocument("pending", { lines: [makeLine(1, actorUserId, "pending")] }),
      makeDocument("scheduled", { lines: [makeLine(1, otherUserId, "pending"), makeLine(2, actorUserId, "pending")] }),
      makeDocument("received-approved", { status: "approved", lines: [makeLine(1, actorUserId, "approved")] }),
      makeDocument("received-once", { status: "rejected", lines: [makeLine(1, actorUserId, "approved"), makeLine(2, actorUserId, "rejected")] }),
      makeDocument("personal", { creatorUserId: actorUserId, status: "draft" }),
      makeDocument("overlap-personal-pending", { creatorUserId: actorUserId, lines: [makeLine(1, actorUserId, "pending")] }),
      makeDocument("name-decoy", { lines: [makeLine(1, otherUserId, "pending")] }),
      makeDocument("past-pending", { currentLineIndex: 2, lines: [makeLine(1, actorUserId, "pending"), makeLine(2, otherUserId, "pending")] }),
    ];

    const classified = classifyApprovalDocuments(documents, actorUserId);
    assert.deepEqual(classified.pending.map((item) => item.id), ["pending", "overlap-personal-pending"]);
    assert.deepEqual(classified.scheduled.map((item) => item.id), ["scheduled"]);
    assert.deepEqual(classified.received.map((item) => item.id), ["received-approved", "received-once"]);
    assert.deepEqual(classified.personal.map((item) => item.id), ["personal", "overlap-personal-pending"]);
    assert.equal(classified.received.filter((item) => item.id === "received-once").length, 1);
    assert.equal(Object.values(classified).flat().some((item) => item.id === "name-decoy"), false);
    assert.equal(Object.values(classified).flat().some((item) => item.id === "past-pending"), false);
    checks.push(["분류 fixture 7개 경계", true]);
  } catch (error) {
    checks.push(["분류 fixture 7개 경계", false, error instanceof Error ? error.message : String(error)]);
  }
} else {
  checks.push(["분류 fixture 7개 경계", false, "src/approvalShell.ts 없음"]);
}

const failures = checks.filter(([, passed]) => !passed);
for (const [name, passed, detail] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
}
console.log(JSON.stringify({ passed: checks.length - failures.length, total: checks.length, failures: failures.map(([name]) => name) }));
if (failures.length) process.exitCode = 1;
