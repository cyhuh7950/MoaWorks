import { describe, expect, it } from "vitest";

import { formatMailSender } from "./mailSenderDisplay";

describe("formatMailSender", () => {
  it("이름 모드에서는 수신 헤더의 표시명을 우선한다", () => {
    expect(formatMailSender("외부 발신자", "sender@example.net", "name")).toBe("외부 발신자");
  });

  it("기존 메일에 표시명이 없으면 이메일 전체 대신 계정 이름을 표시한다", () => {
    expect(formatMailSender("", "cyhuh428@gmail.com", "name")).toBe("cyhuh428");
  });

  it("이름과 이메일 모드는 두 값을 함께 표시한다", () => {
    expect(formatMailSender("외부 발신자", "sender@example.net", "name_email")).toBe("외부 발신자 <sender@example.net>");
  });
});
