const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "App.tsx"), "utf8");
const { navigationModel } = require("../mobile-ui-design.js");

test("F13 files 기능은 내부 route와 API를 보존하되 정본 하단 메뉴에는 노출하지 않는다", () => {
  assert.match(appSource, /type MobileTab = [^;]*"files"/);
  assert.match(appSource, /type WorkspaceFile = \{/);
  assert.match(appSource, /async function loadFiles\(/);
  assert.match(appSource, /request<\{ items: WorkspaceFile\[\] \}>\("\/workspace\/files\?scope=mine"/);
  assert.equal(navigationModel().bottom.some(({ id }) => id === "files"), false);
  assert.match(appSource, /activeTab === "files"/);
  assert.match(appSource, /내 파일 \/ 최근 수정/);
});

test("login, 검색 결과 진입과 foreground reconnect는 file list를 갱신한다", () => {
  assert.match(appSource, /runInitialRequests\(context, \[[\s\S]*?\(\) => loadFiles\(loginResult\.login\.accessToken, context\)/);
  assert.match(appSource, /result\.target\.screen === "files"[\s\S]*setActiveTab\("files"\)/);
  assert.match(appSource, /AppState\.addEventListener\("change"/);
  assert.match(appSource, /nextState === "active"[\s\S]*void refreshAuthenticatedData\(token, context\)/);
  assert.match(appSource, /function refreshAuthenticatedData\(/);
});

test("files failures are visible without replacing the existing mail and messenger errors", () => {
  assert.match(appSource, /const \[fileError, setFileError\] = useState\(""\)/);
  assert.match(appSource, /파일 조회 실패/);
  assert.match(appSource, /activeTab === "files" \? fileError/);
  assert.match(appSource, /activeTab === "mail" \? mailError/);
  assert.match(appSource, /activeTab === "chat" \? chatError/);
});
