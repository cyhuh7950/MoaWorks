import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../src/global.css", import.meta.url), "utf8");

test("외부메일 패널은 가변 빈 행 없이 콘텐츠를 위에서부터 배치한다", () => {
  assert.match(cssSource, /\.user-mail-external\s*\{[^}]*grid-template-rows:\s*auto auto auto auto/s);
});

test("외부메일 팝업 옵션은 전용 영역에서 정렬한다", () => {
  assert.match(appSource, /user-mail-external__options/);
  assert.match(cssSource, /\.user-mail-external__options\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s);
});
