import { describe, expect, it } from "vitest";

import { formatMailSender } from "./mailSenderDisplay";

describe("formatMailSender", () => {
  it("이름 모드에서는 수신 헤더의 표시명을 우선한다", () => {
    expect(formatMailSender("외부 발신자", "sender@example.net", "name")).toBe("외부 발신자");
  });

  it("표시명이 없으면 ID를 이름이라고 표시하지 않는다", () => {
    expect(formatMailSender("", "admin@example.test", "name")).toBe("이름 정보 없음");
    expect(formatMailSender("", "sender@example.net", "name_email")).toBe("이름 정보 없음 <sender@example.net>");
  });

  it("사내 사용자 이름은 계정 ID가 아니라 실제 이름으로 표시한다", () => {
    expect(formatMailSender("실제 사용자 이름", "admin@example.test", "name")).toBe("실제 사용자 이름");
  });

  it("이름과 이메일 모드는 두 값을 함께 표시한다", () => {
    expect(formatMailSender("외부 발신자", "sender@example.net", "name_email")).toBe("외부 발신자 <sender@example.net>");
  });
});
