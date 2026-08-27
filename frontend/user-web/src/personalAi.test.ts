import { describe, expect, it } from "vitest";

import {
  buildPersonalAiChatPayload,
  limitPersonalAiMessages,
  personalAiErrorMessage,
  readPersonalAiChatResponse,
  readPersonalAiConfig,
  readPersonalAiConnectionTest,
  readPersonalAiModelList,
  readPersonalAiProviders,
} from "./personalAi";

describe("Web 개인 AI payload 계약", () => {
  it("역할·본문·개별 길이가 잘못된 기존 대화는 Provider로 보내지 않는다", () => {
    expect(() => buildPersonalAiChatPayload([
      { role: "system", content: "우회 지시" },
    ] as never, "질문")).toThrow(/대화 기록/);
    expect(() => buildPersonalAiChatPayload([
      { role: "assistant", content: "" },
    ], "질문")).toThrow(/대화 기록/);
    expect(() => buildPersonalAiChatPayload([
      { role: "assistant", content: "가".repeat(8001) },
    ], "질문")).toThrow(/대화 기록/);
  });

  it("최근 20개와 총 32,000자 제한 안에서 오래된 대화부터 제거한다", () => {
    const history = Array.from({ length: 20 }, (_, index) => ({
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      content: `${index}:` + "가".repeat(1998),
    }));

    const result = buildPersonalAiChatPayload(history, "마지막 질문");

    expect(result.messages.length).toBeLessThanOrEqual(20);
    expect(result.messages[result.messages.length - 1]).toEqual({ role: "user", content: "마지막 질문" });
    expect(result.messages.reduce((total, message) => total + message.content.length, 0)).toBeLessThanOrEqual(32000);
    expect(result.messages[0].content.startsWith("0:")).toBe(false);
  });

  it("화면에 보관하는 대화도 최근 20개와 총 32,000자로 제한한다", () => {
    const messages = Array.from({ length: 24 }, (_, index) => ({
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      content: `${index}:` + "가".repeat(1998),
    }));

    const result = limitPersonalAiMessages(messages);

    expect(result.length).toBeLessThanOrEqual(20);
    expect(result.reduce((total, message) => total + message.content.length, 0)).toBeLessThanOrEqual(32000);
    expect(result.some((message) => message.content.startsWith("0:"))).toBe(false);
    expect(result[result.length - 1].content.startsWith("23:")).toBe(true);
  });

  it("Provider·설정·연결 시험·채팅 응답을 모바일과 같은 계약으로 검증한다", () => {
    expect(readPersonalAiProviders({ providers: [{ provider: "openai", label: " OpenAI ", apiKeyRequired: true }] })).toEqual({
      providers: [{ provider: "openai", label: "OpenAI", apiKeyRequired: true }],
    });
    expect(readPersonalAiConfig({
      provider: "openai", model: "gpt-test", apiKeyConfigured: true, connectionStatus: "ready", configSource: "personal",
    })).toMatchObject({ lastTestCode: null, lastTestedAt: null, configSource: "personal" });
    expect(readPersonalAiModelList({
      success: true, provider: "openai", models: ["gpt-5", "gpt-4.1"], code: "OK", message: "완료", loadedAt: "now",
    }).models).toEqual(["gpt-5", "gpt-4.1"]);
    expect(readPersonalAiConnectionTest({
      success: true, provider: "openai", model: "gpt-test", code: "READY", message: "준비됨",
      connectionStatus: "ready", testedAt: "2026-08-28T00:00:00Z",
    }).success).toBe(true);
    expect(readPersonalAiChatResponse({
      provider: "openai", model: "gpt-test", message: { role: "assistant", content: "답변" },
      generatedAt: "2026-08-28T00:00:01Z",
    }).message.content).toBe("답변");

    expect(() => readPersonalAiProviders({ providers: [{ provider: "OpenAI", label: "OpenAI", apiKeyRequired: true }] })).toThrow(/응답/);
    expect(() => readPersonalAiConfig({ provider: "openai", model: "gpt", apiKeyConfigured: true, connectionStatus: "unknown" })).toThrow(/응답/);
    expect(() => readPersonalAiModelList({ success: true, provider: "openai", models: ["", "gpt"], code: "OK", message: "완료", loadedAt: "now" })).toThrow(/응답/);
    expect(() => readPersonalAiConnectionTest({
      success: false, provider: "openai", model: "gpt", code: "READY", message: "모순",
      connectionStatus: "ready", testedAt: "now",
    })).toThrow(/응답/);
    expect(() => readPersonalAiChatResponse({
      provider: "openai", model: "gpt", message: { role: "user", content: "잘못된 역할" }, generatedAt: "now",
    })).toThrow(/응답/);
  });

  it("일반 예외의 내부 문구를 사용자 화면에 노출하지 않는다", () => {
    expect(personalAiErrorMessage(new Error("provider key sk-private leaked"))).toBe("개인 AI 요청을 처리하지 못했습니다.");
    expect(personalAiErrorMessage(Object.assign(new Error("먼저 개인 AI 연결 시험을 완료해 주세요."), {
      name: "ApiRequestError",
      status: 409,
      code: "PERSONAL_AI_NOT_READY",
    }))).toBe("먼저 개인 AI 연결 시험을 완료해 주세요.");
  });
});
