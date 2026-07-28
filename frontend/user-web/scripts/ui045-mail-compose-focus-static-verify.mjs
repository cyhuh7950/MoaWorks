import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const app = await readFile(resolve(root, "src/App.tsx"), "utf8");

const checks = [
  ["받는 사람 입력 ref 선언", /const mailComposeToRef = useRef<HTMLInputElement>\(null\);/.test(app)],
  ["작성창 개방 시 받는 사람 포커스", /useEffect\(\(\) => \{\s*if \(quickComposeMode !== "mail" \|\| recipientInputLocked\) return;\s*mailComposeToRef\.current\?\.focus\(\);\s*\}, \[quickComposeMode, recipientInputLocked\]\);/s.test(app)],
  ["받는 사람 입력 ref 연결", /<input ref=\{mailComposeToRef\} aria-label="mail-compose-to"/.test(app)],
];

for (const [name, passed] of checks) console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
const failures = checks.filter(([, passed]) => !passed);
console.log(JSON.stringify({ passed: checks.length - failures.length, total: checks.length, failures: failures.map(([name]) => name) }));
assert.equal(failures.length, 0, `UI-045 mail compose focus verifier failed: ${failures.map(([name]) => name).join(", ")}`);
