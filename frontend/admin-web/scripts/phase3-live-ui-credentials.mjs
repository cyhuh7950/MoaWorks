export function loadAdminQaCredentials(env = process.env) {
  const login = env.MOAWORKS_ADMIN_QA_LOGIN;
  const password = env.MOAWORKS_ADMIN_QA_PASSWORD;

  if (!login?.trim() || !password?.trim()) {
    throw new Error(
      "MOAWORKS_ADMIN_QA_LOGIN and MOAWORKS_ADMIN_QA_PASSWORD are required",
    );
  }

  return { login, password };
}
