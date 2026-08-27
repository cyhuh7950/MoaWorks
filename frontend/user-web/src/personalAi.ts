import type {
  PersonalAiChatMessage,
  PersonalAiChatResponse,
  PersonalAiConfig,
  PersonalAiConfigSource,
  PersonalAiConnectionStatus,
  PersonalAiConnectionTest,
  PersonalAiModelList,
  PersonalAiProviderOption,
} from "./api";

const maxMessages = 20;
const maxMessageCharacters = 8000;
const maxTotalCharacters = 32000;
const connectionStatuses = new Set<PersonalAiConnectionStatus>(["unconfigured", "untested", "ready", "error"]);
const configSources = new Set<PersonalAiConfigSource>(["personal", "admin_default", "unconfigured"]);

function malformedResponse(): Error {
  return new Error("개인 AI 응답을 확인할 수 없습니다.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isLowercaseProvider(value: unknown, allowEmpty = false): value is string {
  return typeof value === "string"
    && ((allowEmpty && value === "") || (value.length > 0 && value === value.trim().toLowerCase() && /^[a-z0-9-]+$/.test(value)));
}

function normalizeMessages(messages: PersonalAiChatMessage[]): PersonalAiChatMessage[] {
  return (Array.isArray(messages) ? messages : []).map((message) => {
    const role = message?.role;
    const content = String(message?.content ?? "");
    if ((role !== "user" && role !== "assistant") || !content || content.length > maxMessageCharacters) {
      throw new Error("개인 AI 대화 기록을 다시 불러와 주세요.");
    }
    return { role, content };
  });
}

export function limitPersonalAiMessages(messages: PersonalAiChatMessage[]): PersonalAiChatMessage[] {
  const limited = normalizeMessages(messages).slice(-maxMessages);
  while (
    limited.length > 1
    && limited.reduce((total, message) => total + message.content.length, 0) > maxTotalCharacters
  ) {
    limited.shift();
  }
  return limited;
}

export function buildPersonalAiChatPayload(history: PersonalAiChatMessage[], prompt: string) {
  const content = prompt.trim();
  if (!content) throw new Error("개인 AI 질문을 입력해 주세요.");
  if (content.length > maxMessageCharacters) throw new Error("개인 AI 질문은 8,000자 이하여야 합니다.");

  return { messages: limitPersonalAiMessages([...normalizeMessages(history), { role: "user", content }]) };
}

export function readPersonalAiProviders(body: unknown): { providers: PersonalAiProviderOption[] } {
  if (!isRecord(body) || !Array.isArray(body.providers)) throw malformedResponse();
  const providers = body.providers.map((option) => {
    if (
      !isRecord(option)
      || !isLowercaseProvider(option.provider)
      || typeof option.label !== "string"
      || !option.label.trim()
      || typeof option.apiKeyRequired !== "boolean"
    ) {
      throw malformedResponse();
    }
    return { provider: option.provider, label: option.label.trim(), apiKeyRequired: option.apiKeyRequired };
  });
  return { providers };
}

export function readPersonalAiConfig(body: unknown): PersonalAiConfig {
  if (
    !isRecord(body)
    || !isLowercaseProvider(body.provider, true)
    || typeof body.model !== "string"
    || typeof body.apiKeyConfigured !== "boolean"
    || !connectionStatuses.has(body.connectionStatus as PersonalAiConnectionStatus)
    || !configSources.has(body.configSource as PersonalAiConfigSource)
    || !isNullableString(body.lastTestCode ?? null)
    || !isNullableString(body.lastTestedAt ?? null)
  ) {
    throw malformedResponse();
  }
  return {
    provider: body.provider,
    model: body.model,
    apiKeyConfigured: body.apiKeyConfigured,
    connectionStatus: body.connectionStatus as PersonalAiConnectionStatus,
    lastTestCode: typeof body.lastTestCode === "string" ? body.lastTestCode : null,
    lastTestedAt: typeof body.lastTestedAt === "string" ? body.lastTestedAt : null,
    configSource: body.configSource as PersonalAiConfigSource,
  };
}

export function readPersonalAiModelList(body: unknown): PersonalAiModelList {
  if (
    !isRecord(body)
    || typeof body.success !== "boolean"
    || !isLowercaseProvider(body.provider)
    || !Array.isArray(body.models)
    || body.models.some((model) => typeof model !== "string" || !model.trim() || model !== model.trim())
    || typeof body.code !== "string"
    || !body.code
    || typeof body.message !== "string"
    || !body.message
    || typeof body.loadedAt !== "string"
    || !body.loadedAt
    || (body.success && body.models.length === 0)
    || (!body.success && body.models.length > 0)
  ) {
    throw malformedResponse();
  }
  return {
    success: body.success,
    provider: body.provider,
    models: [...new Set(body.models as string[])],
    code: body.code,
    message: body.message,
    loadedAt: body.loadedAt,
  };
}

export function readPersonalAiConnectionTest(body: unknown): PersonalAiConnectionTest {
  if (
    !isRecord(body)
    || typeof body.success !== "boolean"
    || !isLowercaseProvider(body.provider)
    || typeof body.model !== "string"
    || !body.model
    || typeof body.code !== "string"
    || !body.code
    || typeof body.message !== "string"
    || !body.message
    || !connectionStatuses.has(body.connectionStatus as PersonalAiConnectionStatus)
    || typeof body.testedAt !== "string"
    || !body.testedAt
    || body.success !== (body.connectionStatus === "ready")
  ) {
    throw malformedResponse();
  }
  return body as unknown as PersonalAiConnectionTest;
}

export function readPersonalAiChatResponse(body: unknown): PersonalAiChatResponse {
  const message = isRecord(body) && isRecord(body.message) ? body.message : null;
  if (
    !isRecord(body)
    || !isLowercaseProvider(body.provider)
    || typeof body.model !== "string"
    || !body.model
    || !message
    || message.role !== "assistant"
    || typeof message.content !== "string"
    || !message.content
    || message.content.length > maxMessageCharacters
    || typeof body.generatedAt !== "string"
    || !body.generatedAt
  ) {
    throw malformedResponse();
  }
  return {
    provider: body.provider,
    model: body.model,
    message: { role: "assistant", content: message.content },
    generatedAt: body.generatedAt,
  };
}

export function personalAiErrorMessage(error: unknown) {
  if (
    error instanceof Error
    && error.name === "ApiRequestError"
    && typeof (error as Error & { status?: unknown }).status === "number"
    && typeof (error as Error & { code?: unknown }).code === "string"
    && error.message.trim()
    && error.message.length <= 500
  ) {
    return error.message.trim();
  }
  return "개인 AI 요청을 처리하지 못했습니다.";
}
