import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const panel = read("src/FilePanel.tsx");
const api = read("src/api.ts");
const shell = read("src/WorkspacePanels.tsx");
const css = read("src/global.css");

for (const marker of ["mine", "shared", "department", "recent", "favorites", "trash", "내 파일", "공유받은 파일", "부서 파일", "최근", "즐겨찾기", "휴지통"]) assert.ok(panel.includes(marker), marker);
for (const marker of ["ui043-files__navigation", "ui043-files__list", "ui043-files__detail", "CommonPopup", "popupMode", "selectedId", "requestSequence", "300", "다시 시도"]) assert.ok(panel.includes(marker), marker);
for (const marker of ["업로드", "새 폴더", "새 버전", "이름 변경", "이동", "공유", "휴지통으로 이동", "복원", "다운로드", "버전 이력", "활동 이력"]) assert.ok(panel.includes(marker), marker);
for (const endpoint of ["/workspace/files", "/workspace/file-folders", "/versions", "/restore", "/favorite", "/shares", "/download"]) assert.ok(api.includes(endpoint), endpoint);
assert.ok(shell.includes("<FilePanel"), "files shell must delegate to FilePanel");
assert.match(css, /\.ui043-files[^}]*font-size:\s*12px/s);
assert.match(css, /grid-template-columns:\s*220px\s+minmax\(0,\s*1fr\)\s+320px/);
assert.ok(!`${panel}\n${api}`.match(/https?:\/\/|localhost|127\.0\.0\.1|storageKey|storage_key|serverPath|server_path/));
console.log("UI-043 files static verification passed");
