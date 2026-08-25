const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'App.tsx'), 'utf8');

test('주소록 정본 레이아웃은 평면 화면과 조밀한 직원 행을 사용한다', () => {
  assert.match(appSource, /directoryScreenFlat/);
  assert.match(appSource, /directoryCompactRow/);
  assert.match(appSource, /directorySections/);
});
