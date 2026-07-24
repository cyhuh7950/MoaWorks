import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const [app, api, css, route, service, migration] = await Promise.all([
  readFile(resolve(root, "src/App.tsx"), "utf8"),
  readFile(resolve(root, "src/api.ts"), "utf8"),
  readFile(resolve(root, "src/global.css"), "utf8"),
  readFile(resolve(root, "../../backend/app/api/routes/mail.py"), "utf8"),
  readFile(resolve(root, "../../backend/app/services/mail_auto_classification_service.py"), "utf8"),
  readFile(resolve(root, "../../backend/migrations/030_mail_auto_classification.sql"), "utf8"),
]);

const required = (source, marker) => { if (!source.includes(marker)) throw new Error(`UI-026 marker missing: ${marker}`); };
for (const marker of ["MailAutoClassificationPanel", "자동분류 사용", "규칙 추가", "선택 삭제", "우선순위", "조건 요약", "마지막 실행 결과", "user-mail-auto-classification__table-wrap"]) required(app + css, marker);
for (const marker of ["fetchAutoClassificationSettings", "createAutoClassificationRule", "updateAutoClassificationRule", "deleteAutoClassificationRules", "reorderAutoClassificationRules", '"/mail/settings/auto-classification"']) required(api, marker);
for (const marker of ['@router.get("/settings/auto-classification"', '@router.patch("/settings/auto-classification"', 'permission_required("mail:read")']) required(route, marker);
for (const marker of ["evaluate_recipient", "company_id = %s", "user_id = %s", "savepoint"]) required(service.toLowerCase(), marker.toLowerCase());
for (const marker of ["mail_auto_classification_policies", "mail_auto_classification_rules", "mail_auto_classification_events"]) required(migration.toLowerCase(), marker);
const section = api.slice(api.indexOf("// UI-026 auto classification"));
for (const forbidden of ["http://", "https://", "localhost", "127.0.0.1", "NEXT_PUBLIC_"]) if (section.includes(forbidden)) throw new Error(`UI-026 same-origin violation: ${forbidden}`);
console.log("UI-026 auto classification static verification passed");
