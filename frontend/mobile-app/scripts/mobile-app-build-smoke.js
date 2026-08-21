#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

function nowIso() {
  return new Date().toISOString();
}

function safeSha256(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function findExecutable(command) {
  if (process.platform === "win32") {
    const which = spawnSync("where", [command], { encoding: "utf8" });
    if (which.status === 0 && which.stdout?.trim()) {
      return which.stdout.split(/\r?\n/)[0].trim();
    }
    return null;
  }

  const which = spawnSync("which", [command], { encoding: "utf8" });
  if (which.status === 0 && which.stdout?.trim()) {
    return which.stdout.trim();
  }
  return null;
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  return {
    command: `${command} ${args.join(" ")}`,
    status: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

const projectRoot = path.resolve(__dirname, "..");
const evidenceDir = path.resolve(projectRoot, "build-evidence");
fs.mkdirSync(evidenceDir, { recursive: true });
const runId = nowIso().replace(/[:.]/g, "-");
const logPath = path.join(evidenceDir, `mobile-app-build-${runId}.log`);
const reportPath = path.join(evidenceDir, `mobile-app-build-${runId}.json`);
const logLines = [];

function appendLog(message) {
  const line = `${nowIso()} ${message}`;
  logLines.push(line);
  fs.appendFileSync(logPath, `${line}\n`);
}

function collectFileInfo(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const stat = fs.statSync(filePath);
  return {
    path: path.relative(projectRoot, filePath),
    size: stat.size,
    sha256: safeSha256(filePath),
  };
}

const report = {
  executedAt: nowIso(),
  projectRoot,
  runId,
  mode: "android",
  checks: [],
  commands: [],
  artifacts: [],
  status: "success",
  blockerCode: null,
  blockerMessage: "",
};

appendLog("Phase-7 mobile build smoke start");
appendLog(`projectRoot=${projectRoot}`);
appendLog(`platform=${process.platform} node=${process.version}`);

const packageJsonPath = path.join(projectRoot, "package.json");
if (!fs.existsSync(packageJsonPath)) {
  report.status = "blocked";
  report.blockerCode = "MOBILE_APP_PACKAGE_MISSING";
  report.blockerMessage = "mobile-app package.json not found";
  appendLog(report.blockerMessage);
}

const nodeModulesPath = path.join(projectRoot, "node_modules");
const appTsxPath = path.join(projectRoot, "App.tsx");
const indexJsPath = path.join(projectRoot, "index.js");
const appJsonPath = path.join(projectRoot, "app.json");
const metroConfigPath = path.join(projectRoot, "metro.config.js");
const gradleProjectPath = path.join(projectRoot, "android");
const rnBinary = findExecutable("react-native");
const nodeExecutable = findExecutable("node");
const npmExecutable = findExecutable("npm");
const npxExecutable = findExecutable("npx");

report.checks.push({ key: "node", status: !!nodeExecutable, path: nodeExecutable ?? "" });
report.checks.push({ key: "npm", status: !!npmExecutable, path: npmExecutable ?? "" });
report.checks.push({ key: "npx", status: !!npxExecutable, path: npxExecutable ?? "" });
report.checks.push({ key: "app_entry_file", status: fs.existsSync(appTsxPath), path: "App.tsx" });
report.checks.push({ key: "android_entry_file", status: fs.existsSync(indexJsPath), path: "index.js" });
report.checks.push({ key: "app_registry_config", status: fs.existsSync(appJsonPath), path: "app.json" });
report.checks.push({ key: "node_modules", status: fs.existsSync(nodeModulesPath), path: "node_modules" });
report.checks.push({ key: "react_native_binary", status: !!rnBinary, path: rnBinary ?? "" });
report.checks.push({ key: "android_project", status: fs.existsSync(gradleProjectPath), path: "android" });
report.checks.push({
  key: "metro_config_or_default",
  status: fs.existsSync(metroConfigPath) || true,
  path: "metro.config.js(optional)",
});

appendLog(`check node=${!!nodeExecutable}`);
appendLog(`check npm=${!!npmExecutable}`);
appendLog(`check npx=${!!npxExecutable}`);
appendLog(`check node_modules=${fs.existsSync(nodeModulesPath)}`);
appendLog(`check react_native_binary=${!!rnBinary}`);
appendLog(`check app_entry_file=${fs.existsSync(appTsxPath)}`);
appendLog(`check android_entry_file=${fs.existsSync(indexJsPath)}`);
appendLog(`check app_registry_config=${fs.existsSync(appJsonPath)}`);
appendLog(`check android_project=${fs.existsSync(gradleProjectPath)}`);

const missingCritical = report.checks.filter((item) => item.key !== "metro_config_or_default" && !item.status);

const appSource = fs.existsSync(appTsxPath) ? fs.readFileSync(appTsxPath, "utf8") : "";
const homeContractChecks = [
  ["home_card_alerts", 'id: "alerts"'],
  ["home_card_approval", 'id: "approval"'],
  ["home_card_chat", 'id: "chat"'],
  ["home_card_mail", 'id: "mail"'],
  ["home_card_accessibility", 'accessibilityLabel={`${item.title} 화면 열기`}'],
  ["home_today_schedule", "오늘 일정"],
  ["home_recent_chat", "최근 대화"],
];
for (const [key, marker] of homeContractChecks) {
  const status = appSource.includes(marker);
  report.checks.push({ key, status, marker });
  appendLog(`check ${key}=${status}`);
}

const missingHomeContract = report.checks.filter((item) => item.key.startsWith("home_") && !item.status);
if (missingHomeContract.length > 0) {
  report.status = "blocked";
  report.blockerCode = "MOBILE_HOME_CONTRACT_MISSING";
  report.blockerMessage = `Missing home contract markers: ${missingHomeContract.map((i) => i.key).join(", ")}`;
  appendLog(`blocker: ${report.blockerMessage}`);
}

const mailContractChecks = [
  ["mail_dev_samples", "developmentMailSamples"],
  ["mail_search", 'accessibilityLabel="메일 검색"'],
  ["mail_filter_unread", '"안 읽음"'],
  ["mail_filter_starred", '"중요"'],
  ["mail_row_sender", "item.senderEmail"],
  ["mail_row_subject", "item.subject"],
  ["mail_row_preview", "item.preview || item.snippet"],
  ["mail_row_date", "formatStamp(item.receivedAt || item.sentAt)"],
  ["mail_detail_open", "메일 열기"],
];
for (const [key, marker] of mailContractChecks) {
  const status = appSource.includes(marker);
  report.checks.push({ key, status, marker });
  appendLog(`check ${key}=${status}`);
}

const missingMailContract = report.checks.filter((item) => item.key.startsWith("mail_") && !item.status);
if (missingMailContract.length > 0) {
  report.status = "blocked";
  report.blockerCode = "MOBILE_MAIL_CONTRACT_MISSING";
  report.blockerMessage = `Missing mail contract markers: ${missingMailContract.map((i) => i.key).join(", ")}`;
  appendLog(`blocker: ${report.blockerMessage}`);
}

const workflowContractChecks = [
  ["approval_status_tabs", "긴급 승인 / 대기 문서 / 최근 처리"],
  ["approval_submit_action", "승인"],
  ["approval_reject_action", "반려"],
  ["chat_recent_rooms", "최근 대화 / 고정 채널 / 미확인 메시지"],
  ["chat_message_input", "메시지를 입력하세요."],
  ["calendar_month", "2026년 8월"],
  ["calendar_event", "주간회의"],
  ["directory_search", "사원 정보 검색"],
  ["ai_chat", "연결된 LLM에게 질문하고 검색"],
  ["integrated_search", "메일·결재·메신저 통합 검색"],
  ["mobile_settings", "앱 기본 설정"],
];
for (const [key, marker] of workflowContractChecks) {
  const status = appSource.includes(marker);
  report.checks.push({ key, status, marker });
  appendLog(`check ${key}=${status}`);
}

const missingWorkflowContract = report.checks.filter((item) => workflowContractChecks.some(([key]) => key === item.key) && !item.status);
if (missingWorkflowContract.length > 0) {
  report.status = "blocked";
  report.blockerCode = "MOBILE_WORKFLOW_CONTRACT_MISSING";
  report.blockerMessage = `Missing workflow contract markers: ${missingWorkflowContract.map((i) => i.key).join(", ")}`;
  appendLog(`blocker: ${report.blockerMessage}`);
}

if (missingCritical.length > 0) {
  report.status = "blocked";
  report.blockerCode = "MOBILE_BUILD_PREREQUISITE_MISSING";
  report.blockerMessage = `Missing required prereqs: ${missingCritical.map((i) => i.key).join(", ")}`;
  appendLog(`blocker: ${report.blockerMessage}`);
  fs.writeFileSync(logPath, `${logLines.join("\n")}\n`, { encoding: "utf8" });
  report.artifacts.push(collectFileInfo(logPath));
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  report.artifacts.push(collectFileInfo(reportPath));
  console.log(`STATUS=${report.status}`);
  console.log(`BLOCKER=${report.blockerCode}`);
  console.log(`DETAIL=${report.blockerMessage}`);
  console.log(`LOG=${path.relative(projectRoot, logPath)}`);
  console.log(`REPORT=${path.relative(projectRoot, reportPath)}`);
  process.exit(2);
}

const bundleOutput = path.join(evidenceDir, `bundle-${runId}.js`);
const bundleCli = path.join(projectRoot, "node_modules", "react-native", "cli.js");
const commandResult = runCommand(process.execPath, [bundleCli,
  "bundle",
  "--platform",
  "android",
  "--dev",
  "false",
  "--entry-file",
  "index.js",
  "--bundle-output",
  bundleOutput,
  "--assets-dest",
  evidenceDir,
  "--reset-cache",
]);

report.commands.push({
  command: commandResult.command,
  status: commandResult.status,
  stdout: commandResult.stdout ? commandResult.stdout.slice(0, 4000) : "",
  stderr: commandResult.stderr ? commandResult.stderr.slice(0, 4000) : "",
});

appendLog(`command status=${commandResult.status}`);
appendLog(`command stdout=${commandResult.stdout ? "captured" : "empty"}`);
appendLog(`command stderr=${commandResult.stderr ? "captured" : "empty"}`);

if (commandResult.status !== 0) {
  report.status = "blocked";
  report.blockerCode = "MOBILE_BUILD_COMMAND_FAILED";
  report.blockerMessage = `npx react-native bundle failed with exit code ${commandResult.status}`;
  appendLog(`build failed: ${commandResult.stderr || commandResult.stdout || "no output"}`);
}

const bundleInfo = collectFileInfo(bundleOutput);
if (bundleInfo) {
  report.artifacts.push(bundleInfo);
}

if (report.status === "blocked" && bundleInfo) {
  report.blockerCode = `${report.blockerCode}:bundle-output-generated`;
}

report.artifacts.push(collectFileInfo(logPath));
fs.writeFileSync(logPath, `${logLines.join("\n")}\n`, { encoding: "utf8" });
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
report.artifacts.push(collectFileInfo(reportPath));

console.log(`STATUS=${report.status}`);
console.log(`REPORT=${path.relative(projectRoot, reportPath)}`);
console.log(`LOG=${path.relative(projectRoot, logPath)}`);
if (report.blockerCode) {
  console.log(`BLOCKER=${report.blockerCode}`);
  console.log(`MESSAGE=${report.blockerMessage}`);
  process.exit(2);
}

if (bundleInfo && bundleInfo.sha256) {
  console.log(`ARTIFACT=${path.relative(projectRoot, bundleOutput)} SHA256=${bundleInfo.sha256}`);
} else {
  console.log("ARTIFACT=none");
}
