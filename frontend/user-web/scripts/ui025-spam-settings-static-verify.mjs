import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const [app, api, css, route, service, migration] = await Promise.all([
  readFile(resolve(root, "src/App.tsx"), "utf8"),
  readFile(resolve(root, "src/api.ts"), "utf8"),
  readFile(resolve(root, "src/global.css"), "utf8"),
  readFile(resolve(root, "../../backend/app/api/routes/mail.py"), "utf8"),
  readFile(resolve(root, "../../backend/app/services/spam_settings_service.py"), "utf8"),
  readFile(resolve(root, "../../backend/migrations/029_spam_settings.sql"), "utf8"),
]);

const requireText = (source, marker) => {
  if (!source.includes(marker)) throw new Error(`UI-025 marker missing: ${marker}`);
};

for (const marker of ["MailSpamSettingsPanel", "스팸 필터 사용", "규칙 추가", "구분", "대상", "값", "활성", "생성일", "관리", "user-mail-spam-settings__table-wrap"]) requireText(app + css, marker);
for (const marker of ['"/mail/spam-settings"', "encodeURIComponent(ruleId)", "fetchSpamSettings", "createSpamRule", "updateSpamRule", "deleteSpamRule"]) requireText(api, marker);
for (const marker of ['@router.get("/spam-settings"', '@router.patch("/spam-settings"', '@router.post("/spam-settings/rules"', "permission_required(\"mail:read\")"]) requireText(route, marker);
for (const marker of ["normalize_spam_email", "normalize_spam_domain", "evaluate_sender", "company_id = %s and user_id = %s"]) requireText(service.toLowerCase(), marker.toLowerCase());
for (const marker of ["user_spam_policies", "user_spam_rules", "unique (company_id, user_id, match_type, match_value)"]) requireText(migration.toLowerCase(), marker);

const spamApi = api.slice(api.indexOf("// UI-025 spam settings"));
for (const forbidden of ["http://", "https://", "localhost", "127.0.0.1", "NEXT_PUBLIC_"]) {
  if (spamApi.includes(forbidden)) throw new Error(`UI-025 same-origin violation: ${forbidden}`);
}

console.log("UI-025 spam settings static verification passed");
