import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/global.css", import.meta.url), "utf8");

assert.match(api, /canViewReadReceipts: boolean/);
assert.match(api, /isRead: boolean \| null/);
assert.match(api, /isStarred: boolean \| null/);
assert.match(app, /mailReadReceiptOpen/);
assert.match(app, /canViewReadReceipts/);
assert.match(app, /recipientUserId/);
assert.match(app, /읽음 \$\{readCount\} \/ \$\{internalCount\}/);
assert.match(app, /확인 불가/);
assert.match(app, /aria-label="수신 확인 상세"/);
assert.match(app, /role="dialog"/);
assert.match(app, /event\.key === "Escape"/);
assert.match(app, /setMailReadReceiptOpen\(false\)/);
assert.match(app, /recipientKind === "bcc"/);
assert.match(css, /\.user-mail-read-receipt/);
assert.match(css, /font-size: 12px/);

const detailRequest = api.match(/export async function fetchMailDetail[\s\S]*?\n\}/)?.[0] ?? "";
assert.match(detailRequest, /`\/mail\/\$\{mailId\}`/);
assert.doesNotMatch(`${api}\n${app}`, /https?:\/\/(?:localhost|127\.0\.0\.1|[^\s"'`]*:\d+)/);

console.log("UI-019A mail read receipt static verification passed.");
