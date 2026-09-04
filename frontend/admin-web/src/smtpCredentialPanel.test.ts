import { describe, expect, it } from "vitest";

import { getCredentialRows, getCredentialIssueCandidates } from "./smtpCredentialPanel";

const users = [
  { userId: "active-issued", userName: "발급 사용자", userEmail: "issued@example.com", status: "active" },
  { userId: "active-unissued", userName: "미발급 사용자", userEmail: "new@example.com", status: "active" },
  { userId: "deleted", userName: "삭제 사용자", userEmail: "deleted@example.com", status: "deleted" },
];

const credentials = [
  { userId: "active-issued", userName: "발급 사용자", userEmail: "issued@example.com", username: "issued@example.com", active: true },
  { userId: "deleted", userName: "삭제 사용자", userEmail: "deleted@example.com", username: "deleted@example.com", active: true },
  { userId: "revoked", userName: "폐기 사용자", userEmail: "revoked@example.com", username: "revoked@example.com", active: false },
];

describe("SMTP credential panel selectors", () => {
  it("shows only active users with active credentials", () => {
    expect(getCredentialRows(users, credentials).map((row) => row.userId)).toEqual(["active-issued"]);
  });

  it("offers only active users without an active credential for issuance", () => {
    expect(getCredentialIssueCandidates(users, credentials).map((user) => user.userId)).toEqual(["active-unissued"]);
  });
});
