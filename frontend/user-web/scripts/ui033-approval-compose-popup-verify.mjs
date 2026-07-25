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

const checks = [];
const check = async (name, callback) => {
  try { await callback(); checks.push([name, true]); }
  catch (error) { checks.push([name, false, error.message]); }
};

await check("compose helper enforces draft and attachment boundaries", async () => {
  const helperPath = path.join(root, "src", "approvalCompose.ts");
  assert.ok(fs.existsSync(helperPath), "src/approvalCompose.ts missing");
  const helper = await import(pathToFileURL(helperPath).href);
  assert.deepEqual(helper.validateApprovalDraft({ title: " 제목 ", content: " 본문 ", attachmentCount: 0, attachmentBytes: 0 }), []);
  assert.ok(helper.validateApprovalDraft({ title: " ", content: "본문", attachmentCount: 0, attachmentBytes: 0 }).length);
  assert.ok(helper.validateApprovalDraft({ title: "제목", content: " ", attachmentCount: 0, attachmentBytes: 0 }).length);
  assert.ok(helper.validateApprovalDraft({ title: "제목", content: "본문", attachmentCount: 11, attachmentBytes: 1 }).length);
  assert.ok(helper.validateApprovalDraft({ title: "제목", content: "본문", attachmentCount: 1, attachmentBytes: 25 * 1024 * 1024 + 1 }).length);
  assert.equal(helper.validateApprovalFiles([{ name: "a", size: 0 }], 0, 0).ok, false);
  assert.equal(helper.validateApprovalFiles([{ name: "a", size: 10 * 1024 * 1024 + 1 }], 0, 0).ok, false);
  assert.deepEqual(helper.moveApprovalApprover(["a", "b", "c"], "b", -1), ["b", "a", "c"]);
});

await check("compose uses CommonPopup 960x760 with document and approval-line tabs", () => {
  assert.match(app, /<CommonPopup[\s\S]*className="ui033-compose-popup"/);
  assert.match(popup, /className\?: string/);
  assert.match(popup, /common-popup \$\{className/);
  assert.match(css, /\.ui033-compose-popup\s*\{[^}]*width:\s*960px[^}]*height:\s*760px/);
  for (const token of ['role="tablist"', 'role="tab"', 'role="tabpanel"', 'aria-selected=', "문서", "결재선"]) assert.ok(app.includes(token), token);
});

await check("editor identity and latest edit detail are independent from list selection", () => {
  assert.ok(app.includes("approvalEditorDocumentId"));
  assert.match(app, /openApprovalEditor[\s\S]*fetchApprovalDetail\(token,\s*document\.id\)/);
  const editorBlock = app.split("async function openApprovalEditor")[1].split("function closeApprovalModal")[0];
  assert.doesNotMatch(editorBlock, /setSelectedApprovalId/);
});

await check("dirty close and saving use CommonPopup without browser confirm", () => {
  assert.match(app, /<CommonPopup[\s\S]*dirty=\{approvalComposeDirty\}[\s\S]*saving=\{loading\}/);
  assert.match(app, /closeRequestRef=\{approvalComposeCloseRequestRef\}/);
  assert.match(app, /approvalComposeCloseRequestRef\.current\?\.\(\)/);
  const closeBlock = app.split("function closeApprovalModal")[1].split("function selectApprovalApprover")[0];
  assert.doesNotMatch(closeBlock, /window\.confirm/);
});

await check("attachment upload and draft create-update use same-origin API", () => {
  assert.ok(api.includes("uploadApprovalAttachment"));
  assert.match(api, /request<ApprovalAttachmentUpload>\("\/approvals\/attachments"/);
  assert.match(api, /FormData/);
  assert.match(api, /retainedAttachmentIds/);
  assert.doesNotMatch(api, /localhost|127\.0\.0\.1|host\.docker\.internal/);
  for (const token of ["approvalPendingFiles", "approvalRetainedAttachments", "accept", "multiple", "첨부"]) assert.ok(app.includes(token), token);
});

await check("draft save allows zero approvers and retains search-select-reorder", () => {
  const saveBlock = app.split("async function handleCreate")[1].split("async function executeApprove")[0];
  assert.doesNotMatch(saveBlock, /approverUserIds\.length\)/);
  for (const token of ["approverSearch", "selectApprovalApprover", "moveApprovalApprover", "제거"]) assert.ok(app.includes(token), token);
});

await check("UI-034 state action path remains separate", () => {
  assert.ok(app.includes('approvalModal === "approve"'));
  assert.ok(app.includes("executeApprove"));
  assert.ok(app.includes("executeSubmit"));
});

for (const [name, passed, error] of checks) console.log(`${passed ? "PASS" : "FAIL"} ${name}${error ? `: ${error}` : ""}`);
const failures = checks.filter(([, passed]) => !passed);
console.log(`${checks.length - failures.length}/${checks.length} PASS`);
if (failures.length) process.exit(1);
