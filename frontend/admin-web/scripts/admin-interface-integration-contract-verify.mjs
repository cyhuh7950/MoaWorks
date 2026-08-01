import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDirectory, "../../..");
const read = (...segments) => readFileSync(join(root, ...segments), "utf8");

const app = read("frontend", "admin-web", "src", "App.tsx");
const api = read("frontend", "admin-web", "src", "api.ts");
const adminRoute = read("backend", "app", "api", "routes", "admin.py");
const apiRouter = read("backend", "app", "api", "router.py");
const directorySchema = read("backend", "app", "schemas", "directory.py");

let assertions = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  assertions += 1;
};

for (const label of [
  "사용자 관리",
  "부서 관리",
  "권한 관리",
  "서비스 운영",
  "메일 설정",
  "저장소/DB 상태",
  "결재/감사",
  "브랜드/화면 설정",
  "다국어/메시지",
  "도움말/정책",
]) {
  check(app.includes(label), `admin navigation must include ${label}`);
}

for (const capability of [
  "downloadOrgImportTemplate",
  "validateOrgImport",
  "applyOrgImport",
  "updateDepartment",
  "deleteDepartment",
  "deleteRole",
  "deleteUser",
  "fetchContentMessages",
  "fetchHelpPolicies",
]) {
  check(api.includes(`function ${capability}`), `admin API client must expose ${capability}`);
}

check(api.includes('const defaultApiBase = "/api/v1";'), "admin API must default to same-origin /api/v1");
check(!/https?:\/\/(?:server|localhost|127\.0\.0\.1)(?::\d+)?/i.test(api), "browser API must not expose internal absolute URLs");

for (const route of [
  '@router.patch("/departments/{department_id}"',
  '@router.delete("/departments/{department_id}"',
  '@router.delete("/roles/{role_id}"',
  '@router.delete("/users/{user_id}"',
  '@router.get("/org-import/template")',
  '@router.post("/org-import/validate"',
  '@router.post("/org-import/apply"',
]) {
  check(adminRoute.includes(route), `admin backend must preserve route ${route}`);
}

check(adminRoute.includes('@router.get("/mail-delivery/status"'), "new main mail-delivery status route must be preserved");
check(adminRoute.includes('@router.patch("/mail-delivery/provider"'), "new main mail-delivery provider route must be preserved");
check(directorySchema.includes("class DepartmentUpdateRequest"), "department update input must be validated by schema");
check(directorySchema.includes("class OrgImportApplyRequest"), "org import apply confirmation must be validated by schema");
check(apiRouter.includes("content_operations.router"), "content operations route must be registered");

console.log(`PASS admin interface integration contract (${assertions} assertions)`);
