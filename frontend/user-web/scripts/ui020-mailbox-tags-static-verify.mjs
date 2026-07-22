import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");

for (const marker of ["fetchMailFolders", "createMailFolder", "updateMailFolder", "deleteMailFolder",
  "fetchMailTags", "createMailTag", "updateMailTag", "deleteMailTag", "fetchMailSpam", "fetchMailTrash"]) {
  assert.match(api, new RegExp(marker));
}
assert.match(api, /targetFolderId\?: string/);
assert.match(api, /targetTagId\?: string/);
assert.match(api, /trashViews\?:.*sourceMailbox/);
assert.doesNotMatch(api, /https?:\/\/|localhost|127\.0\.0\.1|NEXT_PUBLIC_API_BASE_URL/);
for (const marker of ["사용자 메일함", "태그", "스팸함", "휴지통", "메일함 이동", "스팸 해제", "영구 삭제"]) {
  assert.match(app, new RegExp(marker));
}
assert.match(app, /mail-folder-modal/);
assert.match(app, /mail-tag-modal/);
assert.match(app, /mail-purge-confirm/);
assert.match(app, /function mailSelectionKey/);
assert.match(app, /sourceMailbox.*inbox.*sent.*draft/);
assert.match(app, /event\.key === "Escape"/);

console.log("UI-020 mailbox/tag static verification passed.");