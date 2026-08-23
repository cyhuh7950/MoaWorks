const COMPANY_EMAIL_DOMAIN = "moaworks.sinsan.kr";
const SESSION_INVALIDATION_STATUSES = new Set([401, 403]);

function normalizeLoginIdentifier(value) {
  const identifier = String(value || "").trim();
  if (!identifier || identifier.includes("@")) {
    return identifier;
  }
  return `${identifier}@${COMPANY_EMAIL_DOMAIN}`;
}

function sessionMessageFor(status) {
  return status === 403
    ? "권한이 없거나 세션이 만료되었습니다. 다시 로그인 후 업무를 계속하세요."
    : "세션이 만료되었습니다. 다시 로그인 후 업무를 계속하세요.";
}

function isSessionInvalidatedError(error) {
  return Boolean(error && error.sessionInvalidated === true);
}

async function requestJson({ apiBase, path, init, fetchImpl = fetch }) {
  const response = await fetchImpl(`${apiBase}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const raw = await response.text();
  let data = {};
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = {};
    }
  }
  if (!response.ok) {
    const sessionInvalidated = SESSION_INVALIDATION_STATUSES.has(response.status);
    const detail = data.detail;
    const userMessage = sessionInvalidated
      ? sessionMessageFor(response.status)
      : detail?.userMessage || data.userMessage || "요청 처리 실패";
    const error = new Error(userMessage);
    error.status = response.status;
    error.sessionInvalidated = sessionInvalidated;
    throw error;
  }
  return data;
}

module.exports = {
  normalizeLoginIdentifier,
  requestJson,
  isSessionInvalidatedError,
};
