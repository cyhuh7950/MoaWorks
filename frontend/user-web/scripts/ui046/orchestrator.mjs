import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runPreflight } from "./adapters/preflight.mjs";
import { runStaticStructure } from "./adapters/static-structure.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../../..");
const manifestPath = resolve(here, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const command = process.argv[2] || "plan";
const runIdArg = process.argv.find((value) => value.startsWith("--run-id="));
const runId = runIdArg?.slice("--run-id=".length) || "";
const runIdRegex = new RegExp(manifest.runIdPattern);

const sensitiveKey = /password|token|cookie|authorization|secret|set-cookie/i;
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
  if (gaps.length) throw new Error(`핵심 GAP ${gaps.length}개가 남아 LIVE 실행을 차단했습니다: ${gaps.map((area) => area.id).join(", ")}`);
  throw new Error("영역 adapter 등록 후에만 LIVE 실행할 수 있습니다.");
}

const commands = { plan, preflight, static: staticStructure, execute };
if (!commands[command]) throw new Error("사용법: node orchestrator.mjs <plan|preflight|static|execute> [--run-id=UI046_...]");
await commands[command]();
