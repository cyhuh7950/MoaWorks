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

async function requestJson({ apiBase, path, init, fetchImpl = fetch, invalidateSessionOnAuthFailure = false }) {
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
    const sessionInvalidated = invalidateSessionOnAuthFailure && SESSION_INVALIDATION_STATUSES.has(response.status);
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

function createAuthSessionController({ onLoginCommitted = () => {}, onSessionCleared = () => {} } = {}) {
  let generation = 0;
  let activeToken = "";

  function beginLogin() {
    generation += 1;
    activeToken = "";
    return { generation };
  }

  function isAttemptCurrent(attempt) {
    return Boolean(attempt && attempt.generation === generation);
  }

  function commitLogin(attempt, token, user) {
    if (!isAttemptCurrent(attempt)) return null;
    activeToken = token;
    const context = { generation, token };
    onLoginCommitted({ token, user, context });
    return context;
  }

  function capture(token = activeToken) {
    return { generation, token };
  }

  function isCurrent(context) {
    return Boolean(context && context.generation === generation && context.token === activeToken);
  }

  function logout(message = "") {
    generation += 1;
    activeToken = "";
    onSessionCleared(message);
  }

  function clearAttemptIfCurrent(attempt, message) {
    if (!isAttemptCurrent(attempt)) return false;
    logout(message);
    return true;
  }

  function clearSessionIfCurrent(context, message) {
    if (!isCurrent(context)) return false;
    logout(message);
    return true;
  }

  async function requestForSession({ apiBase, path, init, context, fetchImpl }) {
    try {
      return await requestJson({ apiBase, path, init, fetchImpl, invalidateSessionOnAuthFailure: true });
    } catch (error) {
      if (isSessionInvalidatedError(error)) {
        error.sessionCleared = clearSessionIfCurrent(context, error.message);
      }
      throw error;
    }
  }

  async function requestForAttempt({ apiBase, path, init, attempt, fetchImpl }) {
    try {
      return await requestJson({ apiBase, path, init, fetchImpl, invalidateSessionOnAuthFailure: true });
    } catch (error) {
      if (isSessionInvalidatedError(error)) {
        error.sessionCleared = clearAttemptIfCurrent(attempt, error.message);
      }
      throw error;
    }
  }

  async function applyWhenCurrent(context, operation, apply) {
    const value = await operation;
    if (!isCurrent(context)) return { applied: false, value };
    apply(value);
    return { applied: true, value };
  }

  async function login({ apiBase, identifier, password, fetchImpl }) {
    const attempt = beginLogin();
    const loginBody = await requestJson({
      apiBase,
      path: "/auth/login",
      init: {
        method: "POST",
        body: JSON.stringify({ email: normalizeLoginIdentifier(identifier), password }),
      },
      fetchImpl,
    });
    if (!isAttemptCurrent(attempt)) return { committed: false };
    const meBody = await requestForAttempt({
      apiBase,
      path: "/auth/me",
      init: { headers: { Authorization: `Bearer ${loginBody.accessToken}` } },
      attempt,
      fetchImpl,
    });
    if (!isAttemptCurrent(attempt)) return { committed: false };
    const context = commitLogin(attempt, loginBody.accessToken, meBody.user);
    return context ? { committed: true, context, login: loginBody, me: meBody } : { committed: false };
  }

  return {
    beginLogin,
    capture,
    commitLogin,
    isAttemptCurrent,
    isCurrent,
    logout,
    clearAttemptIfCurrent,
    clearSessionIfCurrent,
    requestForSession,
    applyWhenCurrent,
    login,
  };
}

module.exports = {
  normalizeLoginIdentifier,
  requestJson,
  isSessionInvalidatedError,
  createAuthSessionController,
};
