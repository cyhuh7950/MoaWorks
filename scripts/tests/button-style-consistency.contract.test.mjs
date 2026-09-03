import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const userCss = await read("frontend/user-web/src/global.css");
const adminCss = await read("frontend/admin-web/src/styles.css");

test("user 일반 버튼은 기본 브라우저 외형 대신 MoaWorks 외곽선 스타일을 사용한다", () => {
  assert.match(userCss, /(?:^|\n)button\s*\{[^}]*border:\s*1px solid #cbd5e1[^}]*border-radius:\s*4px[^}]*background:\s*#fff/s);
});

test("admin 일반 버튼은 첨부 기준의 흰색 외곽선 스타일을 사용한다", () => {
  assert.match(adminCss, /(?:^|\n)button\s*\{[^}]*border:\s*1px solid #cbd5e1[^}]*border-radius:\s*4px[^}]*background:\s*#fff[^}]*color:\s*#1e293b/s);
});

test("admin 위험 버튼은 흰색 바탕의 붉은 글자로 구분한다", () => {
  assert.match(adminCss, /\.danger-action\s*\{[^}]*background:\s*#fff[^}]*color:\s*#b42318/s);
});
