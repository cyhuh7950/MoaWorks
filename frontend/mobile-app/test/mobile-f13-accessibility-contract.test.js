const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { parse } = require("@babel/parser");
const { navigationModel } = require("../mobile-ui-design.js");

const appSource = fs.readFileSync(path.resolve(__dirname, "..", "App.tsx"), "utf8");
const ast = parse(appSource, { sourceType: "module", plugins: ["typescript", "jsx"] });

function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((child) => walk(child, visit));
    else if (value && typeof value === "object") walk(value, visit);
  }
}

function source(node) {
  return node ? appSource.slice(node.start, node.end) : "";
}

function isEquality(node, name, value) {
  return node?.type === "BinaryExpression"
    && node.operator === "==="
    && node.left?.type === "Identifier"
    && node.left.name === name
    && node.right?.type === "StringLiteral"
    && node.right.value === value;
}

function screenCondition(node, activeTab, moreScreen) {
  if (!moreScreen) return isEquality(node, "activeTab", activeTab);
  if (node?.type !== "LogicalExpression" || node.operator !== "&&") return false;
  return (isEquality(node.left, "activeTab", activeTab) && isEquality(node.right, "moreScreen", moreScreen))
    || (isEquality(node.right, "activeTab", activeTab) && isEquality(node.left, "moreScreen", moreScreen));
}

function screenRegion(activeTab, moreScreen) {
  let region = null;
  walk(ast, (node) => {
    if (!region
      && node.type === "ConditionalExpression"
      && node.consequent?.type === "JSXElement"
      && screenCondition(node.test, activeTab, moreScreen)) {
      region = node.consequent;
    }
  });
  assert.ok(region, `${moreScreen || activeTab} screen region exists`);
  return region;
}

function jsxName(element) {
  return element?.openingElement?.name?.name || "";
}

function attribute(element, name) {
  return element.openingElement.attributes.find((item) => item.type === "JSXAttribute" && item.name.name === name);
}

function attributeValue(element, name) {
  const item = attribute(element, name);
  if (item?.value?.type === "StringLiteral") return item.value.value;
  if (item?.value?.type === "JSXExpressionContainer" && item.value.expression?.type === "StringLiteral") {
    return item.value.expression.value;
  }
  return null;
}

function elements(region, name) {
  const found = [];
  walk(region, (node) => {
    if (node.type === "JSXElement" && jsxName(node) === name) found.push(node);
  });
  return found;
}

function textContent(element) {
  let value = "";
  walk(element, (node) => {
    if (node.type === "JSXText") value += node.value;
  });
  return value.replace(/\s+/g, " ").trim();
}

function elementWithLabel(region, name, labelFragment) {
  return elements(region, name).find((element) => source(attribute(element, "accessibilityLabel")).includes(labelFragment));
}

function assertNamedAndHinted(region, name, labelFragment) {
  const element = elementWithLabel(region, name, labelFragment);
  assert.ok(element, `${labelFragment} control has an accessible name`);
  assert.ok(attributeValue(element, "accessibilityHint"), `${labelFragment} control has an accessibility hint`);
  return element;
}

function referencedIdentifiers(node) {
  const identifiers = new Set();
  const visit = (current, parent = null) => {
    if (!current || typeof current !== "object") return;
    if (current.type === "Identifier") {
      const isStaticMemberProperty = parent?.type === "MemberExpression" && parent.property === current && !parent.computed;
      const isStaticObjectKey = parent?.type === "ObjectProperty" && parent.key === current && !parent.computed;
      if (!isStaticMemberProperty && !isStaticObjectKey) identifiers.add(current.name);
    }
    for (const value of Object.values(current)) {
      if (Array.isArray(value)) value.forEach((child) => visit(child, current));
      else if (value && typeof value === "object") visit(value, current);
    }
  };
  visit(node);
  return identifiers;
}

test("일정·주소록·개인 AI·업무 검색 화면 제목은 programmatic heading이다", () => {
  const cases = [
    [screenRegion("calendar"), "scheduleMonthKey", "월간 일정"],
    [screenRegion("more", "directory"), ">주소록<", "주소록"],
    [screenRegion("more", "ai"), ">AI 채팅<", "AI 채팅"],
    [screenRegion("more", "search"), ">현재 불러온 업무 통합 검색<", "현재 불러온 업무 통합 검색"],
  ];

  for (const [region, fragment, label] of cases) {
    const heading = elements(region, "Text").find((element) => source(element).includes(fragment));
    assert.ok(heading, `${label} heading exists`);
    assert.equal(attributeValue(heading, "accessibilityRole"), "header", `${label} exposes the header role`);
  }
});

test("네 화면의 입력·버튼·결과 행은 동작과 대상을 설명하는 이름과 hint를 유지한다", () => {
  const calendar = screenRegion("calendar");
  for (const label of ["이전 달 일정 보기", "다음 달 일정 보기"]) assertNamedAndHinted(calendar, "Text", label);
  assertNamedAndHinted(calendar, "Pressable", "일정 만들기");
  for (const label of ["일정 제목", "일정 시작 시간", "일정 종료 시간"]) {
    assertNamedAndHinted(calendar, "TextInput", label);
  }

  const directory = screenRegion("more", "directory");
  assertNamedAndHinted(directory, "TextInput", "주소록 검색");
  for (const action of ["메일 보내기", "전화번호 미제공", "대화 시작"]) {
    const control = assertNamedAndHinted(directory, "Pressable", action);
    assert.match(source(attribute(control, "accessibilityLabel")), /member\.name/, `${action} names the member target`);
  }

  const personalAi = screenRegion("more", "ai");
  assertNamedAndHinted(personalAi, "TextInput", "개인 AI 질문");
  assertNamedAndHinted(personalAi, "Pressable", "개인 AI 질문 보내기");

  const search = screenRegion("more", "search");
  assertNamedAndHinted(search, "TextInput", "업무 검색어");
  const result = assertNamedAndHinted(search, "Pressable", "열기");
  assert.match(source(attribute(result, "accessibilityLabel")), /result\.title/, "검색 결과 이름은 target title을 포함한다");

  const scheduleSubmit = elementWithLabel(calendar, "Pressable", "일정 생성");
  assert.equal(attributeValue(scheduleSubmit, "accessibilityLabel"), "일정 생성", "pending 중에도 일정 생성 이름은 고정된다");
  assert.match(source(scheduleSubmit), /scheduleSaving/);
  assert.match(source(attribute(scheduleSubmit, "disabled")), /scheduleSaving/);

  const directRoom = elementWithLabel(directory, "Pressable", "대화 시작");
  assert.doesNotMatch(source(attribute(directRoom, "accessibilityLabel")), /directoryBusyUserId|isSelf/, "disabled/pending 상태가 대화 동작 이름을 바꾸지 않는다");
  assert.match(source(attribute(directRoom, "disabled")), /directoryBusyUserId/);

  const aiSubmit = elementWithLabel(personalAi, "Pressable", "개인 AI 질문 보내기");
  assert.equal(attributeValue(aiSubmit, "accessibilityLabel"), "개인 AI 질문 보내기", "pending 중에도 질문 보내기 이름은 고정된다");
  assert.match(source(aiSubmit), /personalAiPendingAction/);
  assert.match(source(attribute(aiSubmit, "disabled")), /personalAiPendingAction/);
});

test("월 변경·빈 결과·AI 연결 안내·검색 결과 수는 polite live region이다", () => {
  const cases = [
    [screenRegion("calendar"), "Text", "scheduleMonthKey"],
    [screenRegion("more", "directory"), "Text", "표시할 주소록 정보가 없습니다"],
    [screenRegion("more", "ai"), "Text", "현재 로그인 세션에서 연결 시험"],
    [screenRegion("more", "search"), "Text", "businessSearchResults.length"],
    [screenRegion("more", "settings"), "Text", "llmConnectionStatus"],
  ];

  for (const [region, name, content] of cases) {
    const status = elements(region, name).find((element) => source(element).includes(content));
    assert.ok(status, `${content} dynamic status exists`);
    assert.equal(attributeValue(status, "accessibilityLiveRegion"), "polite", `${content} is announced politely`);
  }
});

test("요청·부분 로드 오류는 안전한 고정 이름의 alert role이다", () => {
  const cases = [
    [screenRegion("calendar"), "scheduleError", "일정 요청을 처리하지 못했습니다."],
    [screenRegion("more", "directory"), "directoryError", "주소록 요청을 처리하지 못했습니다."],
    [screenRegion("more", "ai"), "personalAiError", "개인 AI 요청을 처리하지 못했습니다."],
    [screenRegion("more", "settings"), "personalAiError", "개인 AI 요청을 처리하지 못했습니다."],
    [screenRegion("more", "search"), "businessSearchWarnings", "일부 업무를 불러오지 못했습니다. 현재 불러온 결과만 표시합니다."],
  ];
  for (const [region, errorState, safeLabel] of cases) {
    const alert = elements(region, "Text").find((element) => source(element).includes(errorState));
    assert.ok(alert, `${errorState} error text exists`);
    assert.equal(attributeValue(alert, "accessibilityRole"), "alert", `${errorState} exposes the alert role`);
    assert.equal(attributeValue(alert, "accessibilityLabel"), safeLabel, `${errorState} uses a fixed safe accessible name`);
    assert.doesNotMatch(source(attribute(alert, "accessibilityLabel")), new RegExp(errorState), `${errorState} raw value is not the accessible name`);
  }
});

test("AI 오류 alert는 카드 안에서 잘리지 않는 compact 전용 스타일을 사용한다", () => {
  const personalAi = screenRegion("more", "ai");
  const alert = elements(personalAi, "Text").find((element) => source(element).includes("personalAiError"));
  assert.ok(alert, "AI error alert exists");
  assert.match(source(attribute(alert, "style")), /styles\.aiInlineError/, "AI alert does not reuse the unbounded shared error style");

  const style = appSource.match(/aiInlineError:\s*\{([\s\S]*?)\n\s*\},/);
  assert.ok(style, "AI compact error style exists");
  assert.match(style[1], /marginHorizontal:\s*12/);
  assert.match(style[1], /marginBottom:\s*12/);
  assert.match(style[1], /fontSize:\s*10/);
  assert.match(style[1], /lineHeight:\s*15/);
});

test("접근성 속성은 secret binding이나 승인되지 않은 동적 이름을 참조하지 않는다", () => {
  const allowedDynamicNameRoots = new Set(["BUSINESS_SEARCH_CATEGORY_LABELS", "approvalScreen", "calendarScreen", "cell", "daySchedules", "directoryScreen", "doc", "filter", "index", "item", "member", "name", "option", "result", "room", "section", "undefined", "view"]);
  const forbiddenSecretBindings = new Set(["apiKeyDraft", "llmApiKey", "password", "token"]);
  walk(ast, (node) => {
    if (node.type !== "JSXElement") return;
    for (const item of node.openingElement.attributes) {
      if (item.type !== "JSXAttribute" || !item.name.name.startsWith("accessibility")) continue;
      const identifiers = referencedIdentifiers(item.value);
      for (const identifier of identifiers) {
        assert.equal(forbiddenSecretBindings.has(identifier), false, `${item.name.name} must not reference ${identifier}`);
      }
      if (["accessibilityLabel", "accessibilityHint"].includes(item.name.name) && item.value?.type === "JSXExpressionContainer") {
        for (const identifier of identifiers) {
          if (["label", "category", "title"].includes(identifier)) continue;
          assert.ok(allowedDynamicNameRoots.has(identifier), `${item.name.name} dynamic root ${identifier} is explicitly safe`);
        }
      }
    }
  });
});

test("개인 AI API 키 입력은 값과 분리된 고정 이름·hint·secure 속성을 유지한다", () => {
  const apiKeyInput = elements(ast, "TextInput").find((element) => attributeValue(element, "accessibilityLabel") === "개인 AI API 키");
  assert.ok(apiKeyInput, "API-key input has a non-secret field name");
  assert.ok(attributeValue(apiKeyInput, "accessibilityHint"), "API-key input has a non-secret hint");
  assert.doesNotMatch(source(attribute(apiKeyInput, "accessibilityHint")), /llmApiKey|apiKeyDraft/, "API-key hint excludes key values");
  assert.ok(attribute(apiKeyInput, "secureTextEntry"), "API-key input remains secure");
});

test("정본 하단 탭과 더보기 navigation은 접근 가능한 진입점을 유지한다", () => {
  const navigation = navigationModel();
  const pairs = new Set([...navigation.bottom, ...navigation.more].map(({ id, label }) => `${id}:${label}`));
  for (const pair of ["calendar:일정", "directory:주소록", "ai:AI 채팅", "search:업무 검색", "more:더보기"]) {
    assert.ok(pairs.has(pair), `${pair} navigation remains reachable`);
  }

  const bottomTab = elements(ast, "Pressable").find((element) => source(attribute(element, "onPress")).includes("handleTabPress(item.id") && source(attribute(element, "accessibilityLabel")).includes("메뉴"));
  assert.ok(bottomTab, "bottom tab control calls handleTabPress");
  assert.equal(attributeValue(bottomTab, "accessibilityRole"), "button");
  assert.match(source(attribute(bottomTab, "accessibilityLabel")), /item\.label/);
  assert.ok(attributeValue(bottomTab, "accessibilityHint"));

  const moreTab = elements(ast, "Pressable").find((element) => source(attribute(element, "onPress")).includes("setMoreScreen(item.id") && source(attribute(element, "accessibilityLabel")).includes("메뉴"));
  assert.ok(moreTab, "more menu control calls setMoreScreen");
  assert.equal(attributeValue(moreTab, "accessibilityRole"), "button");
  assert.match(source(attribute(moreTab, "accessibilityLabel")), /item\.label/);
  assert.ok(attributeValue(moreTab, "accessibilityHint"));
});
