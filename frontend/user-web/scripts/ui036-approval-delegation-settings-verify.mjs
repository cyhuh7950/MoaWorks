import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const app = read("src/App.tsx"), api = read("src/api.ts"), css = read("src/global.css");
const helperPath = path.join(root, "src", "approvalDelegation.ts");
const checks = [];
const check = async (name, callback) => { try { await callback(); checks.push([name, true]); } catch (error) { checks.push([name, false, error instanceof Error ? error.message : String(error)]); } };

await check("delegation helper validates dates reason and candidate", async () => {
  assert.ok(fs.existsSync(helperPath));
  const helper = await import(`${pathToFileURL(helperPath).href}?ui036=${Date.now()}`);
  assert.equal(helper.validateApprovalDelegation({ startDate: "2026-07-27", endDate: "2026-07-26", delegateUserId: "u2", reason: "휴가", enabled: true }), "종료일은 시작일보다 빠를 수 없습니다.");
  assert.equal(helper.validateApprovalDelegation({ startDate: "2026-07-26", endDate: "2026-07-26", delegateUserId: "", reason: "휴가", enabled: true }), "대결자를 선택하세요.");
  assert.equal(helper.APPROVAL_DELEGATION_STATUS_LABELS.active, "사용 중");
});

await check("same-origin CRUD API and optimistic version are explicit", () => {
  const block = api.split("export async function fetchApprovalDelegations")[1].split("export async function submitApproval")[0];
  assert.doesNotMatch(block, /https?:\/\/|localhost|127\.0\.0\.1|host\.docker\.internal/);
  assert.match(block, /\/approvals\/settings\/delegations/);
  assert.match(block, /expectedVersion/);
  for (const method of ["POST", "PATCH", "DELETE"]) assert.match(block, new RegExp(`method: "${method}"`));
});

await check("real settings tabs isolate basic and delegation state", () => {
  assert.match(app, /approvalSettingsTab/);
  assert.match(app, /approvalDelegationsLoading/);
  assert.match(app, /approvalDelegationsError/);
  assert.match(app, /aria-selected=\{approvalSettingsTab === "delegation"\}/);
  assert.doesNotMatch(app, /disabled title="UI-036에서 제공합니다\."/);
});

await check("list toolbar paging states and tooltip are rendered", () => {
  for (const text of ["부재 추가", "수정", "삭제", "부재 시작", "부재 종료", "대결자", "부재 사유", "사용 여부", "저장된 부재 목록이 없습니다."]) assert.ok(app.includes(text), text);
  assert.match(app, /fetchApprovalDelegations\(targetToken, page, 20\)/);
  assert.match(app, /data-tooltip="활성 위임 기간에는 대결자가 현재 결재선을 처리할 수 있습니다\."/);
});

await check("popup candidate selection dirty close and delete confirmation exist", () => {
  assert.match(app, /ui036-delegation-popup/);
  assert.match(app, /dirty=\{approvalDelegationDirty\}/);
  assert.match(app, /approvalDelegationCandidates/);
  assert.match(app, /approvalDelegationDeleteTarget/);
  assert.match(app, /삭제할 위임/);
});

await check("fresh UI-036 session loads candidates without opening UI-033 compose", () => {
  assert.match(app, /approvalDelegationCandidatesLoading/);
  assert.match(app, /approvalDelegationCandidatesError/);
  assert.match(app, /approvalDelegationCandidatesRequestRef/);

  const candidateLoader = app
    .split("async function loadApprovalDelegationCandidates")[1]
    ?.split("async function loadApprovalDelegations")[0] ?? "";
  assert.match(candidateLoader, /fetchApprovalApprovers\(targetToken\)/);
  assert.match(candidateLoader, /approvalDelegationCandidatesRequestRef\.current/);

  const settingsTabHandler = app
    .split("function selectApprovalSettingsTab")[1]
    ?.split("function openApprovalDelegationCreate")[0] ?? "";
  assert.match(settingsTabHandler, /loadApprovalDelegationCandidates\(token\)/);

  const createHandler = app
    .split("function openApprovalDelegationCreate")[1]
    ?.split("function openApprovalDelegationEdit")[0] ?? "";
  const editHandler = app
    .split("function openApprovalDelegationEdit")[1]
    ?.split("async function saveApprovalDelegation")[0] ?? "";
  assert.match(createHandler, /loadApprovalDelegationCandidates\(token\)/);
  assert.match(editHandler, /loadApprovalDelegationCandidates\(token\)/);
  assert.match(app, /대결자 후보 조회 실패/);
  assert.match(app, /대결자 다시 조회/);
});

await check("delegate actor can open current action controls", () => {
  assert.match(api, /delegationId\?:\s*string/);
  assert.match(api, /decidedByUserName\?:\s*string/);
  assert.match(app, /isCurrentApprovalActor/);
  assert.match(app, /대결 \$\{line\.decidedByUserName\}/);
});

await check("layout keeps 12px scroll table and popup standards", () => {
  assert.match(css, /\.ui036-delegations\s*\{[^}]*font-size:\s*12px/);
  assert.match(css, /\.ui036-delegations__table-wrap\s*\{[^}]*overflow:\s*auto/);
  assert.match(css, /\.ui036-delegation-popup/);
});

for (const [name, passed, error] of checks) console.log(`${passed ? "PASS" : "FAIL"} ${name}${error ? `: ${error}` : ""}`);
const failures = checks.filter(([, passed]) => !passed);
console.log(`${checks.length - failures.length}/${checks.length} PASS`);
if (failures.length) process.exit(1);
