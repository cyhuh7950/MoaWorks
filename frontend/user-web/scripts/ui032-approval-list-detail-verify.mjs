import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const app = read("src/App.tsx");
const api = read("src/api.ts");
const css = read("src/global.css");

const checks = [];
const check = async (name, callback) => {
  try { await callback(); checks.push([name, true]); }
  catch (error) { checks.push([name, false, error.message]); }
};

await check("detail helper exists and fixture contracts pass", async () => {
  const helperPath = path.join(root, "src", "approvalDetail.ts");
  assert.ok(fs.existsSync(helperPath));
  const helper = await import(pathToFileURL(helperPath).href);
  const documents = [
    { id: "a", title: "휴가", creatorUserName: "김기안", status: "submitted", currentLineIndex: 1, lines: [{ sequence: 1, approverUserName: "박결재", status: "pending" }] },
    { id: "b", title: "구매", creatorUserName: "이기안", status: "withdrawn", currentLineIndex: null, lines: [] },
  ];
  assert.deepEqual(helper.filterApprovalDocuments(documents, "all", "박결재").map((item) => item.id), ["a"]);
  assert.equal(helper.resolveApprovalSelection("b", [documents[0]]), "a");
  assert.equal(helper.resolveApprovalSelection("a", []), "");
  assert.equal(helper.approvalStatusLabel("withdrawn"), "회수");
});

await check("approval uses common split view and persisted 40/60 ratio", () => {
  assert.match(app, /<SplitView[\s\S]*moaworks\.user\.approval\.split-ratio\.v1/);
  assert.match(app, /defaultRatio=\{40\}/);
  assert.match(app, /minRatio=\{28\}/);
  assert.match(app, /maxRatio=\{65\}/);
  assert.match(app, /approvalDetailMaximized/);
});

await check("selection fetches latest detail and audit with stale response guard", () => {
  assert.match(api, /fetchApprovalDetail/);
  assert.match(app, /approvalRequestSequence/);
  assert.match(app, /fetchApprovalDetail[\s\S]*fetchApprovalLogs/);
  assert.match(app, /sequence !== approvalRequestSequence\.current/);
});

await check("detail and audit expose independent loading error and retry", () => {
  for (const token of ["approvalDetailLoading", "approvalDetailError", "approvalLogsLoading", "approvalLogsError", "retryApprovalDetail", "retryApprovalLogs"]) assert.ok(app.includes(token), token);
});

await check("fixed detail sections and current selection semantics exist", () => {
  for (const token of ["ui032-detail__header", "ui032-detail__content", "ui032-timeline", "ui032-comments", "ui032-attachments", "ui032-history", 'aria-current={isSelected ? "true" : undefined}']) assert.ok(app.includes(token), token);
  assert.doesNotMatch(app, /dangerouslySetInnerHTML/);
});

await check("same-origin attachment download client exists", () => {
  assert.match(api, /downloadApprovalAttachment/);
  assert.match(api, /\/approvals\/\$\{documentId\}\/attachments\/\$\{attachmentId\}/);
  assert.doesNotMatch(api, /localhost|127\.0\.0\.1/);
});

await check("responsive UI-032 namespace styles exist", () => {
  assert.match(css, /\.ui032-list-row/);
  assert.match(css, /\.ui032-detail/);
  assert.match(css, /@media \(max-width: 1100px\)[\s\S]*\.ui032-approval-split/);
});

await check("attachment download failure is isolated from loaded detail", () => {
  assert.ok(app.includes("approvalAttachmentError"));
  assert.ok(app.includes("handleApprovalAttachmentDownload"));
  assert.match(app, /setApprovalAttachmentError\(""\)[\s\S]*downloadApprovalAttachment/);
  assert.match(app, /catch[\s\S]*setApprovalAttachmentError/);
  assert.match(app, /className="ui032-attachment-error"/);
  assert.doesNotMatch(app, /downloadApprovalAttachment[\s\S]{0,300}setApprovalDetailError/);
});

await check("approval split view owns the full actual-menu body width", () => {
  assert.match(css, /#root \.ui031-shell__body\.ui032-approval-split\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /\.ui032-approval-split\s*>\s*\.user-split-view\s*\{[^}]*width:\s*100%/);
  assert.doesNotMatch(css, /#root \.ui031-shell__body\.ui032-approval-split\s*\{[^}]*45fr[^}]*55fr/);
});

const results = await Promise.all(checks.map(async ([name, passed, error]) => ({ name, passed, error })));
for (const item of results) console.log(`${item.passed ? "PASS" : "FAIL"} ${item.name}${item.error ? `: ${item.error}` : ""}`);
const failures = results.filter((item) => !item.passed);
console.log(`${results.length - failures.length}/${results.length} PASS`);
if (failures.length) process.exit(1);
