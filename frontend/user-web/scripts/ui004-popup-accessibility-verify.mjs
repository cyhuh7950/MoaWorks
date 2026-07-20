import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const workerPath = join(here, "ui004-popup-accessibility-worker.mjs");
const runId = process.env.UI004_RUN_ID || `ui004-common-popup-direct-cli-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
const evidenceDir = join("D:\\Project\\MoaWorks\\docs\\evidence", runId);
const startedAt = Date.now();
const timeoutMs = 60_000;
let settled = false;
let watchdog;

console.log(JSON.stringify({ status: "started", runId, stage: "supervisor", elapsedMs: 0, evidence: evidenceDir }));

const child = spawn(process.execPath, [workerPath], {
  cwd: here,
  env: { ...process.env, UI004_RUN_ID: runId },
  windowsHide: true,
  stdio: "inherit",
});

function finish(exitCode, detail = {}) {
  if (settled) return;
  settled = true;
  if (watchdog) clearTimeout(watchdog);
  const output = exitCode === 0 ? console.log : console.error;
  output(JSON.stringify({
    status: exitCode === 0 ? "passed" : "failed",
    runId,
    stage: "supervisor",
    durationMs: Date.now() - startedAt,
    evidence: evidenceDir,
    ...detail,
  }));
  process.exit(exitCode);
}

watchdog = setTimeout(() => {
  const killResult = child.pid
    ? spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
        timeout: 5_000,
      })
    : null;
  finish(1, {
    reason: "supervisor-timeout",
    workerPid: child.pid ?? null,
    killStatus: killResult?.status ?? null,
  });
}, timeoutMs);

child.once("error", error => {
  finish(1, { reason: "worker-spawn-error", error: String(error) });
});

child.once("close", (code, signal) => {
  finish(code === 0 ? 0 : 1, { workerExitCode: code, signal });
});
