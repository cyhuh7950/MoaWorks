import { useEffect, useMemo, useRef, useState } from "react";
import { PaperPlaneRight, Plus, Robot, SlidersHorizontal, User } from "@phosphor-icons/react";

import {
  fetchPersonalAiConfig,
  fetchPersonalAiProviders,
  sendPersonalAiChat,
  testPersonalAiConnection,
  updatePersonalAiConfig,
  type PersonalAiChatMessage,
  type PersonalAiChatResponse,
  type PersonalAiConfig,
  type PersonalAiConnectionTest,
  type PersonalAiProviderOption,
} from "./api";
import { buildPersonalAiChatPayload, limitPersonalAiMessages, personalAiErrorMessage } from "./personalAi";

export type PersonalAiClient = {
  listProviders(token: string): Promise<{ providers: PersonalAiProviderOption[] }>;
  getConfig(token: string): Promise<PersonalAiConfig>;
  saveConfig(token: string, payload: { provider: string; model: string; apiKey?: string }): Promise<PersonalAiConfig>;
  testConnection(token: string): Promise<PersonalAiConnectionTest>;
  chat(token: string, payload: { messages: PersonalAiChatMessage[] }): Promise<PersonalAiChatResponse>;
};

const defaultClient: PersonalAiClient = {
  listProviders: fetchPersonalAiProviders,
  getConfig: fetchPersonalAiConfig,
  saveConfig: updatePersonalAiConfig,
  testConnection: testPersonalAiConnection,
  chat: sendPersonalAiChat,
};

const emptyConfig: PersonalAiConfig = {
  provider: "",
  model: "",
  apiKeyConfigured: false,
  connectionStatus: "unconfigured",
  lastTestCode: null,
  lastTestedAt: null,
};

export function PersonalAiPanel({ token, client = defaultClient }: { token: string; client?: PersonalAiClient }) {
  const [providers, setProviders] = useState<PersonalAiProviderOption[]>([]);
  const [config, setConfig] = useState<PersonalAiConfig>(emptyConfig);
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [messages, setMessages] = useState<PersonalAiChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [configDirty, setConfigDirty] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [pending, setPending] = useState<"load" | "save" | "test" | "chat" | "">("load");
  const [error, setError] = useState("");
  const requestGeneration = useRef(0);

  useEffect(() => {
    const generation = ++requestGeneration.current;
    setPending("load");
    setError("");
    setMessages([]);
    setDraft("");
    setConfigDirty(false);
    setSessionReady(false);
    Promise.all([client.listProviders(token), client.getConfig(token)])
      .then(([providerResult, configResult]) => {
        if (generation !== requestGeneration.current) return;
        setProviders(providerResult.providers);
        setConfig(configResult);
        setProvider(configResult.provider || providerResult.providers[0]?.provider || "");
        setModel(configResult.model);
        setConfigDirty(false);
        setSessionReady(false);
      })
      .catch((loadError) => {
        if (generation === requestGeneration.current) setError(personalAiErrorMessage(loadError));
      })
      .finally(() => {
        if (generation === requestGeneration.current) setPending("");
      });
    return () => { requestGeneration.current += 1; };
  }, [client, token]);

  const providerLabel = useMemo(
    () => providers.find((item) => item.provider === config.provider)?.label || config.provider.toUpperCase() || "Provider 미설정",
    [config.provider, providers],
  );

  async function saveSettings() {
    if (pending || !provider || !model.trim()) return;
    const generation = requestGeneration.current;
    const payload = {
      provider,
      model: model.trim(),
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
    };
    setApiKey("");
    setPending("save");
    setError("");
    try {
      const next = await client.saveConfig(token, payload);
      if (generation !== requestGeneration.current) return;
      setConfig(next);
      setProvider(next.provider);
      setModel(next.model);
      setConfigDirty(false);
      setSessionReady(false);
    } catch (saveError) {
      if (generation === requestGeneration.current) setError(personalAiErrorMessage(saveError));
    } finally {
      if (generation === requestGeneration.current) setPending("");
    }
  }

  async function runConnectionTest() {
    if (pending || configDirty || !config.provider || !config.model) return;
    const generation = requestGeneration.current;
    setPending("test");
    setError("");
    try {
      const result = await client.testConnection(token);
      if (generation !== requestGeneration.current) return;
      setConfig((current) => ({
        ...current,
        provider: result.provider,
        model: result.model,
        connectionStatus: result.connectionStatus,
        lastTestCode: result.code,
        lastTestedAt: result.testedAt,
      }));
      setSessionReady(result.success && result.connectionStatus === "ready");
      if (!result.success) setError(result.message);
    } catch (testError) {
      if (generation === requestGeneration.current) {
        setSessionReady(false);
        setError(personalAiErrorMessage(testError));
      }
    } finally {
      if (generation === requestGeneration.current) setPending("");
    }
  }

  async function sendMessage() {
    if (pending || !sessionReady || !draft.trim()) return;
    const generation = requestGeneration.current;
    let payload: { messages: PersonalAiChatMessage[] };
    try {
      payload = buildPersonalAiChatPayload(messages, draft);
    } catch (validationError) {
      setError(personalAiErrorMessage(validationError));
      return;
    }
    const userMessage = payload.messages[payload.messages.length - 1];
    setDraft("");
    setMessages((current) => limitPersonalAiMessages([...current, userMessage]));
    setPending("chat");
    setError("");
    try {
      const result = await client.chat(token, payload);
      if (generation !== requestGeneration.current) return;
      setConfig((current) => ({ ...current, provider: result.provider, model: result.model }));
      setMessages((current) => limitPersonalAiMessages([...current, result.message]));
    } catch (chatError) {
      if (generation === requestGeneration.current) setError(personalAiErrorMessage(chatError));
    } finally {
      if (generation === requestGeneration.current) setPending("");
    }
  }

  return (
    <section className="personal-ai-panel" aria-label="AI 채팅">
      <header className="personal-ai-panel__header">
        <div>
          <p>PERSONAL AI</p>
          <h2>AI 채팅</h2>
          <div className="personal-ai-panel__connection" aria-live="polite">
            <span>{providerLabel}{config.model ? ` · ${config.model}` : ""}</span>
            <strong className={sessionReady ? "is-ready" : ""}>{configDirty ? "설정 저장 필요" : sessionReady ? "연결됨" : "연결 시험 필요"}</strong>
          </div>
        </div>
        <div className="personal-ai-panel__header-actions">
          <button type="button" onClick={() => setSettingsOpen((current) => !current)} aria-expanded={settingsOpen} aria-label="AI 연결 설정">
            <SlidersHorizontal size={18} aria-hidden="true" /> 연결 설정
          </button>
          <button type="button" onClick={() => void runConnectionTest()} disabled={Boolean(pending) || configDirty || !config.provider || !config.model} aria-label="LLM 연결 시험">
            {pending === "test" ? "시험 중" : "연결 시험"}
          </button>
        </div>
      </header>

      {settingsOpen ? (
        <section className="personal-ai-settings" aria-label="AI 연결 설정 양식">
          <label><span>Provider</span><select value={provider} disabled={Boolean(pending)} onChange={(event) => { setProvider(event.target.value); setConfigDirty(true); setSessionReady(false); }}>
            {providers.map((item) => <option key={item.provider} value={item.provider}>{item.label}</option>)}
          </select></label>
          <label><span>모델</span><input value={model} disabled={Boolean(pending)} maxLength={200} onChange={(event) => { setModel(event.target.value); setConfigDirty(true); setSessionReady(false); }} /></label>
          <label><span>API 키</span><input aria-label="개인 AI API 키" type="password" value={apiKey} disabled={Boolean(pending)} maxLength={1000} placeholder={config.apiKeyConfigured ? "새 키를 입력할 때만 변경" : "API 키 입력"} onChange={(event) => { setApiKey(event.target.value); setConfigDirty(true); setSessionReady(false); }} /></label>
          <div className="personal-ai-settings__footer">
            <span>{config.apiKeyConfigured ? "API 키 설정됨" : "API 키 미설정"}</span>
            <button type="button" disabled={Boolean(pending) || !provider || !model.trim()} onClick={() => void saveSettings()} aria-label="개인 AI 설정 저장">
              {pending === "save" ? "저장 중" : "설정 저장"}
            </button>
          </div>
        </section>
      ) : null}

      <div className="personal-ai-conversation" aria-label="AI 대화 내용" aria-live="polite">
        {messages.length === 0 ? (
          <div className="personal-ai-message is-assistant">
            <span className="personal-ai-message__avatar"><Robot size={20} aria-hidden="true" /></span>
            <div><strong>MoaWorks AI</strong><p>안녕하세요. 연결된 개인 AI에게 무엇이든 물어보세요.</p></div>
          </div>
        ) : messages.map((message, index) => (
          <div key={`${message.role}-${index}`} className={`personal-ai-message is-${message.role}`}>
            <span className="personal-ai-message__avatar">{message.role === "assistant" ? <Robot size={20} aria-hidden="true" /> : <User size={20} aria-hidden="true" />}</span>
            <div><strong>{message.role === "assistant" ? "MoaWorks AI" : "나"}</strong><p>{message.content}</p></div>
          </div>
        ))}
        {pending === "chat" ? <div className="personal-ai-message is-assistant is-pending"><span className="personal-ai-message__avatar"><Robot size={20} aria-hidden="true" /></span><div><strong>MoaWorks AI</strong><p>답변을 작성하고 있습니다.</p></div></div> : null}
      </div>

      {error ? <div className="personal-ai-panel__error" role="alert">{error}</div> : null}
      {!sessionReady ? <p className="personal-ai-panel__notice">현재 로그인 세션에서 연결 시험을 완료하면 질문을 보낼 수 있습니다.</p> : null}
      <form className="personal-ai-composer" onSubmit={(event) => { event.preventDefault(); void sendMessage(); }}>
        <button type="button" disabled aria-label="AI 첨부 준비 중"><Plus size={20} aria-hidden="true" /></button>
        <textarea aria-label="AI 질문" value={draft} maxLength={8000} placeholder="무엇이든 물어보세요..." disabled={pending === "load"} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void sendMessage();
          }
        }} />
        <button className="is-primary" type="submit" aria-label="AI 질문 보내기" disabled={!sessionReady || Boolean(pending) || !draft.trim()}>
          <PaperPlaneRight size={20} weight="fill" aria-hidden="true" />
        </button>
      </form>
    </section>
  );
}
