import { mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const runId = new Date().toISOString().replace(/[-:.TZ]/g, "");
const base = "http://127.0.0.1:8511/api/v1";
const evidenceDir = new URL(`../../docs/evidence/trust-recovery-phase4-content-api-${runId}/`, import.meta.url);
const result = { runId, requests: [] };

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /token|password|authorization|cookie/i.test(key) ? "[REDACTED]" : redact(item)]));
  }
  return value;
}

async function request(path, options = {}, expected) {
  const response = await fetch(`${base}${path}`, options);
  const body = await response.json().catch(() => ({}));
  result.requests.push({ path, status: response.status, body: redact(body) });
  if (expected !== undefined) expect(expected, response.status, path);
  return { response, body };
}

function expect(status, actual, label) {
  if (actual !== status) throw new Error(`${label}: expected ${status}, got ${actual}`);
}

function assert(ok,label){if(!ok)throw new Error(label)}
async function db(messageId,helpId){const d=JSON.stringify({messageId,helpId});const s=`import json\nfrom app.services.postgres_service import PostgresService\nd=json.loads(${JSON.stringify(d)})\nwith PostgresService().connect() as x:\n with x.cursor() as c:\n  c.execute(\"SELECT status FROM message_keys WHERE id=%s\",(d[\"messageId\"],));m=c.fetchone()\n  c.execute(\"SELECT status FROM help_policy_documents WHERE id=%s\",(d[\"helpId\"],));h=c.fetchone()\n  c.execute(\"SELECT event,status_after FROM audit_logs WHERE target_id=ANY(%s)\",([d[\"messageId\"],d[\"helpId\"]],));a=c.fetchall()\nprint(json.dumps({\"m\":m,\"h\":h,\"a\":a},default=str))`;const {stdout}=await execFileAsync(".\\.venv\\Scripts\\python.exe",["-c",s],{cwd:process.cwd()});return JSON.parse(stdout)}

await mkdir(evidenceDir, { recursive: true });
try {
  const login = await request("/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "admin@moaworks.local", password: "m@68150183" }) });
  expect(200, login.response.status, "login");
  await request("/admin/content/messages", {}, 401);
  await request("/admin/content/messages", { headers: { authorization: "Bearer invalid" } }, 401);
  const headers = { authorization: `Bearer ${login.body.accessToken}`, "content-type": "application/json" };
  const prefix = `verify.phase4.content.${runId}`;
  const systems = await request("/admin/content/messages?status=all", { headers }, 200);
  const systemMessage = systems.body.items.find((item) => item.is_system); assert(systemMessage,"system message missing");
  await request("/admin/content/messages/bulk-status", { method:"POST",headers,body:JSON.stringify({ids:[systemMessage.id],status:"inactive"}) },409);
  const message = await request("/admin/content/messages", { method: "POST", headers, body: JSON.stringify({ key: `${prefix}.message`, defaultLocale: "ko-KR", category: "verify", translation: { locale: "ko-KR", content: "검수" } }) });
  expect(200, message.response.status, "message create");
  await request(`/admin/content/messages/${message.body.id}`, { headers }, 200);
  await request("/admin/content/messages/bulk-status", { method: "POST", headers, body: JSON.stringify({ ids: [message.body.id], status: "inactive" }) }, 200);
  await request("/admin/content/messages/bulk-delete", { method: "POST", headers, body: JSON.stringify({ ids: [message.body.id] }) }, 200);
  const deletedMessage = await request(`/admin/content/messages/${message.body.id}`, { method: "PATCH", headers, body: JSON.stringify({ category: "blocked" }) }, 409);
  expect(409, deletedMessage.response.status, "deleted message lock");
  const help = await request("/admin/content/help-policies", { method: "POST", headers, body: JSON.stringify({ code: `${prefix}.help`, title: "검수 정책", category: "verify", audience: "admin", content: "검수 본문" }) });
  expect(200, help.response.status, "help create");
  await request("/admin/content/help-policies/bulk-status", { method: "POST", headers, body: JSON.stringify({ ids: [help.body.id], status: "published" }) }, 200);
  await request("/admin/content/help-policies/bulk-delete", { method: "POST", headers, body: JSON.stringify({ ids: [help.body.id] }) }, 200);
  const deletedHelp = await request(`/admin/content/help-policies/${help.body.id}`, { method: "PATCH", headers, body: JSON.stringify({ title: "blocked" }) }, 409);
  expect(409, deletedHelp.response.status, "deleted help lock");
  const evidence=await db(message.body.id,help.body.id); result.database=redact(evidence);
  assert(evidence.m?.status==="deleted" && evidence.h?.status==="deleted","PostgreSQL deleted row missing");
  assert(evidence.a.some((x)=>x.event==="content.message.status"&&x.status_after==="deleted") && evidence.a.some((x)=>x.event==="content.help.status"&&x.status_after==="deleted"),"audit missing");
  await writeFile(new URL("api-db-verification.json", evidenceDir), JSON.stringify(result, null, 2));
  console.log(evidenceDir.pathname);
} catch (error) {
  await writeFile(new URL("failure.json", evidenceDir), JSON.stringify({ error: String(error), result }, null, 2));
  throw error;
}
