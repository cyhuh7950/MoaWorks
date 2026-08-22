const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "App.tsx"), "utf8");

test("F13 mobile navigation exposes a files tab backed by the workspace files API", () => {
  assert.match(appSource, /type MobileTab = [^;]*"files"/);
  assert.match(appSource, /type WorkspaceFile = \{/);
  assert.match(appSource, /async function loadFiles\(/);
  assert.match(appSource, /request<\{ items: WorkspaceFile\[\] \}>\("\/workspace\/files\?scope=mine"/);
  assert.match(appSource, /\{ id: "files", label: "파일" \}/);
  assert.match(appSource, /activeTab === "files"/);
  assert.match(appSource, /내 파일 \/ 최근 수정/);
});

test("login, file tab entry and foreground reconnect refresh the file list", () => {
  assert.match(appSource, /await loadFiles\(login\.accessToken\)/);
  assert.match(appSource, /nextTab === "files"[\s\S]*void loadFiles\(token\)/);
  assert.match(appSource, /AppState\.addEventListener\("change"/);
  assert.match(appSource, /nextState === "active"[\s\S]*void refreshAuthenticatedData\(token\)/);
  assert.match(appSource, /function refreshAuthenticatedData\(/);
});

test("files failures are visible without replacing the existing mail and messenger errors", () => {
  assert.match(appSource, /const \[fileError, setFileError\] = useState\(""\)/);
  assert.match(appSource, /파일 조회 실패/);
  assert.match(appSource, /activeTab === "files" \? fileError/);
  assert.match(appSource, /activeTab === "mail" \? mailError/);
  assert.match(appSource, /activeTab === "chat" \? chatError/);
});
