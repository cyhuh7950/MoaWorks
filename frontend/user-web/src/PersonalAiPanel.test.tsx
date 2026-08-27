// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PersonalAiPanel, type PersonalAiClient } from "./PersonalAiPanel";

const configured = {
  provider: "openai",
  model: "gpt-test",
  apiKeyConfigured: true,
  connectionStatus: "ready" as const,
  lastTestCode: "PERSONAL_AI_CONNECTION_READY",
  lastTestedAt: "2026-08-28T00:00:00Z",
  configSource: "personal" as const,
};

function createClient(overrides: Partial<PersonalAiClient> = {}): PersonalAiClient {
  return {
    listProviders: vi.fn().mockResolvedValue({
      providers: [
        { provider: "openai", label: "OpenAI", apiKeyRequired: true },
        { provider: "ollama", label: "Ollama", apiKeyRequired: false },
      ],
    }),
    getConfig: vi.fn().mockResolvedValue(configured),
    listModels: vi.fn().mockResolvedValue({
      success: true,
      provider: "openai",
      models: ["gpt-test", "gpt-next"],
      code: "PERSONAL_AI_MODELS_OK",
      message: "사용 가능한 모델 2개를 불러왔습니다.",
      loadedAt: "2026-08-28T00:00:00Z",
    }),
    saveConfig: vi.fn().mockResolvedValue(configured),
    testConnection: vi.fn().mockResolvedValue({
      success: true,
      provider: "openai",
      model: "gpt-test",
      code: "PERSONAL_AI_CONNECTION_READY",
      message: "개인 AI Provider 연결이 준비되었습니다.",
      connectionStatus: "ready",
      testedAt: "2026-08-28T00:00:01Z",
    }),
    chat: vi.fn().mockResolvedValue({
      provider: "openai",
      model: "gpt-test",
      message: { role: "assistant", content: "첫 답변" },
      generatedAt: "2026-08-28T00:00:02Z",
    }),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Web 개인 AI 채팅", () => {
  it("개인 설정이 없으면 관리자 기본 LLM으로 연결 시험 없이 질문할 수 있다", async () => {
    const client = createClient({
      getConfig: vi.fn().mockResolvedValue({
        ...configured,
        provider: "upstage",
        model: "solar-pro4",
        configSource: "admin_default",
        lastTestCode: null,
        lastTestedAt: null,
      }),
    });
    render(<PersonalAiPanel token="token" client={client} />);

    await screen.findByText("관리자 기본 LLM 사용 중");
    fireEvent.change(screen.getByRole("textbox", { name: "AI 질문" }), { target: { value: "기본 질문" } });

    expect((screen.getByRole("button", { name: "AI 질문 보내기" }) as HTMLButtonElement).disabled).toBe(false);
    expect(client.testConnection).not.toHaveBeenCalled();
  });

  it("개인 설정에서 Provider 모델을 불러와 선택하고 저장한다", async () => {
    const listModels = vi.fn().mockResolvedValue({
      success: true,
      provider: "openai",
      models: ["gpt-test", "gpt-next"],
      code: "PERSONAL_AI_MODELS_OK",
      message: "사용 가능한 모델 2개를 불러왔습니다.",
      loadedAt: "2026-08-28T00:00:00Z",
    });
    const saveConfig = vi.fn().mockResolvedValue({ ...configured, model: "gpt-next" });
    const client = createClient({ listModels, saveConfig });
    render(<PersonalAiPanel token="token" client={client} />);

    fireEvent.click(await screen.findByRole("button", { name: "AI 연결 설정" }));
    fireEvent.click(screen.getByRole("button", { name: "개인 AI 모델 불러오기" }));
    await screen.findByRole("option", { name: "gpt-next" });
    fireEvent.change(screen.getByRole("combobox", { name: "개인 AI 모델" }), { target: { value: "gpt-next" } });
    fireEvent.click(screen.getByRole("button", { name: "개인 AI 설정 저장" }));

    expect(listModels).toHaveBeenCalledWith("token", { provider: "openai" });
    await waitFor(() => expect(saveConfig).toHaveBeenCalledWith("token", {
      provider: "openai",
      model: "gpt-next",
    }));
  });

  it("현재 세션에서 연결 시험이 성공하기 전에는 질문 전송을 허용하지 않는다", async () => {
    const client = createClient();
    render(<PersonalAiPanel token="token" client={client} />);

    const input = await screen.findByRole("textbox", { name: "AI 질문" });
    fireEvent.change(input, { target: { value: "연결 전 질문" } });
    expect((screen.getByRole("button", { name: "AI 질문 보내기" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "LLM 연결 시험" }));
    await screen.findByText("연결됨");
    expect((screen.getByRole("button", { name: "AI 질문 보내기" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("이전 사용자와 AI 메시지를 포함해 다음 질문을 보내고 응답을 대화창에 표시한다", async () => {
    const chat = vi.fn()
      .mockResolvedValueOnce({
        provider: "openai", model: "gpt-test",
        message: { role: "assistant", content: "첫 답변" }, generatedAt: "2026-08-28T00:00:02Z",
      })
      .mockResolvedValueOnce({
        provider: "openai", model: "gpt-test",
        message: { role: "assistant", content: "두 번째 답변" }, generatedAt: "2026-08-28T00:00:03Z",
      });
    const client = createClient({ chat });
    render(<PersonalAiPanel token="token" client={client} />);

    await screen.findByRole("textbox", { name: "AI 질문" });
    fireEvent.click(screen.getByRole("button", { name: "LLM 연결 시험" }));
    await screen.findByText("연결됨");

    fireEvent.change(screen.getByRole("textbox", { name: "AI 질문" }), { target: { value: "첫 질문" } });
    fireEvent.click(screen.getByRole("button", { name: "AI 질문 보내기" }));
    await screen.findByText("첫 답변");

    fireEvent.change(screen.getByRole("textbox", { name: "AI 질문" }), { target: { value: "두 번째 질문" } });
    fireEvent.click(screen.getByRole("button", { name: "AI 질문 보내기" }));
    await screen.findByText("두 번째 답변");

    expect(chat).toHaveBeenNthCalledWith(2, "token", {
      messages: [
        { role: "user", content: "첫 질문" },
        { role: "assistant", content: "첫 답변" },
        { role: "user", content: "두 번째 질문" },
      ],
    });
  });

  it("긴 세션에서도 화면 대화 상태를 최근 20개로 제한한다", async () => {
    let responseIndex = 0;
    const client = createClient({
      chat: vi.fn().mockImplementation(async () => {
        responseIndex += 1;
        return {
          provider: "openai",
          model: "gpt-test",
          message: { role: "assistant" as const, content: `답변 ${responseIndex}` },
          generatedAt: `2026-08-28T00:00:${String(responseIndex).padStart(2, "0")}Z`,
        };
      }),
    });
    render(<PersonalAiPanel token="token" client={client} />);

    await screen.findByRole("textbox", { name: "AI 질문" });
    fireEvent.click(screen.getByRole("button", { name: "LLM 연결 시험" }));
    await screen.findByText("연결됨");

    for (let index = 1; index <= 11; index += 1) {
      fireEvent.change(screen.getByRole("textbox", { name: "AI 질문" }), { target: { value: `질문 ${index}` } });
      fireEvent.click(screen.getByRole("button", { name: "AI 질문 보내기" }));
      await screen.findByText(`답변 ${index}`);
    }

    expect(screen.queryByText("질문 1")).toBeNull();
    expect(screen.queryByText("답변 1")).toBeNull();
    expect(screen.getByText("질문 11")).toBeTruthy();
    expect(screen.getByText("답변 11")).toBeTruthy();
    expect(screen.getAllByText(/^(질문|답변) \d+$/)).toHaveLength(20);
  });

  it("API 키를 저장한 뒤 입력값을 즉시 지우고 설정 여부만 표시한다", async () => {
    const saveConfig = vi.fn().mockResolvedValue(configured);
    const client = createClient({ saveConfig });
    render(<PersonalAiPanel token="token" client={client} />);

    fireEvent.click(await screen.findByRole("button", { name: "AI 연결 설정" }));
    const apiKey = screen.getByLabelText("개인 AI API 키") as HTMLInputElement;
    fireEvent.change(apiKey, { target: { value: "secret-value" } });
    fireEvent.click(screen.getByRole("button", { name: "개인 AI 설정 저장" }));

    await waitFor(() => expect(saveConfig).toHaveBeenCalledWith("token", {
      provider: "openai",
      model: "gpt-test",
      apiKey: "secret-value",
    }));
    expect(apiKey.value).toBe("");
    expect(screen.queryByDisplayValue("secret-value")).toBeNull();
    expect(screen.getByText("API 키 설정됨")).toBeTruthy();
  });

  it("토큰이 바뀌면 이전 대화를 지우고 늦게 도착한 이전 세션 응답을 적용하지 않는다", async () => {
    let resolveOldChat!: (value: Awaited<ReturnType<PersonalAiClient["chat"]>>) => void;
    const chat = vi.fn().mockImplementation(() => new Promise((resolve) => { resolveOldChat = resolve; }));
    const client = createClient({ chat });
    const { rerender } = render(<PersonalAiPanel token="token-old" client={client} />);

    await screen.findByRole("textbox", { name: "AI 질문" });
    fireEvent.click(screen.getByRole("button", { name: "LLM 연결 시험" }));
    await screen.findByText("연결됨");
    fireEvent.change(screen.getByRole("textbox", { name: "AI 질문" }), { target: { value: "이전 세션 질문" } });
    fireEvent.click(screen.getByRole("button", { name: "AI 질문 보내기" }));
    await screen.findByText("이전 세션 질문");

    rerender(<PersonalAiPanel token="token-new" client={client} />);
    await waitFor(() => expect(screen.queryByText("이전 세션 질문")).toBeNull());
    resolveOldChat({
      provider: "openai", model: "gpt-test",
      message: { role: "assistant", content: "이전 세션 비밀 답변" }, generatedAt: "2026-08-28T00:00:04Z",
    });
    await Promise.resolve();

    expect(screen.queryByText("이전 세션 비밀 답변")).toBeNull();
  });

  it("연결 설정을 수정한 뒤 저장하기 전에는 이전 서버 설정으로 연결 시험할 수 없다", async () => {
    const client = createClient();
    render(<PersonalAiPanel token="token" client={client} />);

    fireEvent.click(await screen.findByRole("button", { name: "AI 연결 설정" }));
    fireEvent.change(screen.getByRole("combobox", { name: "개인 AI 모델" }), { target: { value: "" } });

    expect((screen.getByRole("button", { name: "LLM 연결 시험" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("설정 저장 필요")).toBeTruthy();
  });
});
