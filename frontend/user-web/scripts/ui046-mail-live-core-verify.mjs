import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/global.css", import.meta.url), "utf8");
const target = process.argv[2] ?? "all";

function sourceSlice(source, start, end) {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(startAt, -1, `missing source marker: ${start}`);
  assert.notEqual(endAt, -1, `missing source marker: ${end}`);
  return source.slice(startAt, endAt);
}

function verifyFolderBoundary() {
  const folderRows = sourceSlice(app, "{mailFoldersData.map", "{mailTagsData.map");
  assert.match(folderRows, /aria-label=\{"메일함 " \+ folder\.name \+ " 열기"\}/);
  assert.match(folderRows, /onClick=\{\(\) => openMailFolder\("folder:" \+ folder\.folderId\)\}/);
  assert.match(folderRows, /aria-label=\{"메일함 " \+ folder\.name \+ " 관리"\}/);
  assert.match(folderRows, /onClick=\{\(event\) => \{ event\.stopPropagation\(\); openMailResourceModal\("folder", folder\); \}\}/);
  const listButton = folderRows.match(/<button[^>]*aria-label=\{"메일함 " \+ folder\.name \+ " 열기"\}[\s\S]*?<\/button>/)?.[0] ?? "";
  const manageButton = folderRows.match(/<button[^>]*aria-label=\{"메일함 " \+ folder\.name \+ " 관리"\}[\s\S]*?<\/button>/)?.[0] ?? "";
  assert.ok(listButton);
  assert.ok(manageButton);
  assert.doesNotMatch(listButton, /openMailResourceModal/);
  assert.doesNotMatch(manageButton, /openMailFolder/);
}

function verifyFolderHitArea() {
  const rowRule = css.match(/\.user-mail-resource-row\s*\{[^}]*\}/)?.[0] ?? "";
  assert.ok(rowRule, "mail resource row CSS rule is missing");
  assert.match(rowRule, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+28px\s+28px\s*;/);

  const openRule = css.match(/\.user-mail-resource-row\s*>\s*button:first-child\s*\{[^}]*\}/)?.[0] ?? "";
  assert.ok(openRule, "mail resource open-button CSS rule is missing");
  assert.match(openRule, /width:\s*100%\s*;/);
  assert.match(openRule, /overflow:\s*hidden\s*;/);
  assert.match(openRule, /text-overflow:\s*ellipsis\s*;/);
  assert.match(openRule, /white-space:\s*nowrap\s*;/);

  const actionRule = css.match(/\.user-mail-resource-row\s*>\s*button:not\(:first-child\)\s*\{[^}]*\}/)?.[0] ?? "";
  assert.ok(actionRule, "mail resource compact action-button CSS rule is missing");
  assert.match(actionRule, /min-width:\s*0\s*;/);
  assert.match(actionRule, /width:\s*28px\s*;/);
  assert.match(actionRule, /padding-inline:\s*2px\s*;/);
  assert.match(actionRule, /justify-content:\s*center\s*;/);
  assert.match(actionRule, /font-size:\s*9px\s*;/);

  assert.equal((css.match(/\.user-mail-resource-row\s*\{/g) ?? []).length, 1, "later resource-row rules must not override the fixed columns");
  assert.equal((css.match(/\.user-mail-resource-row\s*>\s*button:first-child\s*\{/g) ?? []).length, 1, "later open-button rules must not override clipping");
  assert.equal((css.match(/\.user-mail-resource-row\s*>\s*button:not\(:first-child\)\s*\{/g) ?? []).length, 1, "later action-button rules must not override compact sizing");
}

function verifyReceiptMask() {
  const helperSource = app.match(/export function maskMailReadReceiptAddress\(value: string\): string \{[\s\S]*?\n\}/)?.[0];
  assert.ok(helperSource, "mail read-receipt display helper is missing");
  const transpiled = ts.transpileModule(helperSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", transpiled)(module, module.exports);
  const mask = module.exports.maskMailReadReceiptAddress;
  assert.equal(mask("ab@example.com"), "ab***@example.com");
  assert.equal(mask("a@example.com"), "a***@example.com");
  assert.equal(mask(" Ab@Example.COM "), " Ab***@Example.COM ");
  for (const invalid of ["not-an-address", "@example.com", "a@", ""]) {
    const rendered = mask(invalid);
    assert.equal(rendered, "주소 비공개");
    assert.equal(rendered.includes(invalid) && invalid.length > 0, false);
  }
  const receipt = sourceSlice(app, 'id="mail-read-receipt-popover"', "{activeMailFolder === \"sent\"");
  assert.match(receipt, /maskMailReadReceiptAddress\(recipient\.recipientEmail\)/);
  assert.doesNotMatch(receipt, /<strong>\{recipient\.recipientEmail\}<\/strong>/);
  assert.match(app, /mailToRecipients\.map\(\(item\) => item\.recipientEmail\)\.join/);
  assert.match(app, /mailCcRecipients\.map\(\(item\) => item\.recipientEmail\)\.join/);
  assert.equal((app.match(/maskMailReadReceiptAddress\(/g) ?? []).length, 2);
}

function verifyDeliveryStatusClient() {
  const typeSource = sourceSlice(api, "export type MailDeliveryStatusResponse = {", "export type MailRecentRecipient = {");
  assert.match(typeSource, /provider: \{\s*enabled: boolean;\s*lastTestStatus: string;\s*\};/);
  assert.doesNotMatch(typeSource, /\b(?:summary|worker|queue|relay|host|port|username|password|error)\b/i);
  const requestSource = sourceSlice(api, "export async function fetchMailDeliveryStatus", "export async function markMailRead");
  assert.match(requestSource, /request<MailDeliveryStatusResponse>\("\/mail\/delivery\/status"/);
  assert.doesNotMatch(requestSource, /https?:\/\/|localhost|127\.0\.0\.1|NEXT_PUBLIC_API_BASE_URL/);
}

if (target === "folder" || target === "all") {
  verifyFolderBoundary();
  verifyFolderHitArea();
}
if (target === "mask" || target === "all") verifyReceiptMask();
if (target === "delivery" || target === "all") verifyDeliveryStatusClient();
if (!["folder", "mask", "delivery", "all"].includes(target)) throw new Error(`unknown target: ${target}`);

console.log(`UI-046 mail live core ${target} verification passed.`);
