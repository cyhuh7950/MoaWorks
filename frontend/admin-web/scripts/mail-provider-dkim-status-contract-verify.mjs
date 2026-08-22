import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDirectory, "../../..");
const app = readFileSync(join(root, "frontend", "admin-web", "src", "App.tsx"), "utf8");

let assertions = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  assertions += 1;
};

const formatterStart = app.indexOf("function formatMailProviderDkimStatus");
const formatterEnd = app.indexOf("\n}", formatterStart);
const formatter = app.slice(formatterStart, formatterEnd + 2);

check(formatterStart >= 0, "admin app must centralize the DKIM status label");
check(formatter.includes('provider.providerKey === "oci_email_delivery"'), "OCI DKIM must use managed-DKIM semantics");
check(formatter.includes("provider.dkimDomain") && formatter.includes("provider.dkimSelector"), "OCI DKIM requires domain and selector");
check(formatter.includes("provider.dkimPrivateKeyConfigured"), "self-hosted DKIM must keep the private-key requirement");
check(app.includes("formatMailProviderDkimStatus(provider)"), "provider table must render the centralized DKIM status label");

console.log(`PASS mail provider DKIM status contract (${assertions} assertions)`);
