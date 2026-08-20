import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

assert.match(app, /function sanitizeMailHtml/);
assert.match(app, /sandbox=""/);
assert.match(app, /srcDoc=\{safeMailHtml\}/);
assert.match(app, /외부 이미지 표시/);
assert.match(app, /function buildForwardMailHtml/);
assert.match(app, /bodyHtml: mailComposeContext === "forward"/);
assert.doesNotMatch(app, /dangerouslySetInnerHTML/);
for (const value of ["http://localhost", "https://localhost", "http://127.0.0.1", "https://127.0.0.1"]) {
  assert.equal(app.includes(value), false, "금지 브라우저 주소: " + value);
}

console.log("Mail rich content static verification passed.");