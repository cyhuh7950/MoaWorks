import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../../..");
const evidenceRoot = resolve(root, "docs/evidence/user-web-redesign/UI-048/UI048_20260731T084647_preflight");
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

const manifest = await readJson(resolve(evidenceRoot, "manifest.json"));
const result = await readJson(resolve(evidenceRoot, "result.json"));
const deployment = await readJson(resolve(evidenceRoot, "deployment-precheck.json"));
const contract = await readJson(resolve(here, "manifest.json"));

async function readRun(name) {
  const directory = resolve(evidenceRoot, name);
  return {
    result: await readJson(resolve(directory, "result.json")),
    screen: await readJson(resolve(directory, "screen-state.json")),
    network: await readJson(resolve(directory, "network.json")),
    console: await readJson(resolve(directory, "console.json")),
    deployment: await readJson(resolve(directory, "deployment.json")),
    cleanup: await readJson(resolve(directory, "cleanup.json")),
  };
}

async function readImageDimensions(path) {
  const data = await readFile(resolve(evidenceRoot, path));
  const signature = data.subarray(0, 8).toString("hex");
  if (signature === "89504e470d0a1a0a") {
    return { format: "png", width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  assert.equal(data.subarray(0, 2).toString("hex"), "ffd8", `${path} is not PNG or JPEG`);
  const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 8 < data.length) {
    if (data[offset] !== 0xff) { offset += 1; continue; }
    while (data[offset] === 0xff) offset += 1;
    const marker = data[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9) continue;
    const length = data.readUInt16BE(offset);
    if (sofMarkers.has(marker)) {
      return { format: "jpeg", height: data.readUInt16BE(offset + 3), width: data.readUInt16BE(offset + 5) };
    }
    offset += length;
  }
  throw new Error(`${path} has no JPEG size marker`);
}

const runs = [await readRun("run1"), await readRun("run2")];
const requiredUserAreas = contract.userWeb.areas;
const requiredAdminMenus = contract.adminWeb.menus;
const expectedAssets = [
  { user: 36, admin: 12 },
  { user: 52, admin: 11 },
];

const checks = [
  ["final evidence 상태", manifest.environment === "sinsan" && manifest.status === "FINAL_EVIDENCE_WAIT"],
  ["live deployment PASS", deployment.status === "PASS" && deployment.liveDeployment.status === "PASS"],
  ["전체 WAIT", result.status === "WAIT" && result.releaseCandidate === false && result.deployReady === false],
  ["최종 GAP 2개", JSON.stringify(result.gaps) === JSON.stringify(["RUN1_NETWORK_STATUS_COLUMN_WAIT", "RUN2_NETWORK_STATUS_COLUMN_WAIT"])],
  ["run 판정 fail closed", runs.every((run) => run.result.status === "WAIT_NETWORK_STATUS_EVIDENCE" && run.result.evidenceComplete === false)],
  ["실행 계약과 책임자", contract.browserRuns.every((run) => run.executionOwner === "OWOUL1" && run.status === "WAIT_NETWORK_STATUS_EVIDENCE") && runs.every((run) => run.result.executionOwner === "OWOUL1")],
  ["screen 증거 PASS", runs.every((run) => run.screen.status === "PASS" && run.result.screenEvidenceComplete === true && run.result.screenMetricsConsoleSameOriginComplete === true)],
  ["유효 viewport 1920x1080", runs.every((run) => run.result.viewport.width === 1920 && run.result.viewport.height === 1080 && run.screen.viewport.width === 1920 && run.screen.viewport.height === 1080)],
  ["사용자 전체 매트릭스", runs.every((run) => JSON.stringify(run.screen.user?.areas) === JSON.stringify(requiredUserAreas))],
  ["관리자 dashboard와 10개 메뉴", runs.every((run) => run.screen.admin?.dashboard === true && JSON.stringify(run.screen.admin?.menus) === JSON.stringify(requiredAdminMenus))],
  ["body 1920x1080 overflow 0", runs.every((run) => [run.screen.user?.body, run.screen.admin?.body].every((body) => body?.width === 1920 && body?.scrollWidth === 1920 && body?.height === 1080 && body?.horizontalOverflow === 0))],
  ["mail 내부 scroll", runs.every((run) => ["shell", "list", "detail"].every((key) => run.screen.user?.mailInternalScroll?.[key] === "auto"))],
  ["메일쓰기 popup", runs.every((run) => run.screen.user?.mailCompose?.open === "PASS" && run.screen.user?.mailCompose?.focus === "PASS" && run.screen.user?.mailCompose?.fitsViewport === true && run.screen.user?.mailCompose?.close === "PASS")],
  ["admin console-sidebar 내부 scroll", runs.every((run) => run.screen.admin?.consoleSidebarInternalScroll === "PASS")],
  ["console error warn 0", runs.every((run) => run.console.status === "PASS" && run.console.errorCount === 0 && run.console.warningCount === 0 && run.console.userLogs.length === 0 && run.console.adminLogs.length === 0)],
  ["pageAssets same-origin", runs.every((run) => run.network.sameOrigin === true && run.network.forbiddenTargetCount === 0 && run.network.pageAssets?.user?.sameOrigin === true && run.network.pageAssets?.admin?.sameOrigin === true)],
  ["asset 관찰 수", runs.every((run, index) => run.network.pageAssets?.user?.total === expectedAssets[index].user && run.network.pageAssets?.admin?.total === expectedAssets[index].admin)],
  ["run2 asset 유형", runs[1].network.pageAssets?.user?.types?.script === 1 && runs[1].network.pageAssets?.user?.types?.stylesheet === 1 && runs[1].network.pageAssets?.user?.types?.other === 50 && runs[1].network.pageAssets?.admin?.types?.script === 1 && runs[1].network.pageAssets?.admin?.types?.stylesheet === 1 && runs[1].network.pageAssets?.admin?.types?.other === 8 && runs[1].network.pageAssets?.admin?.types?.image === 1],
  ["Status 열 fail closed", runs.every((run) => run.network.status === "WAIT_STATUS_COLUMN_EVIDENCE" && run.network.responseStatusAvailable === false && run.network.nameStatusDomainComplete === false)],
  ["run2 빈 Network 진단 rejected", runs[1].network.rejectedDiagnostics?.length === 1 && runs[1].network.rejectedDiagnostics[0].path === "run2/user-network-filter-empty.png" && runs[1].network.rejectedDiagnostics[0].observedRows === 0 && runs[1].network.rejectedDiagnostics[0].availableRows === 9],
  ["run2 1559x762 폐기", runs[1].result.discardedAttempts?.length === 1 && runs[1].result.discardedAttempts[0].viewport?.width === 1559 && runs[1].result.discardedAttempts[0].viewport?.height === 762 && runs[1].result.discardedAttempts[0].includedInValidRun === false],
  ["task-owned data 없음", runs.every((run) => run.cleanup.status === "PASS_NO_TASK_OWNED_DATA" && run.cleanup.mutationCreated === false && run.cleanup.residualCount === 0 && run.cleanup.protectedAccountsUnchanged === "NO_PROFILE_CREDENTIAL_ROLE_MUTATION_OBSERVED")],
  ["자동 read acknowledgement 분리", runs.every((run) => run.cleanup.automaticSessionSideEffects?.some((effect) => effect.type === "messenger-room-read-acknowledgement" && effect.cleanupTarget === false))],
  ["run deployment 연결", runs.every((run) => run.deployment.status === "LINKED_PASS" && run.deployment.productRevision === contract.git.productRevision && run.deployment.rollbackVerified === true)],
];

const validScreenshotPaths = [
  "run1/user-mail-1920x1080.jpg",
  "run1/admin-help-1920x1080.jpg",
  "run2/user-mail-1920x1080.jpg",
  "run2/admin-help-1920x1080.jpg",
];
const rejectedScreenshotPaths = [
  "run2/admin-help-rejected-1559x762.jpg",
  "run2/user-network-filter-empty.png",
];
let screenshotFilesPresent = true;
for (const path of [...validScreenshotPaths, ...rejectedScreenshotPaths]) {
  try { await access(resolve(evidenceRoot, path)); }
  catch { screenshotFilesPresent = false; }
}
const validScreenshotDimensions = await Promise.all(validScreenshotPaths.map(readImageDimensions));
const rejectedScreenshotDimensions = await Promise.all(rejectedScreenshotPaths.map(readImageDimensions));
checks.push(["스크린샷 파일 6개", screenshotFilesPresent]);
checks.push(["유효 JPEG 1920x1080", validScreenshotDimensions.every((size) => size.format === "jpeg" && size.width === 1920 && size.height === 1080)]);
checks.push(["거부 스크린샷 치수 분리", rejectedScreenshotDimensions[0].format === "jpeg" && rejectedScreenshotDimensions[0].width === 1559 && rejectedScreenshotDimensions[0].height === 762 && rejectedScreenshotDimensions[1].format === "png" && runs[1].screen.rejectedDiagnostics?.[0]?.path === rejectedScreenshotPaths[0]]);

for (const [name, passed] of checks) console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
const failures = checks.filter(([, passed]) => !passed).map(([name]) => name);
console.log(JSON.stringify({ passed: checks.length - failures.length, total: checks.length, failures, status: result.status }));
assert.equal(failures.length, 0, failures.join(", "));
