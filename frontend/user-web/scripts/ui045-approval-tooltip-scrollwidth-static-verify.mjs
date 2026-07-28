import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const styles = await readFile(resolve(root, "src/global.css"), "utf8");

const checks = [
  ["도움말 tooltip 아이콘 기준 배치", /#root \.ui031-help\[data-tooltip\][^{]*\{[^}]*position:\s*relative;/s.test(styles)],
  ["도움말 tooltip 오른쪽 경계 고정", /#root \.ui031-help\[data-tooltip\]::after\s*\{[^}]*left:\s*auto;[^}]*right:\s*0;/s.test(styles)],
  ["도움말 tooltip 가용 너비 제한", /#root \.ui031-help\[data-tooltip\]::after\s*\{[^}]*width:\s*8em;[^}]*max-width:\s*8em;[^}]*box-sizing:\s*border-box;/s.test(styles)],
  ["도움말 tooltip 설명 줄바꿈", /#root \.ui031-help\[data-tooltip\]::after\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/s.test(styles)],
  ["도움말 hover 설명 유지", /#root \.ui031-help\[data-tooltip\]:hover::after[^{]*\{[^}]*opacity:\s*1;/s.test(styles)],
  ["도움말 focus 설명 유지", /#root \.ui031-help\[data-tooltip\]:focus-visible::after[^{]*\{[^}]*opacity:\s*1;/s.test(styles)],
];

for (const [name, passed] of checks) console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
const failures = checks.filter(([, passed]) => !passed);
console.log(JSON.stringify({ passed: checks.length - failures.length, total: checks.length, failures: failures.map(([name]) => name) }));
assert.equal(failures.length, 0, `UI-045 approval tooltip scrollWidth verifier failed: ${failures.map(([name]) => name).join(", ")}`);
