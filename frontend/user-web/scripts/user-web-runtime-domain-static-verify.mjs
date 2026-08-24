import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appSource = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");

const assertions = [
  ["mail detail sample does not hard-code the legacy local domain", !appSource.includes("ceo@moaworks.local")],
  ["mail detail sample derives its sender domain from the UI contract", /ceo@\$\{uiContract\.company\.domain\}/.test(appSource)],
];

const failures = assertions.filter(([, passed]) => !passed).map(([name]) => name);
if (failures.length) {
  console.error(JSON.stringify({ passed: assertions.length - failures.length, total: assertions.length, failures }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ passed: assertions.length, total: assertions.length, failures: [] }));
