import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const styles = await readFile(resolve(root, "src/global.css"), "utf8");

const checks = [
  ["보조 메뉴 가로 overflow 차단과 세로 스크롤 보존", /#root \.ui031-shell__sidebar\s*\{[^}]*min-width:\s*0;[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;/s.test(styles)],
  ["보조 메뉴 직접 자식 축소 허용", /#root \.ui031-shell__sidebar > \*\s*\{[^}]*min-width:\s*0;/s.test(styles)],
  ["주요 버튼 줄바꿈", /#root \.ui031-primary-wrap > button\s*\{[^}]*min-width:\s*0;[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/s.test(styles)],
  ["메뉴 항목 승인 너비 유지", /#root \.ui031-menu-item\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/s.test(styles)],
  ["메뉴 제목과 설명 줄바꿈", /#root \.ui031-menu-item strong\s*\{[^}]*overflow-wrap:\s*anywhere;/s.test(styles) && /#root \.ui031-menu-item small\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/s.test(styles)],
  ["메뉴 배지 축소 허용", /#root \.ui031-menu-item em\s*\{[^}]*max-width:\s*100%;[^}]*overflow-wrap:\s*anywhere;/s.test(styles)],
];

for (const [name, passed] of checks) console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
const failures = checks.filter(([, passed]) => !passed);
console.log(JSON.stringify({ passed: checks.length - failures.length, total: checks.length, failures: failures.map(([name]) => name) }));
assert.equal(failures.length, 0, `UI-045 approval sidebar overflow verifier failed: ${failures.map(([name]) => name).join(", ")}`);
