const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appSource = fs.readFileSync(path.resolve(__dirname, "..", "App.tsx"), "utf8");

function functionBody(name) {
  const start = appSource.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} exists`);
  const next = appSource.indexOf("\n  async function ", start + 1);
  return appSource.slice(start, next === -1 ? appSource.length : next);
}

test("App은 현재 session에 로드된 6개 summary source만 업무 검색 helper에 전달한다", () => {
  assert.match(appSource, /from "\.\/business-search"/);
  assert.match(appSource, /searchLoadedBusinessSummaries\(businessSearchQuery, \{\s*mailItems,\s*documents,\s*rooms,\s*schedules,\s*directoryUsers,\s*files,?\s*\}\)/s);
  const searchStart = appSource.indexOf("searchLoadedBusinessSummaries(businessSearchQuery");
  assert.notEqual(searchStart, -1);
  const searchWiring = appSource.slice(searchStart, searchStart + 300);
  for (const forbidden of ["token", "password", "llmApiKey", "selectedMailDetail", "roomMessages", "apiBase"]) {
    assert.doesNotMatch(searchWiring, new RegExp(forbidden));
  }
});

test("App은 검색 query, 선택 결과, 안전한 partial warning을 중앙 session reset에 연결한다", () => {
  assert.match(appSource, /const \[businessSearchQuery, setBusinessSearchQuery\] = useState\(""\)/);
  assert.match(appSource, /const \[businessSearchSelectedResultId, setBusinessSearchSelectedResultId\] = useState\(""\)/);
  assert.match(appSource, /const \[businessSearchWarnings, setBusinessSearchWarnings\] = useState<BusinessSearchSource\[\]>\(\[\]\)/);
  assert.match(appSource, /setBusinessSearchQuery\(nextState\.businessSearchQuery\)/);
  assert.match(appSource, /setBusinessSearchSelectedResultId\(nextState\.businessSearchSelectedResultId\)/);
  assert.match(appSource, /setBusinessSearchWarnings\(nextState\.businessSearchWarnings\)/);

  const sourceLoaders = [
    ["loadApprovals", "approval"],
    ["loadMail", "mail"],
    ["loadRooms", "messenger"],
    ["loadFiles", "file"],
    ["loadSchedules", "schedule"],
    ["loadDirectory", "directory"],
  ];
  for (const [loader, source] of sourceLoaders) {
    const body = functionBody(loader);
    assert.match(body, new RegExp(`markBusinessSearchSource\\("${source}", false\\)`), `${loader} clears safe warning`);
    assert.match(body, new RegExp(`markBusinessSearchSource\\("${source}", true\\)`), `${loader} sets safe warning`);
  }
});

test("업무 검색 화면은 범위 제한, 접근성, 결과·category 수, 빈 상태와 partial 상태를 명시한다", () => {
  assert.match(appSource, /accessibilityLabel="업무 검색어"/);
  assert.match(appSource, /현재 불러온 업무/);
  assert.match(appSource, /완전한 서버 전체 이력 검색이 아닙니다/);
  assert.match(appSource, /검색 결과 \$\{businessSearchResults\.length\}건/);
  assert.match(appSource, /businessSearchCategoryCounts/);
  assert.match(appSource, /검색어를 입력하면 현재 불러온 업무에서 관련 결과를 표시합니다/);
  assert.match(appSource, /현재 불러온 업무에서 일치하는 결과가 없습니다/);
  assert.match(appSource, /일부 업무를 불러오지 못했습니다/);
  assert.match(appSource, /현재 불러온 결과만 표시합니다/);
  assert.match(appSource, /accessibilityLabel=\{`\$\{BUSINESS_SEARCH_CATEGORY_LABELS\[result\.category\]\} \$\{result\.title\} 열기`\}/);
});

test("검색 결과 activation은 mail/room 보호 handler와 기존 화면 route만 사용한다", () => {
  const body = functionBody("openBusinessSearchResult");
  assert.match(body, /setBusinessSearchSelectedResultId\(`/);
  assert.match(body, /result\.target\.screen === "mail"[\s\S]*?setActiveTab\("mail"\)[\s\S]*?openMail\(result\.id\)/);
  assert.match(body, /result\.target\.screen === "chat"[\s\S]*?setActiveTab\("chat"\)[\s\S]*?openRoom\(result\.id\)/);
  assert.match(body, /result\.target\.screen === "approval"[\s\S]*?setActiveTab\("approval"\)/);
  assert.match(body, /result\.target\.screen === "calendar"[\s\S]*?setActiveTab\("calendar"\)/);
  assert.match(body, /result\.target\.screen === "directory"[\s\S]*?setActiveTab\("more"\)[\s\S]*?setMoreScreen\("directory"\)/);
  assert.match(body, /result\.target\.screen === "files"[\s\S]*?setActiveTab\("files"\)/);
  assert.doesNotMatch(body, /request\(|fetch\(|Authorization|endpoint|token/);
});
