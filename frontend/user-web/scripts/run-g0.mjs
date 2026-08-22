import { createRunId } from "./runtime-contract.mjs";
import { createHarness } from "./verification-harness.mjs";

const runId = createRunId("verify.g0");
const harness = await createHarness(runId);
const result = { runId, startedAt: new Date().toISOString() };
try {
  result.g0 = await harness.g0();
  result.ok = true;
} catch (error) {
  result.ok = false;
  result.error = error instanceof Error ? error.message : String(error);
}
result.finishedAt = new Date().toISOString();
await harness.finish(result);
console.log(JSON.stringify({ runId, ok: result.ok, evidenceDir: harness.evidenceDir }));
process.exit(result.ok ? 0 : 1);
