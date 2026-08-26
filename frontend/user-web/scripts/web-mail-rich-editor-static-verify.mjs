import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const app = read("src/App.tsx");
const editor = read("src/MailRichTextEditor.tsx");
const api = read("src/api.ts");
const richText = read("src/mailRichText.ts");
const inlineImages = read("src/mailInlineImages.ts");
const outgoingTranslation = read("src/mailOutgoingTranslation.ts");

const checks = [
  ["textarea removed", !app.includes('<textarea aria-label="mail-compose-body"')],
  ["editor mounted", app.includes("<MailRichTextEditor")],
  ["controlled compose document", app.includes("bodyDocument:") && app.includes("value={mailComposeForm.bodyDocument}")],
  ["dual body payload", app.includes("bodyHtml: mailComposeForm.bodyHtml") && app.includes("bodyText: mailComposeForm.bodyText")],
  ["projection update is atomic", app.includes("projectMailDocument(document)") && app.includes("bodyHtml: projection.bodyHtml") && app.includes("bodyText: projection.bodyText")],
  ["inline upload uses staging contract", app.includes('uploadMailAttachment(targetToken, file, "inline")')],
  ["outgoing translation preserves document structure", app.includes("extractTranslationSegments") && app.includes("applyTranslatedSegments") && outgoingTranslation.includes("normalizeOutgoingTranslationLocale")],
  ["CID preview fetch is authenticated", app.includes("fetchMailInlinePreview")],
  ["CID preview URLs are released", app.includes("URL.revokeObjectURL")],
  ["inline rows excluded from downloads", app.includes('attachment.disposition !== "inline"')],
  ["no raw html compose ui", !/HTML 원본|dangerouslySetInnerHTML/i.test(app + editor)],
  ["same origin editor path", !/https?:\/\/(localhost|127\.0\.0\.1|server)/.test(app + api + editor)],
  ["Task 7 projection remains consumed", richText.includes("projectMailDocument") && inlineImages.includes("InlineImageRegistry")],
];

const failed = checks.filter(([, passed]) => !passed).map(([name]) => name);
if (failed.length) {
  console.error(`web mail rich editor static verification failed: ${failed.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log(`web mail rich editor static verification passed (${checks.length} checks)`);
}
