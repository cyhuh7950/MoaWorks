import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const baseDir = path.join(root, ".agents", "moaworks-subagent");
const runsDir = path.join(baseDir, "runs");

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function argsOf(argv) {
  const result = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      result._.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) result[key] = true;
    else {
      result[key] = next;
      index += 1;
    }
  }
  return result;
}

function required(args, key) {
  const value = args[key];
  if (!value || value === true) fail(`필수 인자 누락: --${key}`);
  return value;
}

function safeId(value, label) {
  if (!/^[A-Za-z0-9._-]+$/.test(value)) fail(`${label} 형식 오류: ${value}`);
  return value;
}

function runDir(taskId) {
  return path.join(runsDir, safeId(taskId, "taskId"));
}

function statePath(taskId) {
  return path.join(runDir(taskId), "state.json");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function loadState(taskId) {
  const file = statePath(taskId);
  if (!fs.existsSync(file)) fail(`등록되지 않은 taskId: ${taskId}`);
  return readJson(file);
}

function saveState(state, event, detail = {}) {
  state.updatedAt = new Date().toISOString();
  state.history.push({ at: state.updatedAt, event, ...detail });
  writeJson(statePath(state.taskId), state);
}

function resolveRepoFile(input, label) {
  const absolute = path.resolve(root, input);
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) fail(`${label}는 저장소 안에 있어야 합니다: ${input}`);
  if (!fs.existsSync(absolute)) fail(`${label} 파일 없음: ${input}`);
  return { absolute, relative: relative.replaceAll("\\", "/") };
}

function splitPaths(value) {
  if (!value || value === true) return [];
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function renderHandoff(state) {
  const sections = [];
  const developerPrompt = path.join(baseDir, "owoul2-developer-prompt.md");
  sections.push(fs.readFileSync(developerPrompt, "utf8").trim());
  sections.push(`# 작업 식별자\n\n- taskId: ${state.taskId}\n- issueId: ${state.issueId}\n- agentId: ${state.agentId ?? "미할당"}`);

  for (const file of [...state.approvedDesignPaths, ...state.executionPlanPaths, state.workorderPath, state.workerPromptPath]) {
    const absolute = path.join(root, file);
    sections.push(`# 전달 문서: ${file}\n\n${fs.readFileSync(absolute, "utf8").trim()}`);
  }

  sections.push(`# 결과 제출\n\n- 작업자 보고서 작성\n- 구조화 결과: ${path.relative(root, path.join(runDir(state.taskId), "result.latest.json")).replaceAll("\\", "/")}\n- 작업자 보고 전 중단 금지\n- 중단 시 outcome은 INTERRUPTED이며 재개 지점을 반드시 기록`);
  fs.writeFileSync(path.join(runDir(state.taskId), "handoff.md"), `${sections.join("\n\n---\n\n")}\n`, "utf8");
}

function validateFormalFailure(result) {
  const requiredText = ["directCause", "currentState", "remediationProposal", "reportPath"];
  const missing = requiredText.filter((key) => typeof result[key] !== "string" || result[key].trim() === "");
  if (!Array.isArray(result.evidence) || result.evidence.length === 0) missing.push("evidence");
  if (!Array.isArray(result.attemptedAlternatives) || result.attemptedAlternatives.length === 0) missing.push("attemptedAlternatives");
  if (!Array.isArray(result.remaining) || result.remaining.length === 0) missing.push("remaining");
  return missing;
}

function commandInit(args) {
  const taskId = safeId(required(args, "task-id"), "taskId");
  const issueId = safeId(required(args, "issue-id"), "issueId");
  const workorder = resolveRepoFile(required(args, "workorder"), "workorder");
  const workerPrompt = resolveRepoFile(required(args, "worker-prompt"), "worker prompt");
  const designs = splitPaths(args.design).map((value) => resolveRepoFile(value, "design").relative);
  const plans = splitPaths(args.plan).map((value) => resolveRepoFile(value, "plan").relative);
  const directory = runDir(taskId);
  if (fs.existsSync(statePath(taskId))) fail(`이미 등록된 taskId: ${taskId}`);
  fs.mkdirSync(directory, { recursive: true });
  const now = new Date().toISOString();
  const state = {
    taskId,
    issueId,
    status: "READY",
    currentOwner: "OWOUL1",
    agentId: null,
    approvedDesignPaths: designs,
    executionPlanPaths: plans,
    workorderPath: workorder.relative,
    workerPromptPath: workerPrompt.relative,
    issueFailures: {},
    writeLock: { developerCanWrite: false, designerCanWrite: false },
    createdAt: now,
    updatedAt: now,
    history: [{ at: now, event: "INITIALIZED" }]
  };
  writeJson(statePath(taskId), state);
  renderHandoff(state);
  process.stdout.write(`${path.join(directory, "handoff.md")}\n`);
}

function commandBindAgent(args) {
  const state = loadState(required(args, "task-id"));
  state.agentId = required(args, "agent-id");
  saveState(state, "AGENT_BOUND", { agentId: state.agentId });
}

function commandDispatch(args) {
  const state = loadState(required(args, "task-id"));
  state.status = "RUNNING";
  state.currentOwner = "OWOUL2";
  state.writeLock = { developerCanWrite: true, designerCanWrite: false };
  renderHandoff(state);
  saveState(state, "DISPATCHED");
  process.stdout.write(`${path.join(runDir(state.taskId), "handoff.md")}\n`);
}

function commandRecord(args) {
  const state = loadState(required(args, "task-id"));
  const resultFile = resolveRepoFile(required(args, "result"), "result");
  const result = readJson(resultFile.absolute);
  if (result.taskId !== state.taskId) fail("result.taskId가 상태와 다릅니다.");
  if (result.issueId !== state.issueId) fail("result.issueId가 상태와 다릅니다.");
  if (!["SUCCESS", "FORMAL_FAILURE", "INTERRUPTED"].includes(result.outcome)) fail("지원하지 않는 outcome입니다.");

  fs.copyFileSync(resultFile.absolute, path.join(runDir(state.taskId), "result.latest.json"));
  state.writeLock = { developerCanWrite: false, designerCanWrite: false };

  if (result.scopeChange || result.requirementChange || result.majorRiskChange) {
    state.status = "USER_APPROVAL_REQUIRED";
    state.currentOwner = "OWOUL1";
    saveState(state, "USER_APPROVAL_REQUIRED", { outcome: result.outcome });
    return;
  }

  if (result.outcome === "SUCCESS") {
    state.status = "DESIGN_REVIEW_REQUIRED";
    state.currentOwner = "OWOUL1";
    saveState(state, "SUCCESS_RECORDED");
    return;
  }

  if (result.outcome === "INTERRUPTED") {
    state.status = "RESUME_REQUIRED";
    state.currentOwner = "OWOUL1";
    saveState(state, "INTERRUPTION_RECORDED", { resumePoint: result.resumePoint ?? null });
    return;
  }

  const missing = validateFormalFailure(result);
  if (missing.length > 0) {
    state.status = "INVALID_FAILURE_REPORT";
    state.currentOwner = "OWOUL1";
    saveState(state, "INVALID_FAILURE_REPORT", { missing });
    return;
  }

  const count = (state.issueFailures[state.issueId] ?? 0) + 1;
  state.issueFailures[state.issueId] = count;
  if (count < 3) {
    state.status = "REWORK_REQUIRED";
    state.currentOwner = "OWOUL1";
    saveState(state, "FORMAL_FAILURE_RECORDED", { count });
  } else {
    state.status = "DIRECT_IMPLEMENTATION_REQUIRED";
    state.currentOwner = "OWOUL1";
    state.writeLock = { developerCanWrite: false, designerCanWrite: true };
    saveState(state, "THIRD_FAILURE_TAKEOVER", { count });
  }
}

function commandRework(args) {
  const state = loadState(required(args, "task-id"));
  if (!["REWORK_REQUIRED", "INVALID_FAILURE_REPORT"].includes(state.status)) fail(`재작업 전환 불가 상태: ${state.status}`);
  state.workorderPath = resolveRepoFile(required(args, "workorder"), "workorder").relative;
  state.workerPromptPath = resolveRepoFile(required(args, "worker-prompt"), "worker prompt").relative;
  state.status = "REWORK_READY";
  state.currentOwner = "OWOUL1";
  state.writeLock = { developerCanWrite: false, designerCanWrite: false };
  renderHandoff(state);
  saveState(state, "REWORK_INSTRUCTIONS_UPDATED");
  process.stdout.write(`${path.join(runDir(state.taskId), "handoff.md")}\n`);
}

function commandResume(args) {
  const state = loadState(required(args, "task-id"));
  if (!["RESUME_REQUIRED", "REWORK_READY"].includes(state.status)) fail(`재개 불가 상태: ${state.status}`);
  state.status = "RUNNING";
  state.currentOwner = "OWOUL2";
  state.writeLock = { developerCanWrite: true, designerCanWrite: false };
  saveState(state, "DEVELOPER_RESUMED", { agentId: state.agentId });
}

function commandReview(args) {
  const state = loadState(required(args, "task-id"));
  if (state.status !== "DESIGN_REVIEW_REQUIRED") fail(`검토 판정 불가 상태: ${state.status}`);
  const decision = required(args, "decision");
  const statuses = {
    approved: "COMPLETE",
    "major-remediation": "REWORK_REQUIRED",
    "minor-followup": "COMPLETE_WITH_MINOR_FOLLOWUP"
  };
  if (!statuses[decision]) fail(`지원하지 않는 decision: ${decision}`);
  state.status = statuses[decision];
  state.currentOwner = "OWOUL1";
  state.writeLock = { developerCanWrite: false, designerCanWrite: false };
  saveState(state, "DESIGN_REVIEW_COMPLETED", { decision });
}

function commandStatus(args) {
  const state = loadState(required(args, "task-id"));
  process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
}

const args = argsOf(process.argv.slice(2));
const command = args._[0];
const commands = {
  init: commandInit,
  "bind-agent": commandBindAgent,
  dispatch: commandDispatch,
  record: commandRecord,
  rework: commandRework,
  resume: commandResume,
  review: commandReview,
  status: commandStatus
};

if (!commands[command]) {
  fail("사용법: node scripts/moaworks-subagent-state.mjs <init|bind-agent|dispatch|record|rework|resume|review|status> [options]");
}
commands[command](args);
