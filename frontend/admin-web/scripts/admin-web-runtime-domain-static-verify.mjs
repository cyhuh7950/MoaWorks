import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appSource = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
const assertions = [
  ["admin production fallback derives the domain from the current host", /function resolveDefaultCompanyDomain\(\)/.test(appSource) && /domain: resolveDefaultCompanyDomain\(\)/.test(appSource)],
  ["admin production host fallback selects the sinsan domain", /endsWith\("\.moaworks\.sinsan\.kr"\)/.test(appSource) && /\? "moaworks\.sinsan\.kr" :/.test(appSource)],
];
const failures = assertions.filter(([, passed]) => !passed).map(([name]) => name);
if (failures.length) {
  console.error(JSON.stringify({ passed: assertions.length - failures.length, total: assertions.length, failures }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ passed: assertions.length, total: assertions.length, failures: [] }));
