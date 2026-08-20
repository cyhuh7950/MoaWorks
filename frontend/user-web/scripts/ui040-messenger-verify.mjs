import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../src");
const [panel, api, css, app] = await Promise.all([
  readFile(resolve(src, "MessengerPanel.tsx"), "utf8"),
  readFile(resolve(src, "api.ts"), "utf8"),
  readFile(resolve(src, "global.css"), "utf8"),
  readFile(resolve(src, "App.tsx"), "utf8"),
]);

for (const text of ["메신저", "새 대화", "즐겨찾기", "최근 대화", "대화방 검색", "공유 파일", "참여자 변경", "모두 읽음", "미읽음", "과거 메시지 더 보기", "2주 보관"])
  assert.ok(panel.includes(text), `UI-040 text missing: ${text}`);
for (const token of ["favoriteMessengerRoom", "uploadMessengerAttachment", "downloadMessengerAttachment", "updateMessengerRoomParticipants", "attachments", "expectedUpdatedAt", "nextCursor"])
  assert.ok(api.includes(token), `UI-040 API missing: ${token}`);
assert.ok(panel.includes('className="ui040-messenger"'), "UI-040 scoped workspace missing");
assert.ok(panel.includes("CommonPopup"), "shared accessible popup must be used");
assert.ok(panel.includes("setInterval") && panel.includes("10_000") && panel.includes("clearInterval"), "10-second polling cleanup missing");
assert.ok(panel.includes("visibilitychange") && panel.includes("removeEventListener"), "visibility refresh cleanup missing");
assert.ok(panel.includes('event.ctrlKey') && panel.includes('event.key === "Enter"'), "Ctrl+Enter send missing");
assert.ok(panel.includes("sending") && panel.includes("disabled={sending"), "duplicate send guard missing");
assert.ok(panel.includes("type=\"file\"") && panel.includes("25 * 1024 * 1024"), "real attachment picker/total limit missing");
assert.ok(panel.includes("item.senderUserId === currentUserId") && panel.includes("unreadCount"), "sender-only recipient read state missing");
assert.ok(panel.includes("loading") && panel.includes("error") && panel.includes("검색 결과가 없습니다"), "loading/error/empty states missing");
assert.ok(app.includes("<MessengerPanel token={token}"), "existing messenger menu entry must remain wired");
assert.match(css, /\.ui040-messenger\s*\{[^}]*font-size:\s*12px[^}]*height:\s*100%/s);
assert.match(css, /#root \.ui040-messenger h2\s*\{[^}]*font-size:\s*16px\s*!important/s);
assert.match(css, /\.ui040-room-group\s*>\s*article\s*\{[^}]*min-height:\s*64px/s);
assert.match(css, /\.ui040-room-select\s*\{[^}]*grid-template-rows:\s*repeat\(3,\s*minmax\(0,\s*auto\)\)/s);
assert.match(css, /\.ui040-room-(?:name|preview|meta)[^{]*\{[^}]*min-width:\s*0/s);
assert.match(css, /\.ui040-[^{]+\{[^}]*overflow:\s*(?:auto|hidden)/s);
assert.doesNotMatch(panel, /dangerouslySetInnerHTML|style=\{\{/);
assert.doesNotMatch(panel + api, /https?:\/\/(?:localhost|127\.0\.0\.1)|host\.docker\.internal|NEXT_PUBLIC_API_BASE_URL/);

console.log("UI-040 messenger verifier: 18/18 passed");
