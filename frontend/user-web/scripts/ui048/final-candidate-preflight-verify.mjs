import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../../..");
const evidenceRoot = resolve(root, "docs/evidence/user-web-redesign/UI-048/UI048_20260731T084647_preflight");
const readText = (path) => readFile(path, "utf8");
const readJson = async (path) => JSON.parse(await readText(path));
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

const manifest = await readJson(resolve(here, "manifest.json"));
const evidenceManifest = await readJson(resolve(evidenceRoot, "manifest.json"));
const result = await readJson(resolve(evidenceRoot, "result.json"));
const deployment = await readJson(resolve(evidenceRoot, "deployment-precheck.json"));
const staticVerification = await readJson(resolve(evidenceRoot, "static-verification.json"));
const run1 = await readJson(resolve(evidenceRoot, "run1/result.json"));
const run2 = await readJson(resolve(evidenceRoot, "run2/result.json"));
const runArtifacts = await Promise.all(["run1", "run2"].map(async (run) => ({
  screen: await readJson(resolve(evidenceRoot, `${run}/screen-state.json`)),
  network: await readJson(resolve(evidenceRoot, `${run}/network.json`)),
  console: await readJson(resolve(evidenceRoot, `${run}/console.json`)),
  deployment: await readJson(resolve(evidenceRoot, `${run}/deployment.json`)),
  cleanup: await readJson(resolve(evidenceRoot, `${run}/cleanup.json`)),
})));

const ui045Report = await readText(resolve(root, manifest.prerequisites.ui045.path));
const ui046Result = await readJson(resolve(root, manifest.prerequisites.ui046.path));
const ui047Result = await readJson(resolve(root, manifest.prerequisites.ui047.path));

async function sourceFiles(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) output.push(...await sourceFiles(path));
    else if ([".js", ".jsx", ".ts", ".tsx"].includes(extname(entry.name))) output.push(path);
  }
  return output;
}

function hasSensitiveEvidenceKey(value) {
  if (Array.isArray(value)) return value.some(hasSensitiveEvidenceKey);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) =>
    /^(?:password|hash|token|cookie|set-cookie|authorization|secret|rawQuery|queryString)$/i.test(key) || hasSensitiveEvidenceKey(child));
}

const browserSourcePaths = [
  ...await sourceFiles(resolve(root, "frontend/user-web/src")),
  ...await sourceFiles(resolve(root, "frontend/admin-web/src")),
];
const browserSources = await Promise.all(browserSourcePaths.map(readText));
const forbiddenBrowserTarget = /https?:\/\/(?:localhost|127\.0\.0\.1|server|[a-z0-9-]+:\d+)|NEXT_PUBLIC_API_BASE_URL/i;

const currentHead = git("rev-parse", "HEAD");
const currentBranch = git("branch", "--show-current");
const ui048HarnessExclusion = ":(exclude,glob)frontend/user-web/scripts/ui048/**";
const productPathspec = ["frontend/user-web", "frontend/admin-web", "backend", "deploy", ui048HarnessExclusion];
const productRevision = git("log", "-1", "--format=%H", "--", ...productPathspec);
const productDiff = git("diff", "--name-only", `${manifest.git.ui047ClosureRevision}..HEAD`, "--", ...productPathspec);
let baselineIsAncestor = false;
try {
  execFileSync("git", ["merge-base", "--is-ancestor", manifest.git.candidateBaselineRevision, "HEAD"], { cwd: root, stdio: "ignore" });
  baselineIsAncestor = true;
} catch {}

const checks = [
  ["task id", manifest.taskId === "ui048-final-browser-deployment-candidate-20260731"],
  ["candidate branch", currentBranch === manifest.git.branch],
  ["candidate baseline ancestor", baselineIsAncestor],
  ["current HEAD available", /^[0-9a-f]{40}$/.test(currentHead)],
  ["product revision", JSON.stringify(manifest.git.productPathExclusions) === JSON.stringify(["frontend/user-web/scripts/ui048/**"]) && productRevision === manifest.git.productRevision],
  ["UI-047 closure 이후 제품 diff 0", productDiff === ""],
  ["sinsan origins", manifest.environment.userOrigin === "https://user.moaworks.sinsan.kr" && manifest.environment.adminOrigin === "https://admin.moaworks.sinsan.kr"],
  ["1920x1080 viewport", manifest.environment.viewport.width === 1920 && manifest.environment.viewport.height === 1080],
  ["독립 Chrome 2회", manifest.browserRuns.length === 2 && manifest.browserRuns.every((run) => run.executionOwner === "OWOUL1" && run.status === "NOT_RUN")],
  ["보호 계정", JSON.stringify(manifest.protectedAccounts) === JSON.stringify(["admin", "cyhuh", "ysla"])],
  ["조회 전용 정책", manifest.dataPolicy.defaultMode === "READ_ONLY" && manifest.dataPolicy.mutationRequiresSeparateApproval === true],
  ["사용자 화면 매트릭스", manifest.userWeb.areas.length === 12],
  ["관리자 10개 메뉴", manifest.adminWeb.menus.length === 10],
  ["same-origin Network 계약", manifest.network.requiredKinds.every((kind) => ["document", "script", "stylesheet", "api"].includes(kind)) && manifest.network.forbiddenTargets.includes("localhost")],
  ["UI-045 PASS 연결", ui045Report.includes("PASS / DEPLOY_READY")],
  ["UI-046 PASS 연결", ui046Result.status === "PASS" && ui046Result.ui046Status === "PASS"],
  ["UI-047 PASS 연결", ui047Result.status === "LIVE_PASS_DEPLOY_READY" && ui047Result.deployReady === true],
  ["브라우저 제품 내부주소 0", browserSources.every((source) => !forbiddenBrowserTarget.test(source))],
  ["evidence manifest run id", evidenceManifest.runId === manifest.runId && evidenceManifest.status === "PREFLIGHT"],
  ["정적 검증 PASS", Object.values(staticVerification.checks).every((check) => check === "PASS")],
  ["Git 사전점검 PASS", deployment.gitCandidate.status === "PASS" && /^[0-9a-f]{40}$/.test(deployment.gitCandidate.candidateBaselineRevision) && deployment.gitCandidate.candidateBaselineRevision === manifest.git.candidateBaselineRevision && deployment.gitCandidate.productDiffCount === 0],
  ["운영 무결성 live 재확인 대기", deployment.liveDeployment.status === "NOT_RUN"],
  ["run1 fail closed", run1.status === "NOT_RUN" && run1.evidenceComplete === false],
  ["run2 fail closed", run2.status === "NOT_RUN" && run2.evidenceComplete === false],
  ["run evidence 골격", runArtifacts.every((run) => Object.values(run).every((artifact) => artifact.status === "NOT_RUN"))],
  ["Network 빈 증적", runArtifacts.every((run) => run.network.requests.length === 0)],
  ["운영 mutation 없음", runArtifacts.every((run) => run.cleanup.mutationCreated === false)],
  ["전체 WAIT", result.status === "WAIT" && result.releaseCandidate === false && result.deployReady === false],
  ["핵심 GAP 유지", result.gaps.includes("CHROME_RUN1_NOT_RUN") && result.gaps.includes("CHROME_RUN2_NOT_RUN") && result.gaps.includes("LIVE_DEPLOYMENT_INTEGRITY_NOT_RECHECKED")],
  ["민감 evidence key 0", ![evidenceManifest, result, deployment, staticVerification, run1, run2, ...runArtifacts.flatMap(Object.values)].some(hasSensitiveEvidenceKey)],
  ["민감 key 정책 hash와 set-cookie", hasSensitiveEvidenceKey({ hash: "sentinel" }) && hasSensitiveEvidenceKey({ "set-cookie": "sentinel" })],
];

for (const [name, passed] of checks) console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
const failures = checks.filter(([, passed]) => !passed).map(([name]) => name);
console.log(JSON.stringify({ passed: checks.length - failures.length, total: checks.length, failures, status: result.status }));
assert.equal(failures.length, 0, failures.join(", "));
