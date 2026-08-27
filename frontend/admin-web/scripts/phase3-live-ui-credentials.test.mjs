import assert from "node:assert/strict";
import test from "node:test";

import { loadAdminQaCredentials } from "./phase3-live-ui-credentials.mjs";

test("QA login and password are required before live verification", () => {
  for (const env of [
    {},
    { MOAWORKS_ADMIN_QA_LOGIN: "admin" },
    { MOAWORKS_ADMIN_QA_PASSWORD: "secret" },
    { MOAWORKS_ADMIN_QA_LOGIN: "   ", MOAWORKS_ADMIN_QA_PASSWORD: "secret" },
    { MOAWORKS_ADMIN_QA_LOGIN: "admin", MOAWORKS_ADMIN_QA_PASSWORD: "   " },
  ]) {
    assert.throws(
      () => loadAdminQaCredentials(env),
      /MOAWORKS_ADMIN_QA_LOGIN and MOAWORKS_ADMIN_QA_PASSWORD are required/,
    );
  }
});

test("QA credentials are returned without normalization", () => {
  const credentials = loadAdminQaCredentials({
    MOAWORKS_ADMIN_QA_LOGIN: "qa-admin@example.test",
    MOAWORKS_ADMIN_QA_PASSWORD: "p'ass\\word",
  });

  assert.deepEqual(credentials, {
    login: "qa-admin@example.test",
    password: "p'ass\\word",
  });
});
