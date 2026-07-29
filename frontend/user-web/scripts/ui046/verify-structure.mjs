import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../../..");
const scripts = resolve(root, "frontend/user-web/scripts");
const [manifestText, inventoryText, orchestrator] = await Promise.all([
  readFile(resolve(here, "manifest.json"), "utf8"),
  readFile(resolve(here, "verifier-inventory.json"), "utf8"),
  readFile(resolve(here, "orchestrator.mjs"), "utf8"),
]);
const manifest = JSON.parse(manifestText);
const inventory = JSON.parse(inventoryText);
const readyArea = manifest.areas.find((area) => area.id === "home-search-notification");
const mailArea = manifest.areas.find((area) => area.id === "mail");
const approvalArea = manifest.areas.find((area) => area.id === "approval");
const calendarArea = manifest.areas.find((area) => area.id === "calendar");
const expectedGapAreaIds = ["messenger", "address-organization", "files", "personal-help"];

const frontendFiles = await readdir(scripts);
const sourceOnly = new Set(inventory.groups.find((group) => group.scope === "frontend-source-verifiers").sourceOnlyAllowlist);
const staticFiles = frontendFiles.filter((name) => name.endsWith("static-verify.mjs") || sourceOnly.has(name));

async function backendTestCount(directory) {
  let count = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) count += await backendTestCount(path);
    else if (/^test_.*\.py$|_smoke_test\.py$/.test(entry.name)) count += 1;
  }
  return count;
}

const checks = [
  ["8개 핵심 영역", manifest.areas.length === 8],
  ["영역 계약 필드", manifest.areas.every((area) => area.screenActions.length && area.apiPaths.length && area.dbTables.length && area.auditEvents.length && area.cleanupOwnership)],
  ["홈 검색 알림 READY", readyArea?.status === "READY" && readyArea?.adapter === "home-search-notification" && readyArea.liveInputContract?.missingInputStatus === "LIVE_INPUT_REQUIRED"],
  ["disposable user 안전 계약", JSON.stringify(readyArea?.liveInputContract?.requiredOwnershipKinds) === JSON.stringify(["test_user", "test_role", "notice", "schedule", "notification", "notification_state"]) && readyArea?.liveInputContract?.sessionPolicy === "run-id-disposable-user-only" && readyArea?.liveInputContract?.readAllPolicy === "run-id-owned-notification-state-only" && readyArea?.liveInputContract?.existingStateSnapshotRestore === "forbidden"],
  ["정규화 login run-id 비교", readyArea?.liveInputContract?.loginRunIdComparison === "case-insensitive"],
  ["메일 composite READY", mailArea?.status === "READY" && mailArea?.adapter === "mail" && mailArea.liveInputContract?.identityTopology === "one-run-role-two-run-users-two-mail-accounts" && mailArea.liveInputContract?.recipientPolicy === "run-id-internal-users-only" && mailArea.liveInputContract?.externalNetworkPolicy === "disabled-dummy-invalid-zero-attempts" && mailArea.liveInputContract?.compositePolicy === "core-and-settings-and-cleanup"],
  ["메일 execute-area 지원", orchestrator.includes("runMail") && orchestrator.includes("mail: runMail") && orchestrator.includes("SCREENSHOT_EVIDENCE_DUPLICATE")],
  ["전자결재 composite READY", approvalArea?.status === "READY" && approvalArea?.adapter === "approval" && approvalArea.liveInputContract?.identityTopology === "one-run-role-three-run-users-author-approver-delegate" && approvalArea.liveInputContract?.compositePolicy === "documents-and-basic-settings-and-delegations-and-cleanup"],
  ["전자결재 execute-area 지원", orchestrator.includes("runApproval") && orchestrator.includes("approval: runApproval")],
  ["캘린더 composite READY", calendarArea?.status === "READY" && calendarArea?.adapter === "calendar" && calendarArea.liveInputContract?.identityTopology === "one-run-role-two-run-users-owner-collaborator" && calendarArea.liveInputContract?.ownershipPolicy === "browser-created-ids-added-sequentially"],
  ["캘린더 execute-area 지원", orchestrator.includes("runCalendar") && orchestrator.includes("calendar: runCalendar")],
  ["나머지 4개 GAP 유지", JSON.stringify(manifest.areas.filter((area) => area.status === "GAP").map((area) => area.id)) === JSON.stringify(expectedGapAreaIds) && manifest.areas.filter((area) => area.status === "GAP").every((area) => area.adapter === null)],
  ["보호 계정 고정", JSON.stringify(manifest.protectedAccounts) === JSON.stringify(["admin", "cyhuh", "ysla"])],
  ["sinsan HTTPS origin", manifest.environment.userOrigin === "https://user.moaworks.sinsan.kr" && manifest.environment.adminOrigin === "https://admin.moaworks.sinsan.kr"],
  ["same-origin 상대 API", manifest.areas.flatMap((area) => area.apiPaths).every((path) => path.startsWith("/api/v1/"))],
  ["증적 필수 파일", ["manifest.json", "result.json", "network.json", "db-audit.json", "cleanup.json", "report.md"].every((name) => manifest.evidence.requiredFiles.includes(name))],
  ["frontend STATIC 전수 수 일치", staticFiles.length === inventory.groups.find((group) => group.scope === "frontend-source-verifiers").discovery.expectedCount],
  ["STALE 파일 존재", inventory.groups.find((group) => group.classification === "STALE").paths.every((path) => frontendFiles.includes(path.split("/").at(-1)))],
  ["오케스트레이터 shell 실행 금지", !/shell:\s*true/.test(orchestrator)],
  ["LIVE GAP 실행 차단", orchestrator.includes("CORE_GAP_BLOCKED") && orchestrator.includes("!area.adapter")],
  ["LIVE 입력 fail closed", orchestrator.includes("LIVE_INPUT_REQUIRED") && orchestrator.includes("runtime-drivers") && orchestrator.includes("execute-area")],
  ["비밀값 마스킹", orchestrator.includes("sensitiveKey") && orchestrator.includes("[REDACTED]") && manifest.evidence.forbiddenRawFields.includes("hash")],
  ["run id 경계", manifest.runIdPattern.startsWith("^UI046_")],
];

const backendCount = await backendTestCount(resolve(root, "backend"));
checks.push(["backend STATIC 전수 수 일치", backendCount === inventory.groups.find((group) => group.scope === "backend-isolated-tests").discovery.expectedCount]);

for (const [name, passed] of checks) console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
const failures = checks.filter(([, passed]) => !passed);
console.log(JSON.stringify({ passed: checks.length - failures.length, total: checks.length, failures: failures.map(([name]) => name), frontendStaticCount: staticFiles.length, backendStaticCount: backendCount, coreGapCount: manifest.areas.filter((area) => area.status === "GAP").length }));
assert.equal(failures.length, 0, failures.map(([name]) => name).join(", "));
