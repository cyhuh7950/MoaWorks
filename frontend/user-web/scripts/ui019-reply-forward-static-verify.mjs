import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");

assert.match(app, /type MailComposeContext = "new" \| "reply" \| "reply_all" \| "forward"/);
assert.match(app, /function buildMailReplyRecipients/);
assert.match(app, /function buildMailQuotedBody/);
assert.match(app, /while \(\/\^\(re\|fwd\|fw\):/i);
assert.match(app, /recipientKind === "bcc"/);
assert.match(app, /me\?\.userEmail/);
assert.match(app, />전체답장</);
assert.match(app, /openMailComposeFromDetail\("reply_all"\)/);
assert.match(app, /selectedForwardAttachmentIds/);
assert.match(app, /원문 첨부/);
assert.match(app, /copiedAttachmentIds/);
assert.match(api, /composeAction\?: "new" \| "reply" \| "reply_all" \| "forward"/);
assert.match(api, /sourceMailId\?: string/);
assert.match(api, /copiedAttachmentIds\?: string\[\]/);

const quotedBodySection = app.match(/function buildMailQuotedBody[\s\S]*?\n\}/)?.[0] ?? "";
assert.doesNotMatch(quotedBodySection, /recipientKind === "bcc"/);
assert.doesNotMatch(quotedBodySection, /storageKey|externalDeliveries|provider/i);

console.log("UI-019 reply/forward static verification passed.");

