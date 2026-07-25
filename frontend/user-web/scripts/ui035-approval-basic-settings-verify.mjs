import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const app = read("src/App.tsx");
const api = read("src/api.ts");
const css = read("src/global.css");
const helperPath = path.join(root, "src", "approvalPreferences.ts");
const checks = [];
const check = async (name, callback) => {
  try { await callback(); checks.push([name, true]); }
  catch (error) { checks.push([name, false, error instanceof Error ? error.message : String(error)]); }
};

await check("policy helper fixes one writing method and three attachment modes", async () => {
  assert.ok(fs.existsSync(helperPath), "src/approvalPreferences.ts missing");
  const helper = await import(`${pathToFileURL(helperPath).href}?ui035=${Date.now()}`);
  assert.deepEqual(helper.APPROVAL_WRITING_METHODS, [{ value: "general", label: "일반 작성" }]);
  assert.deepEqual(helper.APPROVAL_ATTACHMENT_IMAGE_DISPLAYS.map((item) => item.value), ["thumbnail", "original", "filename"]);
});

await check("dirty snapshot includes policy and signature intent", async () => {
  const helper = await import(`${pathToFileURL(helperPath).href}?dirty=${Date.now()}`);
  const baseline = helper.buildApprovalPreferenceSnapshot({ writingMethod: "general", attachmentImageDisplay: "thumbnail", signatureName: "", removeSignature: false });
  const changed = helper.buildApprovalPreferenceSnapshot({ writingMethod: "general", attachmentImageDisplay: "filename", signatureName: "", removeSignature: false });
  assert.notEqual(baseline, changed);
  assert.match(app, /approvalPreferencesDirty/);
  assert.match(app, /<CommonPopup[\s\S]*dirty=\{approvalPreferencesDirty\}/);
});

await check("same-origin settings API uses browser-managed multipart boundary", () => {
  const block = api.split("export async function fetchApprovalBasicPreferences", 1)[1].split("export async function fetchApprovalLogs", 1)[0];
  assert.doesNotMatch(block, /https?:\/\/|localhost|127\.0\.0\.1|host\.docker\.internal/);
  assert.match(block, /\/approvals\/settings\/basic/);
  assert.match(block, /new FormData\(\)/);
  assert.doesNotMatch(block, /Content-Type/);
});

await check("settings menu renders real tabs form and tooltip guidance", () => {
  assert.match(app, /기본 설정/);
  assert.match(app, /부재\/위임 설정/);
  assert.match(app, /aria-label="결재 기본 설정"/);
  assert.match(app, /data-tooltip="서명은 승인 시점의 결재선에 보존됩니다\."/);
  assert.doesNotMatch(app, /결재 환경설정은 UI-035~036에서 제공합니다/);
});

await check("signature upload preview remove and limits are explicit", () => {
  assert.match(app, /accept="image\/png,image\/jpeg,image\/webp"/);
  assert.match(app, /512KB/);
  assert.match(app, /max-width:\s*55px|maxWidth:\s*55/);
  assert.match(app, /max-height:\s*40px|maxHeight:\s*40/);
  assert.match(app, />교체</);
  assert.match(app, />제거</);
});

await check("save cancel stale and errors preserve editable state", () => {
  assert.match(app, /expectedVersion/);
  assert.match(app, /status === 409/);
  assert.match(app, /서버 값을 다시 조회/);
  assert.match(app, /cancelApprovalPreferences/);
  assert.match(app, /saveApprovalPreferences/);
});

await check("detail line renders immutable signature snapshot", () => {
  assert.match(api, /hasSignature:\s*boolean/);
  assert.match(api, /signatureUrl\?:\s*string/);
  assert.match(app, /line\.hasSignature/);
  assert.match(app, /line\.signatureUrl/);
});

await check("image attachments honor three display modes while download stays available", async () => {
  const helper = await import(`${pathToFileURL(helperPath).href}?attachment=${Date.now()}`);
  assert.equal(helper.shouldPreviewApprovalAttachment("image/png", "thumbnail"), true);
  assert.equal(helper.shouldPreviewApprovalAttachment("image/png", "original"), true);
  assert.equal(helper.shouldPreviewApprovalAttachment("image/png", "filename"), false);
  assert.equal(helper.shouldPreviewApprovalAttachment("application/pdf", "original"), false);
  assert.match(app, /attachment\.previewUrl/);
  assert.match(app, /handleApprovalAttachmentDownload/);
});

await check("settings layout keeps 12px standard and fixed actions", () => {
  assert.match(css, /\.ui035-settings\s*\{[^}]*font-size:\s*12px/);
  assert.match(css, /\.ui035-settings__actions\s*\{[^}]*position:\s*sticky/);
  assert.match(css, /\.ui035-signature-preview[^}]*max-width:\s*55px[^}]*max-height:\s*40px/);
});

for (const [name, passed, error] of checks) console.log(`${passed ? "PASS" : "FAIL"} ${name}${error ? `: ${error}` : ""}`);
const failures = checks.filter(([, passed]) => !passed);
console.log(`${checks.length - failures.length}/${checks.length} PASS`);
if (failures.length) process.exit(1);
