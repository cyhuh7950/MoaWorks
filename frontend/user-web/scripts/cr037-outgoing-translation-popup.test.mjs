import assert from "node:assert/strict";
import test from "node:test";

import {
  applyOutgoingTranslationPreview,
  buildOutgoingTranslationTexts,
  normalizeOutgoingTranslationLocale,
} from "../src/mailOutgoingTranslation.ts";

test("설정 언어는 작성 건별 목표 언어의 최초값으로 정규화한다", () => {
  assert.equal(normalizeOutgoingTranslationLocale("zh-cn"), "zh-cn");
  assert.equal(normalizeOutgoingTranslationLocale("ko-KR"), "ko");
  assert.equal(normalizeOutgoingTranslationLocale(""), "en");
  assert.equal(normalizeOutgoingTranslationLocale("unsupported"), "en");
});

test("작성자가 선택한 목표 언어로 제목과 본문 번역 요청을 만든다", () => {
  assert.deepEqual(
    buildOutgoingTranslationTexts(
      { subject: "견적서 요청", bodyText: "안녕하세요. 견적서를 보내주세요." },
      "ja",
    ),
    [
      { text: "견적서 요청", sourceLocale: "auto", targetLocale: "ja" },
      { text: "안녕하세요. 견적서를 보내주세요.", sourceLocale: "auto", targetLocale: "ja" },
    ],
  );
});

test("빈 제목은 요청에서 제외하고 본문 번역 결과만 명시적으로 적용한다", () => {
  assert.deepEqual(
    buildOutgoingTranslationTexts({ subject: "   ", bodyText: "본문" }, "en"),
    [{ text: "본문", sourceLocale: "auto", targetLocale: "en" }],
  );

  assert.deepEqual(
    applyOutgoingTranslationPreview(
      { to: "user@example.com", cc: "", bcc: "", subject: "원제목", bodyText: "원본문", scheduledAt: "" },
      { subject: "Translated subject", body: "Translated body" },
    ),
    { to: "user@example.com", cc: "", bcc: "", subject: "Translated subject", bodyText: "Translated body", scheduledAt: "" },
  );
});
