const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'App.tsx'), 'utf8');

test('메신저 정본 상세는 평면 대화 화면과 언어 전환을 유지한다', () => {
  assert.match(appSource, /messengerScreenFlat/);
  assert.match(appSource, /messengerLanguageSwitcher/);
  assert.match(appSource, /메시지 전송/);
});
