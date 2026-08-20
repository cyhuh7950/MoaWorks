import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const app = read("src/App.tsx");
const api = read("src/api.ts");
const css = read("src/global.css");
const shellPath = path.join(root, "src", "approvalShell.ts");
const { classifyApprovalDocuments } = await import(`${pathToFileURL(shellPath).href}?approval-completion=${Date.now()}`);

const actor = "actor";
const base = {
  id: "doc", title: "문서", content: "본문", creatorUserId: "creator", creatorUserName: "기안자",
  creatorDepartmentId: "dept", creatorDepartmentName: "영업팀", status: "submitted", urgent: false,
  createdAt: "2026-08-20T01:02:03Z", updatedAt: "2026-08-20T01:02:03Z", currentLineIndex: 1,
  canCurrentUserAct: false, lines: [], referenceUserIds: [], viewerUserIds: [], sharedWithDepartment: false,
  deletedForCurrentUser: false, permanentlyDeletedForCurrentUser: false,
};
const groups = classifyApprovalDocuments([
  { ...base, id: "reference", currentUserAudienceType: "reference", currentUserReadAt: undefined },
  { ...base, id: "viewer-read", currentUserAudienceType: "viewer", currentUserReadAt: "2026-08-20T02:00:00Z" },
  { ...base, id: "department", sharedWithDepartment: true, currentUserDepartmentMember: true, status: "approved" },
  { ...base, id: "trash", creatorUserId: actor, deletedForCurrentUser: true, status: "approved" },
], actor);
assert.deepEqual(groups.reference.map((item) => item.id), ["reference"]);
assert.deepEqual(groups.department.map((item) => item.id), ["department"]);
assert.deepEqual(groups.trash.map((item) => item.id), ["trash"]);
assert.ok(!groups.personal.some((item) => item.id === "trash"));

for (const label of ["기안일", "긴급 여부", "제목", "기안자", "결재선 보기", "처리 이력 보기", "휴지통"]) {
  assert.ok(app.includes(label), label);
}
assert.ok(app.includes('className="ui032-list-columns"'));
assert.ok(app.includes('className="ui032-approval-line-modal"'));
assert.ok(app.includes('className="ui032-history-modal"'));
assert.ok(app.includes('className="ui033-selected-approver"'));
assert.ok(api.includes("markApprovalRead"));
assert.ok(api.includes("deleteApprovalDocument"));
assert.ok(api.includes("restoreApprovalDocument"));
assert.ok(api.includes("permanentlyDeleteApprovalDocument"));
assert.match(css, /\.ui033-selected-approver\s*\{[^}]*grid-template-columns:/s);
assert.match(css, /\.ui032-list-columns\s*\{[^}]*grid-template-columns:/s);
assert.doesNotMatch(api, /localhost|127\.0\.0\.1/);

console.log("PASS approval workspace completion contracts");
