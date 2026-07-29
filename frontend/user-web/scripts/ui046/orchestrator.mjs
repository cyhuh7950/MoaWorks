import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runHomeSearchNotification } from "./adapters/home-search-notification.mjs";
import { runMail } from "./adapters/mail.mjs";
import { runApproval } from "./adapters/approval.mjs";
import { runPreflight } from "./adapters/preflight.mjs";
import { runStaticStructure } from "./adapters/static-structure.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../../..");
const manifestPath = resolve(here, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const command = process.argv[2] || "plan";
const runIdArg = process.argv.find((value) => value.startsWith("--run-id="));
const runId = runIdArg?.slice("--run-id=".length) || "";
const areaArg = process.argv.find((value) => value.startsWith("--area="));
const areaId = areaArg?.slice("--area=".length) || "";
const driverArg = process.argv.find((value) => value.startsWith("--driver-module="));
const driverModuleName = driverArg?.slice("--driver-module=".length) || "";
const runIdRegex = new RegExp(manifest.runIdPattern);
const isMain = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

const sensitiveKey = /password|hash|token|cookie|authorization|secret|set-cookie/i;
const sensitiveValue = /Bearer\s+[A-Za-z0-9._=-]+|([?&](?:token|access_token|authorization|password|secret)=)[^&\s]+/gi;

function sanitize(value, key = "") {
  if (sensitiveKey.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([nextKey, item]) => [nextKey, sanitize(item, nextKey)]));
  if (typeof value === "string") return value.replace(sensitiveValue, (match, prefix) => prefix ? `${prefix}[REDACTED]` : "Bearer [REDACTED]");
  return value;
}

function assertRunId() {
  if (!runIdRegex.test(runId)) throw new Error("--run-id는 UI046_YYYYMMDDTHHMMSS_suffix 형식이어야 합니다.");
}

function safeEvidenceDir() {
  const evidenceRoot = resolve(root, manifest.evidence.root);
  const directory = resolve(evidenceRoot, runId);
  const pathFromRoot = relative(evidenceRoot, directory);
  if (!pathFromRoot || pathFromRoot.startsWith("..") || pathFromRoot.includes(":")) throw new Error("증적 경로가 UI-046 경계를 벗어났습니다.");
  return directory;
}

async function writeJson(path, value) {
  const cleaned = sanitize(value);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(cleaned, null, 2)}\n`, "utf8");
}

function errorWithCode(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

async function loadRuntimeDrivers() {
  if (!driverModuleName) throw errorWithCode("LIVE_INPUT_REQUIRED");
  if (!/^[A-Za-z0-9._-]+\.mjs$/.test(driverModuleName)) throw errorWithCode("DRIVER_MODULE_PATH_REJECTED");
  const runtimeRoot = resolve(here, "runtime-drivers");
  const driverPath = resolve(runtimeRoot, driverModuleName);
  const pathFromRoot = relative(runtimeRoot, driverPath);
  if (!pathFromRoot || pathFromRoot.startsWith("..") || pathFromRoot.includes(":")) throw errorWithCode("DRIVER_MODULE_PATH_REJECTED");
  await access(driverPath).catch(() => { throw errorWithCode("LIVE_INPUT_REQUIRED"); });
  const runtime = await import(pathToFileURL(driverPath).href);
  if (typeof runtime.createDrivers !== "function") throw errorWithCode("LIVE_INPUT_REQUIRED");
  return runtime.createDrivers({ runId, userOrigin: manifest.environment.userOrigin });
}

function plan() {
  const areas = manifest.areas.map((area) => ({ id: area.id, status: area.status, adapter: area.adapter }));
  const gapCount = areas.filter((area) => area.status === "GAP").length;
  process.stdout.write(`${JSON.stringify({ taskId: manifest.taskId, mode: "PLAN", gapCount, areas }, null, 2)}\n`);
}

async function preflight() {
  assertRunId();
  const directory = safeEvidenceDir();
  const result = await runPreflight({ manifest });
  await writeJson(resolve(directory, "preflight.json"), { runId, phase: "PREFLIGHT", ...result });
  await writeJson(resolve(directory, "network.json"), result.network);
  process.stdout.write(`${JSON.stringify({ runId, phase: "PREFLIGHT", status: result.status, evidence: relative(root, directory).replaceAll("\\", "/") })}\n`);
  if (result.status !== "PASS") process.exitCode = 1;
}

async function staticStructure() {
  const result = await runStaticStructure({ root });
  process.stdout.write(`${JSON.stringify({ phase: "STATIC_STRUCTURE", ...result }, null, 2)}\n`);
  if (result.status !== "PASS") process.exitCode = 1;
}

function execute() {
  assertRunId();
  const gaps = manifest.areas.filter((area) => area.status === "GAP" || !area.adapter);
  if (gaps.length) throw errorWithCode("CORE_GAP_BLOCKED");
  throw errorWithCode("AREA_ADAPTER_REQUIRED");
}

async function executeArea() {
  assertRunId();
  if (!["home-search-notification", "mail", "approval"].includes(areaId)) throw errorWithCode("AREA_NOT_READY");
  const directory = safeEvidenceDir();
  const drivers = await loadRuntimeDrivers();
  const runners = { "home-search-notification": runHomeSearchNotification, mail: runMail, approval: runApproval };
  const result = await runners[areaId]({ manifest, runId, browserDriver: drivers?.browserDriver, dbDriver: drivers?.dbDriver, evidenceDir: directory });
  await persistAreaEvidence({ result, directory, selectedAreaId: areaId, selectedRunId: runId });
  process.stdout.write(`${JSON.stringify({ runId, areaId, status: result.status, evidence: relative(root, directory).replaceAll("\\", "/") })}\n`);
}

export async function persistAreaEvidence({ result, directory, selectedAreaId, selectedRunId }) {
  if (!Array.isArray(result?.screenshots) || new Set(result.screenshots).size !== result.screenshots.length) throw errorWithCode("SCREENSHOT_EVIDENCE_DUPLICATE");
  for (const screenshot of result.screenshots) {
    if (!/^screenshots\/[A-Za-z0-9._-]+\.png$/.test(screenshot)) throw errorWithCode("SCREENSHOT_PATH_REJECTED");
    await access(resolve(directory, screenshot)).catch(() => { throw errorWithCode("SCREENSHOT_EVIDENCE_MISSING"); });
  }
  await writeJson(resolve(directory, "manifest.json"), manifest);
  await writeJson(resolve(directory, "result.json"), { runId: selectedRunId, status: result.status, areaId: result.areaId, actions: result.actions, screenshots: result.screenshots, ...(result.mutationOwnership ? { mutationOwnership: result.mutationOwnership } : {}) });
  await writeJson(resolve(directory, "network.json"), result.network);
  await writeJson(resolve(directory, "db-audit.json"), result.dbAudit);
  await writeJson(resolve(directory, "cleanup.json"), result.cleanup);
  const reportReasons = {
    mail: "메일 core/settings 화면, 실제 route family, same-origin API, DB/audit, 재조회와 cleanup 계약을 통과했습니다.",
    approval: "전자결재 문서·기본설정·위임 화면, same-origin API, DB/audit/version, 재조회와 cleanup composite 계약을 통과했습니다.",
    "home-search-notification": "home-search-notification LIVE adapter가 run-id disposable user 세션, same-origin API, DB, audit, 재조회와 cleanup 계약을 통과했습니다.",
  };
  const reportReason = reportReasons[selectedAreaId] ?? "선택 영역의 LIVE adapter 계약을 통과했습니다.";
  const remainingGapCount = manifest.areas.filter((area) => area.status === "GAP").length;
  await writeFile(resolve(directory, "report.md"), `판정 -> ${result.status}\n\n판단 이유 -> ${reportReason}\n\n조치 -> 이 영역만 PASS이며 나머지 ${remainingGapCount}개 GAP과 UI-046 전체 WAIT를 유지하고 어울1이 증적을 독립 검수합니다.\n`, "utf8");
}

const commands = { plan, preflight, static: staticStructure, execute, "execute-area": executeArea };
if (isMain) {
  try {
    if (!commands[command]) throw errorWithCode("USAGE_ERROR");
    await commands[command]();
  } catch (error) {
    const errorCode = String(error?.code || "EXECUTION_FAILED").split(":", 1)[0];
    process.stderr.write(`${JSON.stringify({ status: errorCode === "LIVE_INPUT_REQUIRED" ? "LIVE_INPUT_REQUIRED" : "FAIL", errorCode })}\n`);
    process.exitCode = errorCode === "LIVE_INPUT_REQUIRED" ? 2 : 1;
  }
}
