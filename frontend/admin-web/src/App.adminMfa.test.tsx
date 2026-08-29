// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  storeToken: vi.fn(),
  verifyAdminMfa: vi.fn(),
  requestAdminMfaRecoveryEmail: vi.fn(),
  verifyAdminMfaRecoveryEmail: vi.fn(),
  startAdminMfaTotp: vi.fn(),
  fetchAdminMfaTotpQr: vi.fn(),
  confirmAdminMfaTotp: vi.fn(),
  requestAdminMfaRecovery: vi.fn(),
  verifyAdminMfaRecovery: vi.fn(),
  fetchMailOperations: vi.fn(),
}));

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return {
    ...actual,
    getStoredToken: () => "",
    storeToken: mocks.storeToken,
    fetchHealth: vi.fn().mockResolvedValue({ status: "ok", initialized: true, components: {} }),
    fetchPublicUiContract: vi.fn().mockResolvedValue({
      company: { name: "MoaWorks", domain: "moaworks.invalid", logoDataUrl: "" },
    }),
    fetchTranslationStatus: vi.fn().mockResolvedValue({
      enabled: false,
      provider: "disabled",
      providerAvailable: false,
      cacheAvailable: false,
    }),
    fetchDirectory: vi.fn().mockResolvedValue({
      company: { name: "MoaWorks", domain: "moaworks.invalid" },
      users: [],
      departments: [],
      roles: [],
    }),
    fetchMailDeliveryStatus: vi.fn().mockResolvedValue({ provider: { providerKey: "self_hosted" } }),
    fetchMailDeliveryQueue: vi.fn().mockResolvedValue({ queue: [] }),
    fetchMailOperations: mocks.fetchMailOperations,
    fetchAdminMessengerRooms: vi.fn().mockResolvedValue({ rooms: [] }),
    fetchTranslationPolicy: vi.fn().mockResolvedValue({
      provider: "disabled",
      model: "",
      apiBaseUrl: "",
      cacheEnabled: false,
      timeoutSeconds: 15,
      maxRetries: 2,
      rateLimitPerMinute: 60,
      circuitFailureThreshold: 5,
      circuitRecoverySeconds: 60,
      costUnit: "tokens",
    }),
    fetchTranslationReviews: vi.fn().mockResolvedValue({ items: [] }),
    fetchUiContract: vi.fn().mockResolvedValue({
      company: { name: "MoaWorks", domain: "moaworks.invalid", logoDataUrl: "" },
    }),
    fetchAdminMfaStatus: vi.fn().mockResolvedValue({
      enrolled: true,
      status: "active",
      recoveryEmailMasked: "r***@example.invalid",
      profileVersion: 1,
    }),
    login: mocks.login,
    verifyAdminMfa: mocks.verifyAdminMfa,
    requestAdminMfaRecoveryEmail: mocks.requestAdminMfaRecoveryEmail,
    verifyAdminMfaRecoveryEmail: mocks.verifyAdminMfaRecoveryEmail,
    startAdminMfaTotp: mocks.startAdminMfaTotp,
    fetchAdminMfaTotpQr: mocks.fetchAdminMfaTotpQr,
    confirmAdminMfaTotp: mocks.confirmAdminMfaTotp,
    requestAdminMfaRecovery: mocks.requestAdminMfaRecovery,
    verifyAdminMfaRecovery: mocks.verifyAdminMfaRecovery,
  };
});

import App from "./App";

describe("admin MFA login", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.login.mockReset();
    mocks.storeToken.mockReset();
    mocks.verifyAdminMfa.mockReset();
    mocks.requestAdminMfaRecoveryEmail.mockReset();
    mocks.verifyAdminMfaRecoveryEmail.mockReset();
    mocks.startAdminMfaTotp.mockReset();
    mocks.fetchAdminMfaTotpQr.mockReset();
    mocks.confirmAdminMfaTotp.mockReset();
    mocks.requestAdminMfaRecovery.mockReset();
    mocks.verifyAdminMfaRecovery.mockReset();
    mocks.fetchMailOperations.mockReset();
    mocks.fetchMailOperations.mockResolvedValue({
      domain: null,
      providers: [],
      queue: {},
      feedbackCount: 0,
      ociSuppression: { activeCount: 0, lastSeenAt: null },
      dailySendUsage: { used: 0, limit: 0, unlimited: true, remaining: null, resetAt: "2026-08-30T00:00:00+09:00" },
    });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:task9-mfa-qr"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("does not store a token before the TOTP challenge succeeds", async () => {
    mocks.login.mockResolvedValue({
      nextAction: "mfa_required",
      challengeId: "opaque-login-challenge",
      expiresAt: "2026-08-29T12:00:00+09:00",
    });
    const user = userEvent.setup();
    render(<App />);

    await user.type(await screen.findByLabelText(/관리자 아이디/), "admin");
    await user.type(screen.getByLabelText("비밀번호"), "fixture-password");
    await user.click(screen.getByRole("button", { name: "로그인" }));

    expect(await screen.findByLabelText("인증 앱 코드")).toBeTruthy();
    expect(mocks.storeToken).not.toHaveBeenCalled();
    expect(localStorage.getItem("moaworks.adminToken")).toBeNull();
    await waitFor(() => expect(mocks.login).toHaveBeenCalledTimes(1));
  });

  it("stores the token only after the TOTP challenge succeeds", async () => {
    mocks.login.mockResolvedValue({
      nextAction: "mfa_required",
      challengeId: "opaque-login-challenge",
      expiresAt: "2026-08-29T12:00:00+09:00",
    });
    mocks.verifyAdminMfa.mockResolvedValue({
      nextAction: "authenticated",
      accessToken: "verified-admin-token",
      tokenType: "bearer",
      expiresIn: 3600,
      user: {},
    });
    const user = userEvent.setup();
    render(<App />);

    await user.type(await screen.findByLabelText(/관리자 아이디/), "admin");
    await user.type(screen.getByLabelText("비밀번호"), "fixture-password");
    await user.click(screen.getByRole("button", { name: "로그인" }));
    await user.type(await screen.findByLabelText("인증 앱 코드"), "123456");
    expect(mocks.storeToken).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "코드 확인" }));

    await waitFor(() => expect(mocks.verifyAdminMfa).toHaveBeenCalledWith({
      challengeId: "opaque-login-challenge",
      code: "123456",
    }));
    await waitFor(() => expect(mocks.storeToken).toHaveBeenCalledWith("verified-admin-token"));
  });

  it("메일 발송량 제목은 API 로드가 끝난 뒤에만 나타나며 0 한도를 무제한으로 표시한다", async () => {
    let resolveOperations!: (value: Record<string, unknown>) => void;
    mocks.fetchMailOperations.mockImplementation(() => new Promise((resolve) => { resolveOperations = resolve; }));
    mocks.login.mockResolvedValue({ nextAction: "mfa_required", challengeId: "opaque-login-challenge", expiresAt: "2026-08-29T12:00:00+09:00" });
    mocks.verifyAdminMfa.mockResolvedValue({ nextAction: "authenticated", accessToken: "verified-admin-token", tokenType: "bearer", expiresIn: 3600, user: {} });
    const user = userEvent.setup();
    render(<App />);

    await user.type(await screen.findByLabelText(/관리자 아이디/), "admin");
    await user.type(screen.getByLabelText("비밀번호"), "fixture-password");
    await user.click(screen.getByRole("button", { name: "로그인" }));
    await user.type(await screen.findByLabelText("인증 앱 코드"), "123456");
    await user.click(screen.getByRole("button", { name: "코드 확인" }));
    await user.click(await screen.findByRole("button", { name: "메일 설정" }));

    expect(screen.queryByText("오늘 발송", { exact: true })).toBeNull();
    await act(async () => resolveOperations({
      domain: null,
      providers: [],
      queue: {},
      feedbackCount: 0,
      ociSuppression: { activeCount: 0, lastSeenAt: null },
      dailySendUsage: { used: 0, limit: 0, unlimited: true, remaining: null, resetAt: "2026-08-30T00:00:00+09:00" },
    }));

    expect(await screen.findByText("오늘 발송", { exact: true })).toBeTruthy();
    expect(document.body.textContent).toContain("0 / 무제한");
    expect(document.body.textContent).toContain("남은 한도: 무제한");
  });

  it("enrolls a pending admin and shows recovery codes before storing the token", async () => {
    mocks.login.mockResolvedValue({
      nextAction: "mfa_enrollment_required",
      challengeId: "opaque-enrollment-challenge",
      expiresAt: "2026-08-29T12:00:00+09:00",
    });
    mocks.requestAdminMfaRecoveryEmail.mockResolvedValue({
      challengeId: "opaque-email-challenge",
      expiresAt: "2026-08-29T12:00:00+09:00",
    });
    mocks.verifyAdminMfaRecoveryEmail.mockResolvedValue({ verified: true });
    mocks.startAdminMfaTotp.mockResolvedValue({
      challengeId: "opaque-totp-challenge",
      expiresAt: "2026-08-29T12:00:00+09:00",
      manualKey: "JBSWY3DPEHPK3PXP",
      qrPath: "/auth/admin/mfa/totp/qr",
    });
    mocks.fetchAdminMfaTotpQr.mockResolvedValue(new Blob(["png"], { type: "image/png" }));
    mocks.confirmAdminMfaTotp.mockResolvedValue({
      nextAction: "authenticated",
      accessToken: "enrolled-admin-token",
      tokenType: "bearer",
      expiresIn: 3600,
      user: {},
      recoveryCodes: ["recovery-code-one", "recovery-code-two"],
    });
    const user = userEvent.setup();
    render(<App />);

    await user.type(await screen.findByLabelText(/관리자 아이디/), "admin");
    await user.type(screen.getByLabelText("비밀번호"), "fixture-password");
    await user.click(screen.getByRole("button", { name: "로그인" }));
    await user.type(await screen.findByLabelText("복구 이메일"), "recovery@example.invalid");
    await user.click(screen.getByRole("button", { name: "인증 코드 보내기" }));
    await user.type(await screen.findByLabelText("이메일 인증 코드"), "123456");
    await user.click(screen.getByRole("button", { name: "이메일 확인" }));

    expect(await screen.findByText("JBSWY3DPEHPK3PXP")).toBeTruthy();
    await user.type(screen.getByLabelText("인증 앱 코드"), "654321");
    await user.click(screen.getByRole("button", { name: "인증 앱 등록 완료" }));

    expect(await screen.findByText("recovery-code-one")).toBeTruthy();
    expect(mocks.storeToken).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "복구 코드를 저장했습니다" }));
    await waitFor(() => expect(mocks.storeToken).toHaveBeenCalledWith("enrolled-admin-token"));
  });

  it("uses a one-time recovery code only to enter TOTP reenrollment", async () => {
    mocks.login.mockResolvedValue({
      nextAction: "mfa_required",
      challengeId: "opaque-login-challenge",
      expiresAt: "2026-08-29T12:00:00+09:00",
    });
    mocks.verifyAdminMfaRecovery.mockResolvedValue({
      nextAction: "mfa_reenroll_required",
      challengeId: "opaque-reenroll-challenge",
      expiresAt: "2026-08-29T12:00:00+09:00",
    });
    mocks.startAdminMfaTotp.mockResolvedValue({
      challengeId: "opaque-reenroll-totp",
      expiresAt: "2026-08-29T12:00:00+09:00",
      manualKey: "KRSXG5DSNFXGOIDB",
      qrPath: "/auth/admin/mfa/totp/qr",
    });
    mocks.fetchAdminMfaTotpQr.mockResolvedValue(new Blob(["png"], { type: "image/png" }));
    const user = userEvent.setup();
    render(<App />);

    await user.type(await screen.findByLabelText(/관리자 아이디/), "admin");
    await user.type(screen.getByLabelText("비밀번호"), "fixture-password");
    await user.click(screen.getByRole("button", { name: "로그인" }));
    await user.click(await screen.findByRole("button", { name: "인증 앱을 사용할 수 없나요?" }));
    await user.type(screen.getByLabelText("일회용 복구 코드"), "recovery-code-with-high-entropy");
    await user.click(screen.getByRole("button", { name: "복구 코드 확인" }));

    await waitFor(() => expect(mocks.verifyAdminMfaRecovery).toHaveBeenCalledWith({
      email: "admin@moaworks.invalid",
      recoveryCode: "recovery-code-with-high-entropy",
    }));
    expect(await screen.findByText("KRSXG5DSNFXGOIDB")).toBeTruthy();
    expect(mocks.startAdminMfaTotp).toHaveBeenCalledWith({
      flowChallengeId: "opaque-reenroll-challenge",
    });
    expect(mocks.storeToken).not.toHaveBeenCalled();
  });
});
