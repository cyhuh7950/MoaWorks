import { describe, expect, it } from "vitest";
import { mailDeliveryLabel, mailSubmissionMessage } from "./mailDeliveryPresentation";

describe("메일 전달 상태의 증거 수준", () => {
  it("SMTP 수락은 수신함 도착으로 표현하지 않는다", () => {
    expect(mailDeliveryLabel("sent")).toBe("상대 SMTP 수락 (수신함 도착 미확인)");
  });
  it("결과 불명과 실패를 구분한다", () => {
    expect(mailDeliveryLabel("result_unknown")).toContain("결과 확인 필요");
    expect(mailDeliveryLabel("failed")).toBe("전달 실패");
    expect(mailDeliveryLabel("blocked")).toBe("외부 발송 차단 (관리자 확인 필요)");
  });
  it("발송 응답은 접수와 내부 전달, 외부 대기 및 잠금을 구분한다", () => {
    expect(mailSubmissionMessage({internalCount: 1, externalCount: 2, queuedCount: 1, blockedCount: 1}))
      .toBe("메일을 접수했습니다. 내부 전달 1건 / 외부 2건: 대기 1건, 차단 1건. 외부 수신함 도착은 확인되지 않았습니다.");
  });
  it.each(["provider_locked", "oci_recipient_suppressed"])("blocked 원인 %s를 잠금으로 추정하지 않는다", (reason) => {
    const serverResult = { status: "blocked", privateReason: reason };
    expect(mailDeliveryLabel(serverResult.status)).toBe("외부 발송 차단 (관리자 확인 필요)");
    expect(mailDeliveryLabel(serverResult.status)).not.toContain(serverResult.privateReason);
  });
});
