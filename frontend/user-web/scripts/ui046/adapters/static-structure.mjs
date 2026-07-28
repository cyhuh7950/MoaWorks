import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";

function runNode(file, cwd) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [file], { cwd, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("close", (code) => resolveRun({ file, code: code ?? 1, stdout, stderr }));
  });
}

export async function runStaticStructure({ root }) {
  const userWeb = resolve(root, "frontend/user-web");
  const scripts = resolve(userWeb, "scripts");
  const inventory = JSON.parse(await readFile(resolve(scripts, "ui046/verifier-inventory.json"), "utf8"));
  const allowlist = new Set(inventory.groups.find((group) => group.scope === "frontend-source-verifiers").sourceOnlyAllowlist);
  const files = (await readdir(scripts)).filter((name) => name.endsWith("static-verify.mjs") || allowlist.has(name)).sort();
  const results = [];
  for (const file of files) results.push(await runNode(resolve(scripts, file), userWeb));
  return {
    status: results.every((item) => item.code === 0) ? "PASS" : "FAIL",
    count: results.length,
    results: results.map(({ file, code }) => ({ file: relative(root, file).replaceAll("\\", "/"), code })),
  };
}
