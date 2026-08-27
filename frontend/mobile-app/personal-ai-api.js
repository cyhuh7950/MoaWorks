const PERSONAL_AI_CONNECTION_STATUSES = new Set(["unconfigured", "untested", "ready", "error"]);
const PERSONAL_AI_CONFIG_SOURCES = new Set(["personal", "admin_default", "unconfigured"]);
const MAX_CHAT_MESSAGES = 20;
const MAX_CHAT_MESSAGE_CHARACTERS = 8000;
const MAX_CHAT_TOTAL_CHARACTERS = 32000;
const SAFE_REQUEST_ERROR = "개인 AI 요청을 처리하지 못했습니다.";
const SAFE_RESPONSE_ERROR = "개인 AI 응답을 확인할 수 없습니다.";

function malformedResponse() {
  return new Error(SAFE_RESPONSE_ERROR);
}

function isNullableString(value) {
  return value === null || typeof value === "string";
}

function isLowercaseProvider(value, { allowEmpty = false } = {}) {
  if (typeof value !== "string") return false;
  if (allowEmpty && value === "") return true;
  return value.length > 0 && value === value.trim().toLowerCase() && /^[a-z0-9-]+$/.test(value);
}

function readPersonalAiProviders(body) {
  if (!body || !Array.isArray(body.providers)) throw malformedResponse();
  return body.providers.map((option) => {
    if (!option || !isLowercaseProvider(option.provider) || typeof option.label !== "string" || !option.label.trim() || typeof option.apiKeyRequired !== "boolean") {
      throw malformedResponse();
    }
    return {
      provider: option.provider,
      label: option.label.trim(),
      apiKeyRequired: option.apiKeyRequired,
    };
  });
}

function readPersonalAiConfig(body) {
  if (
    !body
    || !isLowercaseProvider(body.provider, { allowEmpty: true })
    || typeof body.model !== "string"
    || typeof body.apiKeyConfigured !== "boolean"
    || !PERSONAL_AI_CONNECTION_STATUSES.has(body.connectionStatus)
    || !PERSONAL_AI_CONFIG_SOURCES.has(body.configSource)
    || !isNullableString(body.lastTestCode ?? null)
    || !isNullableString(body.lastTestedAt ?? null)
  ) {
    throw malformedResponse();
  }
  return {
    provider: body.provider,
    model: body.model,
    apiKeyConfigured: body.apiKeyConfigured,
    connectionStatus: body.connectionStatus,
    lastTestCode: body.lastTestCode ?? null,
    lastTestedAt: body.lastTestedAt ?? null,
    configSource: body.configSource,
  };
}

function readPersonalAiModelList(body) {
  if (!body
    || typeof body.success !== "boolean"
    || !isLowercaseProvider(body.provider)
    || !Array.isArray(body.models)
    || body.models.some((model) => typeof model !== "string" || !model.trim() || model !== model.trim())
    || typeof body.code !== "string" || !body.code
    || typeof body.message !== "string" || !body.message
    || typeof body.loadedAt !== "string" || !body.loadedAt
    || (body.success && body.models.length === 0)
    || (!body.success && body.models.length > 0)) {
    throw malformedResponse();
  }
  return { ...body, models: [...new Set(body.models)] };
}

function isPersonalAiConfigReady(config) {
  return Boolean(config && config.configSource === "admin_default" && config.connectionStatus === "ready");
}

function buildPersonalAiConfigPayload({ provider, model, apiKeyDraft }) {
  const normalizedProvider = String(provider || "").trim().toLowerCase();
  const normalizedModel = String(model || "").trim();
  if (!isLowercaseProvider(normalizedProvider) || !normalizedModel || normalizedModel.length > 200) {
    throw new Error("개인 AI Provider와 모델을 확인해 주세요.");
  }
  const normalizedApiKey = String(apiKeyDraft || "").trim();
  if (normalizedApiKey.length > 1000) throw new Error("개인 AI API 키를 확인해 주세요.");
  return normalizedApiKey
    ? { provider: normalizedProvider, model: normalizedModel, apiKey: normalizedApiKey }
    : { provider: normalizedProvider, model: normalizedModel };
}

function buildPersonalAiChatPayload(history, prompt) {
  const normalizedPrompt = String(prompt || "").trim();
  if (!normalizedPrompt) throw new Error("개인 AI 질문을 입력해 주세요.");
  if (normalizedPrompt.length > MAX_CHAT_MESSAGE_CHARACTERS) throw new Error("개인 AI 질문은 8,000자 이하여야 합니다.");

  const normalizedHistory = (Array.isArray(history) ? history : []).map((item) => {
    const role = item?.role;
    const content = String(item?.content ?? item?.body ?? "");
    if (!new Set(["user", "assistant"]).has(role) || !content || content.length > MAX_CHAT_MESSAGE_CHARACTERS) {
      throw new Error("개인 AI 대화 기록을 다시 불러와 주세요.");
    }
    return { role, content };
  });
  const messages = [...normalizedHistory, { role: "user", content: normalizedPrompt }].slice(-MAX_CHAT_MESSAGES);
  while (messages.length > 1 && messages.reduce((total, message) => total + message.content.length, 0) > MAX_CHAT_TOTAL_CHARACTERS) {
    messages.shift();
  }
  return { messages };
}

function readPersonalAiConnectionTest(body) {
  if (
    !body
    || typeof body.success !== "boolean"
    || !isLowercaseProvider(body.provider)
    || typeof body.model !== "string"
    || !body.model
    || typeof body.code !== "string"
    || !body.code
    || typeof body.message !== "string"
    || !body.message
    || !PERSONAL_AI_CONNECTION_STATUSES.has(body.connectionStatus)
    || typeof body.testedAt !== "string"
    || !body.testedAt
    || (body.success !== (body.connectionStatus === "ready"))
  ) {
    throw malformedResponse();
  }
  return {
    success: body.success,
    provider: body.provider,
    model: body.model,
    code: body.code,
    message: body.message,
    connectionStatus: body.connectionStatus,
    testedAt: body.testedAt,
  };
}

function readPersonalAiChatResponse(body) {
  const message = body?.message;
  if (
    !body
    || !isLowercaseProvider(body.provider)
    || typeof body.model !== "string"
    || !body.model
    || !message
    || message.role !== "assistant"
    || typeof message.content !== "string"
    || !message.content
    || message.content.length > MAX_CHAT_MESSAGE_CHARACTERS
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

function personalAiErrorMessage(error) {
  const userMessage = error?.detail?.userMessage;
  return typeof userMessage === "string" && userMessage.trim() && userMessage.length <= 500
    ? userMessage.trim()
    : SAFE_REQUEST_ERROR;
}

function createPersonalAiActionGate() {
  let generation = 0;
  let activeTicket = null;
  return {
    tryEnter(action) {
      if (activeTicket) return null;
      activeTicket = Object.freeze({ action, generation });
      return activeTicket;
    },
    release(ticket) {
      if (ticket === activeTicket) activeTicket = null;
    },
    reset() {
      generation += 1;
      activeTicket = null;
    },
    isBusy(action) {
      return Boolean(activeTicket && (!action || activeTicket.action === action));
    },
  };
}

module.exports = {
  buildPersonalAiChatPayload,
  buildPersonalAiConfigPayload,
  createPersonalAiActionGate,
  personalAiErrorMessage,
  readPersonalAiChatResponse,
  readPersonalAiConfig,
  readPersonalAiConnectionTest,
  readPersonalAiModelList,
  readPersonalAiProviders,
  isPersonalAiConfigReady,
};
