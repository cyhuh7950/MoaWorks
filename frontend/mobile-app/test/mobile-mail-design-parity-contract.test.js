const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'App.tsx'), 'utf8');

test('메일 화면은 목록 우선 상세 펼침 상태를 제공한다', () => {
  assert.match(appSource, /mailDetailExpanded/);
  assert.match(appSource, /메일 상세 열기/);
  assert.match(appSource, /메일 상세 닫기/);
});

test('메일 정본 레이아웃은 조밀한 목록 행 스타일을 사용한다', () => {
  assert.match(appSource, /mailListCompact/);
  assert.match(appSource, /mailRowCompact/);
  assert.match(appSource, /mailboxTabsCompact/);
});
