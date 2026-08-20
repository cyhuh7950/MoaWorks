import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../src");
const [app, messenger, css] = await Promise.all([
  readFile(resolve(src, "App.tsx"), "utf8"),
  readFile(resolve(src, "MessengerPanel.tsx"), "utf8"),
  readFile(resolve(src, "global.css"), "utf8"),
]);

assert.ok(app.includes("resolveRecipientInput"), "recipient resolution helper missing");
assert.match(app, /split\(\/\[;,\\n\]\/[a-z]*\)/, "multiple recipient names must be split");
assert.ok(app.includes('source === "directory"') && app.includes('source === "recent"'), "exact names must resolve from directory and recent sources as well as contacts");
assert.match(app, /await resolveRecipientInput\("to"/s, "send path must resolve To before normalization");
assert.match(app, /await resolveRecipientInput\("cc"/s, "send path must resolve Cc before normalization");
assert.match(app, /await resolveRecipientInput\("bcc"/s, "send path must resolve Bcc before normalization");

assert.ok(app.includes('response.fallbackUsed') && app.includes('item.source === "fallback"'), "incoming translation must reject provider fallback instead of displaying the original as translated");
assert.ok(app.includes("메일 번역에 실패했습니다"), "incoming translation failure feedback missing");

assert.ok(messenger.includes('className="ui040-participant-option"'), "participant option class missing");
assert.match(css, /\.ui040-participant-option\s*\{[^}]*grid-template-columns:\s*16px\s+minmax\(0,\s*1fr\)/s, "participant option must use a fixed checkbox column");
assert.match(css, /\.ui040-participant-option\s+input\[type="checkbox"\]\s*\{[^}]*min-height:\s*14px\s*!important/s, "participant checkbox height override missing");
assert.match(css, /\.ui040-participant-option\s+input\[type="checkbox"\]\s*\{[^}]*width:\s*14px/s, "participant checkbox width override missing");

console.log("CR-034~CR-036 regression verifier: 12/12 passed");
