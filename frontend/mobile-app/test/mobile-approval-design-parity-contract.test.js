const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'App.tsx'), 'utf8');

test('결재 정본은 평면 화면과 조밀 상태 탭을 사용한다', () => {
  assert.match(appSource, /approvalScreenFlat/);
  assert.match(appSource, /approvalTabsCompact/);
});

test('결재 상세는 결재선과 반려·승인 액션 계약을 보존한다', () => {
  assert.match(appSource, /approvalDetailCard/);
  assert.match(appSource, /결재 반려/);
  assert.match(appSource, /결재 승인/);
});
