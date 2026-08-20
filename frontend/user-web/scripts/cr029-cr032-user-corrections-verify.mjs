import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../src");
const [app, css, messenger, api] = await Promise.all([
  readFile(resolve(src, "App.tsx"), "utf8"),
  readFile(resolve(src, "global.css"), "utf8"),
  readFile(resolve(src, "MessengerPanel.tsx"), "utf8"),
  readFile(resolve(src, "api.ts"), "utf8"),
]);

for (const label of ["주소록", "조직도", "최근 수신자"])
  assert.ok(app.includes(label), `recipient source tab missing: ${label}`);
assert.ok(app.includes("confirmRecipientInput") && app.includes('event.key === "Enter"'), "recipient name must be confirmed on Enter");
assert.ok(app.includes("formatConfirmedRecipient") && app.includes("<${suggestion.email}>"), "confirmed recipient must preserve name and exact address");

assert.ok(app.includes('data-testid="approval-document-body"'), "approval body priority panel missing");
assert.match(css, /\[data-testid="approval-document-body"\][^{]*\{[^}]*white-space:\s*pre-wrap/s, "approval body must preserve full text line breaks");

assert.ok(app.includes("mailId: translatingMailId"), "incoming translation must be bound to the mail selected when translation started");
assert.ok(app.includes("mailTranslationPreview?.mailId === selectedMailDetail.mailId"), "translation must render only for the currently selected mail");
assert.ok(app.includes("const targetLocale = toTranslationLocale(locale)"), "incoming mail translation must target the signed-in user's general locale");
assert.ok(!app.includes("mailPreferences?.translationTargetLocale || locale"), "incoming mail must not prefer a separate mail translation locale");

assert.ok(api.includes("senderLocale: string"), "messenger message sender locale API type missing");
assert.ok(messenger.includes("messageNeedsTranslation(item.senderLocale, locale)"), "messenger must compare configured locales");
assert.ok(!messenger.includes("hangulCount") && !messenger.includes("latinCount"), "messenger must not inspect characters to infer user language");

console.log("CR-029~CR-032 user corrections verifier: 13/13 passed");
