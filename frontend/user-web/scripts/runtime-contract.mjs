import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
export const runtime = { backend: "http://127.0.0.1:8510", adminWeb: "http://127.0.0.1:3510", userWeb: "http://127.0.0.1:3520", db: { host: "127.0.0.1", port: 5432, database: "moaworks" }, protectedLogins: ["admin", "cyhuh", "ysla"], evidenceRoot: resolve(import.meta.dirname, "../../../docs/evidence/local-verification") };
export function createRunId(scope = "verify") { return `${scope}.${Date.now()}.${randomUUID().slice(0, 8)}`; }
export function mask(value) { return JSON.parse(JSON.stringify(value, (key, item) => /password|token|authorization|secret/i.test(key) ? "[REDACTED]" : item)); }