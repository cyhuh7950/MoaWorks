const DEFAULT_API_BASE = "https://user.moaworks.sinsan.kr/api/v1";
const DEFAULT_MAX_REQUEST_BYTES = 256 * 1024;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

const ENDPOINTS = [
  { pattern: /^\/ui-contract$/, methods: ["GET"], public: true },
  { pattern: /^\/auth\/me$/, methods: ["GET"] },
  { pattern: /^\/notifications\/summary$/, methods: ["GET"] },
  { pattern: /^\/notifications\?limit=\d{1,3}$/, methods: ["GET"] },
  { pattern: /^\/notifications\/[A-Za-z0-9_-]+\/ack$/, methods: ["POST"] },
  { pattern: /^\/mail\/(?:inbox|sent)$/, methods: ["GET"] },
  { pattern: /^\/mail\/[A-Za-z0-9_-]+$/, methods: ["GET"] },
  { pattern: /^\/mail\/[A-Za-z0-9_-]+\/(?:read|star)$/, methods: ["POST"] },
  { pattern: /^\/messenger\/rooms$/, methods: ["GET"] },
  { pattern: /^\/messenger\/rooms\/[A-Za-z0-9_-]+\/messages$/, methods: ["GET", "POST"] },
  { pattern: /^\/messenger\/rooms\/[A-Za-z0-9_-]+\/read$/, methods: ["POST"] },
  { pattern: /^\/approvals$/, methods: ["GET", "POST"] },
  { pattern: /^\/approvals\/audit-logs$/, methods: ["GET"] },
  { pattern: /^\/approvals\/[A-Za-z0-9_-]+\/(?:submit|withdraw|redraft|approve|reject)$/, methods: ["POST"] },
];

function normalizeMethod(method) {
  const normalized = String(method || "GET").toUpperCase();
  if (!/^[A-Z]+$/.test(normalized)) {
    throw new Error("허용되지 않은 API method입니다.");
  }
  return normalized;
}

function validateApiBase(apiBase) {
  const url = new URL(apiBase);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("운영 API는 HTTPS origin만 허용합니다.");
  }
  return url.toString().replace(/\/$/, "");
}

function matchEndpoint(requestPath, method) {
  if (typeof requestPath !== "string" || !requestPath.startsWith("/") || requestPath.startsWith("//") || requestPath.includes("\\") || requestPath.includes("..")) {
    throw new Error("허용되지 않은 API 경로입니다.");
  }
  const endpoint = ENDPOINTS.find((entry) => entry.pattern.test(requestPath));
  if (!endpoint) {
    throw new Error("허용되지 않은 API 경로입니다.");
  }
  if (!endpoint.methods.includes(method)) {
    throw new Error("허용되지 않은 API method입니다.");
  }
  return endpoint;
}

function serializeBody(body, maxRequestBytes) {
  if (body == null) return undefined;
  const serialized = typeof body === "string" ? body : JSON.stringify(body);
  try {
    JSON.parse(serialized);
  } catch {
    throw new Error("요청 본문은 JSON이어야 합니다.");
  }
  if (Buffer.byteLength(serialized, "utf8") > maxRequestBytes) {
    throw new Error("요청 크기가 허용 범위를 초과했습니다.");
  }
  return serialized;
}

function validateCredentials(credentials) {
  const email = String(credentials?.email || "").trim();
  const password = String(credentials?.password || "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new Error("이메일 형식이 올바르지 않습니다.");
  }
  if (!password || password.length > 1024) {
    throw new Error("로그인 입력을 확인해 주세요.");
  }
  return { email, password };
}

function createApiBroker(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("운영 API 연결 기능을 사용할 수 없습니다.");
  }
  const apiBase = validateApiBase(options.apiBase || DEFAULT_API_BASE);
  const maxRequestBytes = options.maxRequestBytes || DEFAULT_MAX_REQUEST_BYTES;
  const maxResponseBytes = options.maxResponseBytes || DEFAULT_MAX_RESPONSE_BYTES;
  let sessionCredential = "";

  async function readResponse(response) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxResponseBytes) {
      throw new Error("응답 크기가 허용 범위를 초과했습니다.");
    }
    let body = {};
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        throw new Error("운영 API 응답 형식이 올바르지 않습니다.");
      }
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 423) {
        sessionCredential = "";
      }
      throw new Error(`운영 API 요청 실패 (${response.status})`);
    }
    return body;
  }

  async function perform(requestPath, method, body, includeSession) {
    const headers = { "Content-Type": "application/json", Accept: "application/json" };
    const serializedBody = serializeBody(body, maxRequestBytes);
    if (includeSession) {
      if (!sessionCredential) throw new Error("로그인이 필요합니다.");
      headers.Authorization = `Bearer ${sessionCredential}`;
    }
    const response = await fetchImpl(`${apiBase}${requestPath}`, {
      method,
      headers,
      body: serializedBody,
      redirect: "error",
    });
    return readResponse(response);
  }

  return Object.freeze({
    async login(credentials) {
      const body = await perform("/auth/login", "POST", validateCredentials(credentials), false);
      const nextCredential = typeof body.accessToken === "string" ? body.accessToken : "";
      if (!nextCredential || nextCredential.length > 16_384) {
        throw new Error("로그인 응답을 확인할 수 없습니다.");
      }
      sessionCredential = nextCredential;
      return { authenticated: true };
    },
    async request(input) {
      const method = normalizeMethod(input?.method);
      const endpoint = matchEndpoint(input?.path, method);
      return perform(input.path, method, input.body, !endpoint.public);
    },
    logout() {
      sessionCredential = "";
      return { authenticated: false };
    },
    clearSession() {
      sessionCredential = "";
    },
    hasSession() {
      return Boolean(sessionCredential);
    },
  });
}

module.exports = {
  DEFAULT_API_BASE,
  ENDPOINTS,
  createApiBroker,
  matchEndpoint,
  validateApiBase,
};
