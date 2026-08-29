import { describe, expect, it } from "vitest";

import { formatMailSender, senderEmailId } from "./mailSenderDisplay";

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

  it("ID 모드는 trim한 이메일의 첫 @ 앞 원문을 표시한다", () => {
    expect(senderEmailId(" Hong@Example.com ")).toBe("Hong");
    expect(senderEmailId("first@alias@example.com")).toBe("first");
    expect(formatMailSender("홍길동", " Hong@Example.com ", "id")).toBe("Hong");
  });

  it("ID를 추출할 수 없으면 ID 정보 없음으로 표시한다", () => {
    expect(senderEmailId("")).toBeNull();
    expect(senderEmailId("invalid")).toBeNull();
    expect(senderEmailId("@example.com")).toBeNull();
    expect(formatMailSender("", "invalid", "id")).toBe("ID 정보 없음");
  });

  it("누락된 이름과 이메일은 모드별 fallback을 유지한다", () => {
    expect(formatMailSender("", "hong@example.com", "name")).toBe("이름 정보 없음");
    expect(formatMailSender("", "hong@example.com", "name_email")).toBe("이름 정보 없음 <hong@example.com>");
    expect(formatMailSender("", "", "name_email")).toBe("이름 정보 없음");
  });
});
