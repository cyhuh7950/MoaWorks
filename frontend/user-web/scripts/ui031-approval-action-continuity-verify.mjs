import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const appPath = path.join(root, "src", "App.tsx");
const apiPath = path.join(root, "src", "api.ts");
const helperPath = path.join(root, "src", "approvalShell.ts");
const app = fs.readFileSync(appPath, "utf8");
const api = fs.readFileSync(apiPath, "utf8");

const checks = [];
const check = (name, test) => {
  try {
    test();
    checks.push([name, true]);
  } catch (error) {
    checks.push([name, false, error instanceof Error ? error.message : String(error)]);
  }
};

check("API post-action 반환 계약", () => {
  assert.match(api, /createApproval[\s\S]*?request<\{ documentId: string \}>\("\/approvals"/);
  for (const functionName of [
    "updateApproval",
    "submitApproval",
    "approveApproval",
    "rejectApproval",
    "withdrawApproval",
    "redraftApproval",
  ]) {
    assert.match(api, new RegExp(`export async function ${functionName}[\\s\\S]*?request<ApprovalDocument>`));
  }
});

let resolveApprovalPostActionTarget;
try {
  ({ resolveApprovalPostActionTarget } = await import(`${pathToFileURL(helperPath).href}?ui031-continuity=${Date.now()}`));
} catch (error) {
  checks.push(["post-action target helper import", false, error instanceof Error ? error.message : String(error)]);
}

check("7개 action 메뉴·동일 문서 연속성", () => {
  assert.equal(typeof resolveApprovalPostActionTarget, "function");
  const actorUserId = "actor-user";
  const makeDocument = (id, status) => ({
    id,
    title: id,
    content: id,
    creatorUserId: "creator-user",
    creatorUserName: "기안자",
    status,
    createdAt: "2026-07-25T00:00:00Z",
    updatedAt: "2026-07-25T00:00:00Z",
    currentLineIndex: 1,
    lines: [{
      id: `${id}-line`,
      documentId: id,
      approverUserId: actorUserId,
      approverUserName: "처리자",
      sequence: 1,
      status,
    }],
  });

  for (const action of ["create", "edit", "submit", "withdraw", "redraft"]) {
    const target = resolveApprovalPostActionTarget(action, `${action}-document`, null, actorUserId);
    assert.deepEqual(target, { menu: "personal", documentId: `${action}-document` });
  }
  for (const action of ["approve", "reject"]) {
    const document = makeDocument(`${action}-document`, action === "approve" ? "approved" : "rejected");
    const target = resolveApprovalPostActionTarget(action, document.id, document, actorUserId);
    assert.deepEqual(target, { menu: "received", documentId: document.id });
  }
});

check("처리 후 실제 분류 없음은 명시적 빈 상태", () => {
  assert.equal(typeof resolveApprovalPostActionTarget, "function");
  const document = {
    id: "unclassified-document",
    title: "분류 없음",
    content: "분류 없음",
    creatorUserId: "creator-user",
    creatorUserName: "기안자",
    status: "approved",
    createdAt: "2026-07-25T00:00:00Z",
    updatedAt: "2026-07-25T00:00:00Z",
    currentLineIndex: null,
    lines: [],
  };
  assert.deepEqual(
    resolveApprovalPostActionTarget("approve", document.id, document, "actor-user"),
    { menu: null, documentId: document.id },
  );
});

check("App post-action 반환값·stale closure 우회", () => {
  assert.match(app, /async function keepApprovalPostAction\([\s\S]*?resolveApprovalPostActionTarget\(/);
  assert.match(app, /selectApprovalDocument\(target\.documentId, \{ preserveMenu: true \}\)/);
  assert.match(app, /const postActionDocument = await updateApproval\(/);
  assert.match(app, /const response = await createApproval\([\s\S]*?keepApprovalPostAction\("create", response\.documentId, null\)/);
  assert.match(app, /const postActionDocument = await act\(token, documentId, reasonAction\.reason\.trim\(\) \|\| "확인"\)/);
  assert.match(app, /keepApprovalPostAction\(accepted \? "approve" : "reject", documentId, postActionDocument\)/);
  assert.match(app, /const postActionDocument = await act\(token, documentId\)/);
  assert.match(app, /keepApprovalPostAction\(action, documentId, postActionDocument\)/);
  assert.doesNotMatch(app, /await reload\(\);\s*await selectApprovalDocument\(documentId\);/);
});

const failures = checks.filter(([, passed]) => !passed);
for (const [name, passed, detail] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
}
console.log(JSON.stringify({ passed: checks.length - failures.length, total: checks.length, failures: failures.map(([name]) => name) }));
if (failures.length) process.exitCode = 1;
