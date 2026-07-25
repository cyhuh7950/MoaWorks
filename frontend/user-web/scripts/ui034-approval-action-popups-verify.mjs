import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const app = read("src/App.tsx");
const api = read("src/api.ts");
const popup = read("src/components/CommonPopup.tsx");
const css = read("src/global.css");
const helperPath = path.join(root, "src", "approvalAction.ts");
const checks = [];
const check = async (name, callback) => {
  try { await callback(); checks.push([name, true]); }
  catch (error) { checks.push([name, false, error instanceof Error ? error.message : String(error)]); }
};

await check("action config fixes five explicit user contracts", async () => {
  assert.ok(fs.existsSync(helperPath), "src/approvalAction.ts missing");
  const helper = await import(`${pathToFileURL(helperPath).href}?ui034=${Date.now()}`);
  assert.deepEqual(Object.keys(helper.APPROVAL_ACTION_CONFIG), ["submit", "approve", "reject", "withdraw", "redraft"]);
  assert.deepEqual(
    Object.fromEntries(Object.entries(helper.APPROVAL_ACTION_CONFIG).map(([key, value]) => [key, [value.title, value.confirmLabel, value.requiresOpinion]])),
    {
      submit: ["상신 확인", "상신", false],
      approve: ["승인", "승인", true],
      reject: ["반려", "반려", true],
      withdraw: ["회수 확인", "회수", false],
      redraft: ["재기안 확인", "재기안", false],
    },
  );
  for (const config of Object.values(helper.APPROVAL_ACTION_CONFIG)) {
    assert.ok(config.expectedState.length > 0);
    assert.ok(config.impact.length > 0);
    assert.ok(["primary", "success", "danger", "warning"].includes(config.tone));
  }
});

await check("approve and reject opinions share trim and 1..500 validation", async () => {
  const helper = await import(`${pathToFileURL(helperPath).href}?ui034-validation=${Date.now()}`);
  for (const action of ["approve", "reject"]) {
    assert.ok(helper.validateApprovalActionOpinion(action, " ").length > 0);
    assert.equal(helper.validateApprovalActionOpinion(action, " 처리 의견 "), "");
    assert.ok(helper.validateApprovalActionOpinion(action, "가".repeat(501)).length > 0);
  }
  assert.equal(helper.validateApprovalActionOpinion("submit", ""), "");
});

await check("action target is an immutable detail snapshot", async () => {
  const helper = await import(`${pathToFileURL(helperPath).href}?ui034-target=${Date.now()}`);
  const source = {
    id: "document-a",
    title: "휴가 결재",
    status: "submitted",
    currentLineIndex: 2,
    lines: [
      { sequence: 1, approverUserName: "일차", status: "approved" },
      { sequence: 2, approverUserName: "현재 결재자", status: "pending" },
    ],
  };
  const target = helper.buildApprovalActionTarget(source);
  source.id = "document-b";
  source.lines[1].approverUserName = "바뀐 결재자";
  assert.deepEqual(target, {
    documentId: "document-a",
    title: "휴가 결재",
    status: "submitted",
    currentApproverName: "현재 결재자",
    currentLineIndex: 2,
    lineCount: 2,
  });
});

await check("five actions render one 420x240 CommonPopup alertdialog", () => {
  assert.match(app, /<CommonPopup[\s\S]*className="ui034-action-popup"[\s\S]*kind="alertdialog"/);
  assert.match(css, /\.ui034-action-popup\s*\{[^}]*width:\s*420px[^}]*height:\s*240px/);
  assert.ok(app.includes("approvalActionTarget"));
  for (const token of ["현재 상태", "현재 결재자", "예상 결과", "영향"]) assert.ok(app.includes(token), token);
});

await check("opinion and action controls are explicit and preserve popup errors", () => {
  assert.match(app, /aria-label="처리 의견"[\s\S]*required[\s\S]*maxLength=\{500\}/);
  assert.ok(app.includes("/ 500자"));
  assert.match(app, /validateApprovalActionOpinion\(/);
  assert.match(app, /error=\{approvalError\}/);
  assert.match(app, /saving=\{loading\}/);
  assert.doesNotMatch(app, /reasonAction\.reason\.trim\(\)\s*\|\|\s*"확인"/);
});

await check("execution uses snapshot document id and keeps same-origin API layer", () => {
  assert.match(app, /approvalActionTarget\.documentId/);
  assert.doesNotMatch(app, /executeApprove\(selectedDocument\.id/);
  assert.doesNotMatch(app, /executeSubmit\(selectedDocument\.id/);
  const actionApi = api.split("export async function submitApproval")[1].split("export async function fetchApprovalLogs")[0];
  assert.doesNotMatch(actionApi, /https?:\/\/|localhost|127\.0\.0\.1|host\.docker\.internal/);
  assert.match(popup, /if \(saving\) return/);
  assert.match(popup, /disabled=\{saving\}/);
});

for (const [name, passed, error] of checks) console.log(`${passed ? "PASS" : "FAIL"} ${name}${error ? `: ${error}` : ""}`);
const failures = checks.filter(([, passed]) => !passed);
console.log(`${checks.length - failures.length}/${checks.length} PASS`);
if (failures.length) process.exit(1);
