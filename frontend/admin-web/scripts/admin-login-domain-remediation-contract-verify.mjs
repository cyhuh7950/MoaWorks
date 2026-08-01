import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDirectory, "../../..");
const read = (...segments) => readFileSync(join(root, ...segments), "utf8");

const app = read("frontend", "admin-web", "src", "App.tsx");
const api = read("frontend", "admin-web", "src", "api.ts");

let assertions = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  assertions += 1;
};

check(api.includes("function fetchPublicUiContract"), "admin API client must expose the public UI contract");
check(api.includes('request<UiContract>("/ui-contract")'), "public UI contract must use same-origin /api/v1/ui-contract");
const publicFetchStart = api.indexOf("function fetchPublicUiContract");
const publicFetchEnd = api.indexOf("function updateUiContract", publicFetchStart);
const publicFetch = api.slice(publicFetchStart, publicFetchEnd);
check(!publicFetch.includes("Authorization") && !publicFetch.includes("authHeaders"), "public UI contract fetch must not require authentication");
check(app.includes("fetchPublicUiContract"), "admin app must load the public UI contract before authentication");
check(app.includes('useState<PublicUiContractState>("pending")'), "public UI contract readiness must be explicit");
check(app.includes('setPublicUiContractState("ready")'), "successful public UI contract load must unlock login");
check(app.includes('setPublicUiContractState("error")'), "public UI contract failure must be explicit");
const loginHandlerStart = app.indexOf("async function handleLogin");
const loginHandlerEnd = app.indexOf("function resetDepartmentEditor", loginHandlerStart);
const loginHandler = app.slice(loginHandlerStart, loginHandlerEnd);
const loginGuard = loginHandler.indexOf('publicUiContractState !== "ready"');
const loginRequest = loginHandler.indexOf("const response = await login");
check(loginGuard >= 0 && loginRequest > loginGuard, "login request must be guarded by public contract readiness");
check(app.includes('disabled={loading || publicUiContractState !== "ready"}'), "login button must remain disabled until the public contract is ready");
check(app.includes("회사 도메인을 확인하지 못했습니다"), "login screen must explain public contract failure");
check(!app.includes("moaworks.sinsan.kr") && !api.includes("moaworks.sinsan.kr"), "production company domain must not be hardcoded");

console.log(`PASS admin login domain remediation contract (${assertions} assertions)`);
