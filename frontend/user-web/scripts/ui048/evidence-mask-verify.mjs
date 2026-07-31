import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const evidenceRoot = resolve(here, "../../../../docs/evidence/user-web-redesign/UI-048/UI048_20260731T084647_preflight");

async function files(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) output.push(...await files(path));
    else output.push(path);
  }
  return output;
}

function sensitiveKey(value, source) {
  if (Array.isArray(value)) return value.some((child) => sensitiveKey(child, source));
  if (!value || typeof value !== "object") return false;
  for (const [key, child] of Object.entries(value)) {
    assert.doesNotMatch(key, /^(?:password|hash|token|cookie|set-cookie|authorization|secret|rawQuery|queryString)$/i, `sensitive evidence key in ${source}`);
    if (sensitiveKey(child, source)) return true;
  }
  return false;
}

const evidenceFiles = await files(evidenceRoot);
assert.throws(() => sensitiveKey({ hash: "sentinel" }, "self-test"), /sensitive evidence key/);
assert.throws(() => sensitiveKey({ "set-cookie": "sentinel" }, "self-test"), /sensitive evidence key/);
let jsonCount = 0;
for (const path of evidenceFiles) {
  const text = await readFile(path, "utf8");
  assert.doesNotMatch(text, /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i, `Bearer value in ${path}`);
  assert.doesNotMatch(text, /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/, `JWT-like value in ${path}`);
  assert.doesNotMatch(text, /(?:^|[?&])(?:access_?token|auth|authorization|password|secret)=[^&\s]+/im, `sensitive query in ${path}`);
  assert.doesNotMatch(text, /^(?:set-cookie|cookie|authorization):\s*\S+/im, `sensitive header in ${path}`);
  if (extname(path) === ".json") {
    sensitiveKey(JSON.parse(text), path);
    jsonCount += 1;
  }
}

console.log(`PASS UI-048 evidence parse and masking (${jsonCount} JSON files, ${evidenceFiles.length} total files)`);
