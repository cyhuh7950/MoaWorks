import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { runtime, mask } from "./runtime-contract.mjs";

function requestWithCurl(url, timeoutMs = 5000) {
  return new Promise((resolveRequest, rejectRequest) => {
    const child = spawn("curl.exe", ["--max-time", String(Math.ceil(timeoutMs / 1000)), "-sS", "-w", "\n%{http_code}", url], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { child.kill(); rejectRequest(new Error(`timeout: ${url}`)); }, timeoutMs + 1000);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", (error) => { clearTimeout(timer); rejectRequest(error); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return rejectRequest(new Error(`curl failed (${code}): ${stderr.trim() || url}`));
      const separator = stdout.lastIndexOf("\n");
      if (separator < 0) return rejectRequest(new Error(`missing HTTP status: ${url}`));
      resolveRequest({ status: Number(stdout.slice(separator + 1).trim()), bodyText: stdout.slice(0, separator) });
    });
  });
}

export async function createHarness(runId) {
  const evidenceDir = resolve(runtime.evidenceRoot, runId);
  await mkdir(evidenceDir, { recursive: true });
  const progressPath = resolve(evidenceDir, "progress.jsonl");
  const progress = async (stage, status, detail = {}) => {
    await appendFile(progressPath, `${JSON.stringify(mask({ at: new Date().toISOString(), stage, status, detail }))}\n`);
  };
  const step = async (stage, action, timeoutMs = 15000) => {
    await progress(stage, "started");
    let timer;
    try {
      const value = await Promise.race([action(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${stage} timed out after ${timeoutMs}ms`)), timeoutMs); })]);
      clearTimeout(timer);
      await progress(stage, "succeeded");
      return value;
    } catch (error) {
      clearTimeout(timer);
      await progress(stage, "failed", { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  };
  const g0 = () => step("G0-runtime", async () => {
    const urls=[{name:"backend",url:runtime.backend+"/api/v1/health"},{name:"user-web-proxy",url:runtime.userWeb+"/api/v1/health"}]; const checks=[];
    for(const target of urls){let final; for(let attempt=1;attempt<=3;attempt+=1){const started=Date.now(); try{const response=await requestWithCurl(target.url,5000);let body={};try{body=JSON.parse(response.bodyText||"{}")}catch{body={raw:response.bodyText}} final={name:target.name,url:target.url,attempt,status:response.status,durationMs:Date.now()-started,body}}catch(error){final={name:target.name,url:target.url,attempt,status:0,durationMs:Date.now()-started,error:error instanceof Error?error.message:String(error)}} await progress("G0-observation",final.status===200?"success":"failed",final); if(final.status===200)break;} checks.push(final)}
    const backend=checks[0]; if(checks.some((check)=>check.status!==200))throw new Error("G0 HTTP failure: "+JSON.stringify(checks)); if(backend.body.initialized!==true||backend.body.components?.db?.status!=="ok"||backend.body.components?.mail?.status!=="ok")throw new Error("G0 backend health is not initialized with DB and mail ok"); return checks;
  },60000);
  return { runId, evidenceDir, progress, step, g0, async finish(result) { await writeFile(resolve(evidenceDir, "result.json"), `${JSON.stringify(mask(result), null, 2)}\n`); } };
}
