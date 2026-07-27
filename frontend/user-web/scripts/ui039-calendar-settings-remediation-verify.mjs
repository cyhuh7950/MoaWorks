import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const panel = await readFile(resolve(here, "../src/CalendarSettingsPanel.tsx"), "utf8");
const styles = await readFile(resolve(here, "../src/global.css"), "utf8");

assert.match(panel, /maxLength=\{32\}/, "calendar create name must match server 32-character limit");
assert.match(panel, /defaultValue=\{calendar\.name\}[^>]*maxLength=\{32\}/s, "calendar rename must match server 32-character limit");
assert.ok(panel.includes('item.status === "pending"'), "pending and active viewers must render differently");
assert.ok(panel.includes("열람 중"), "active viewer status must stay visible");
assert.doesNotMatch(panel, /https?:\/\/(?:localhost|127\.0\.0\.1)|NEXT_PUBLIC_API_BASE_URL|host\.docker\.internal/);
assert.match(styles, /#root\s+\.ui039-calendar-settings h2\s*\{[^}]*font-size:\s*16px\s*!important\s*;/s, "UI-039 h2 selector must outrank the common root important heading rule");
assert.match(styles, /#root\s+\.ui039-calendar-settings h3\s*\{[^}]*font-size:\s*14px\s*!important\s*;/s, "UI-039 h3 selector must outrank the common root important heading rule");

console.log("UI-039 remediation verifier: 7/7 passed");
