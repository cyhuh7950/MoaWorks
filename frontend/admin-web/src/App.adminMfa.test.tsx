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
  fetchDirectory: vi.fn(),
  testRelay: vi.fn(),
  fetchMailDeliveryStatus: vi.fn(),
  fetchMailDeliveryQueue: vi.fn(),
  fetchMailDeliveryDetail: vi.fn(),
  retryMailDelivery: vi.fn(),
  updateMailOperationsProvider: vi.fn(),
  testMailOperationsProvider: vi.fn(),
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
    fetchDirectory: mocks.fetchDirectory,
    testRelay: mocks.testRelay,
    fetchMailSubmissionCredentials: vi.fn().mockResolvedValue([]),
    fetchMonitoringOverview: vi.fn().mockResolvedValue({ alertOpenCount: 0 }),
    fetchMonitoringEvents: vi.fn().mockResolvedValue({ events: [] }),
    fetchMonitoringAlerts: vi.fn().mockResolvedValue({ alerts: [] }),
    fetchOperationalBackups: vi.fn().mockResolvedValue({ policy: { enabled: false, intervalHours: 24, retentionDays: 7 }, backups: [], drills: [] }),
    fetchMailDeliveryStatus: mocks.fetchMailDeliveryStatus,
    fetchMailDeliveryQueue: mocks.fetchMailDeliveryQueue,
    fetchMailDeliveryDetail: mocks.fetchMailDeliveryDetail,
    retryMailDelivery: mocks.retryMailDelivery,
    updateMailOperationsProvider: mocks.updateMailOperationsProvider,
    testMailOperationsProvider: mocks.testMailOperationsProvider,
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
  async function openMail() {
    mocks.login.mockResolvedValue({ nextAction: 'authenticated', accessToken: 'fixture-admin', user: {} });
    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByLabelText(/관리자 아이디/), 'admin');
    await user.type(screen.getByLabelText('비밀번호'), 'fixture-password');
    await user.click(screen.getByRole('button', { name: '로그인' }));
    await user.click(await screen.findByRole('button', { name: '메일 설정' }));
    return user;
  }

  const queueItem = { queueId: 'q1', mailId: 'm1', recipientEmail: 'queue@example.invalid', subject: '결과불명 시험', status: 'result_unknown', attemptCount: 1, nextAttemptAt: null, leaseExpiresAt: null, createdAt: '2026-09-05T00:00:00Z' };

  it('Stage3B 실제 items/detail을 표시하고 unknown 취소시 재시도0, 확인후 strict true', async () => {
    mocks.fetchMailDeliveryQueue.mockResolvedValue({ items: [queueItem], total: 1 });
    mocks.fetchMailDeliveryDetail.mockResolvedValue({ item: queueItem, attempts: [{ attemptNumber: 1, result: 'result_unknown', errorMessage: 'DATA 이후 결과 확인 필요', relayResponse: null, startedAt: queueItem.createdAt, finishedAt: queueItem.createdAt }], audits: [{ event: 'mail.delivery.result_unknown', status_before: 'processing', status_after: 'result_unknown', reason: '확인 필요', created_at: queueItem.createdAt }] });
    mocks.retryMailDelivery.mockResolvedValue({ item: { ...queueItem, status: 'queued' }, attempts: [], audits: [] });
    const user = await openMail();
    expect(await screen.findByText('queue@example.invalid')).toBeTruthy();
    expect(screen.queryByText('전달 이력이 없습니다.')).toBeNull();
    await user.click(screen.getByRole('button', { name: '전달 상세' }));
    expect(await screen.findByText(/DATA 이후 결과 확인 필요/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '닫기' }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await user.click(screen.getByRole('button', { name: '수동 재시도' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('중복'));
    expect(mocks.retryMailDelivery).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: '수동 재시도' }));
    expect(mocks.retryMailDelivery).toHaveBeenCalledWith('fixture-admin', 'q1', true);
    confirm.mockRestore();
  });

  it('Stage3B API 실패를 빈목록으로 숨기지 않는다', async () => {
    mocks.fetchMailDeliveryQueue.mockRejectedValue(new Error('큐 조회 503'));
    await openMail();
    expect(await screen.findByText(/큐 조회 503/)).toBeTruthy();
    expect(screen.queryByText('전달 이력이 없습니다.')).toBeNull();
  });

  it('Stage3B 명시 provider ID 잠금조작은 test와 active 전환과 분리된다', async () => {
    const provider = { providerId: 'explicit-oci', providerKey: 'oci_email_delivery', active: false, deliveryEnabled: false, relayHost: 'smtp.invalid', relayPort: 587, tlsMode: 'starttls', senderAddress: null, usernameConfigured: false, passwordConfigured: false, dkimDomain: null, dkimSelector: null, dkimPrivateKeyConfigured: false, lastTestStatus: 'success', lastConnectionAt: null, lastConnectionError: null };
    mocks.fetchMailOperations.mockResolvedValue({ domain: null, providers: [provider], queue: {}, feedbackCount: 0, ociSuppression: { activeCount: 0, lastSeenAt: null }, dailySendUsage: { used: 0, limit: 0, unlimited: true, remaining: null, resetAt: queueItem.createdAt } });
    const user = await openMail();
    await user.click(await screen.findByRole('button', { name: '발송 잠금 해제' }));
    expect(mocks.updateMailOperationsProvider).toHaveBeenCalledWith('fixture-admin', 'explicit-oci', { deliveryEnabled: true });
    expect(mocks.testMailOperationsProvider).not.toHaveBeenCalled();
  });
  it('Stage3B 활성 없음 status400이어도 inactive 목록과 정상 큐로 복구할 수 있다', async () => {
    mocks.fetchMailDeliveryStatus.mockRejectedValue(new Error('활성 Provider 없음 400'));
    mocks.fetchMailDeliveryQueue.mockResolvedValue({ items: [queueItem], total: 1 });
    const provider = { providerId: 'recover-oci', providerKey: 'oci_email_delivery', active: false, deliveryEnabled: false, relayHost: 'smtp.invalid', relayPort: 587, tlsMode: 'starttls', senderAddress: null, usernameConfigured: false, passwordConfigured: false, dkimDomain: null, dkimSelector: null, dkimPrivateKeyConfigured: false, lastTestStatus: 'success', lastConnectionAt: null, lastConnectionError: null };
    mocks.fetchMailOperations.mockResolvedValue({ domain: null, providers: [provider], queue: {}, feedbackCount: 0, ociSuppression: { activeCount: 0, lastSeenAt: null }, dailySendUsage: { used: 0, limit: 0, unlimited: true, remaining: null, resetAt: queueItem.createdAt } });
    const user = await openMail();
    expect(await screen.findByText(/활성 Provider 없음 400/)).toBeTruthy();
    expect(await screen.findByText('queue@example.invalid')).toBeTruthy();
    await user.click(await screen.findByRole('button', { name: '발송 잠금 해제' }));
    expect(mocks.updateMailOperationsProvider).toHaveBeenCalledWith('fixture-admin', 'recover-oci', { deliveryEnabled: true });
  });

  it('S3B-PRE-I1 noactive 초기null 미검증 잠김 후보의 명시 연결→수동해제가 가능하다', async () => {
    mocks.fetchMailDeliveryStatus.mockRejectedValue(new Error('활성 Provider 없음 400'));
    mocks.fetchMailDeliveryQueue.mockResolvedValue({ items: [queueItem], total: 1 });
    let provider = { providerId: 'untested-oci', providerKey: 'oci_email_delivery', active: false, deliveryEnabled: false, relayHost: 'smtp.invalid', relayPort: 587, tlsMode: 'starttls', senderAddress: null, usernameConfigured: false, passwordConfigured: false, dkimDomain: null, dkimSelector: null, dkimPrivateKeyConfigured: false, lastTestStatus: 'untested', lastConnectionAt: null, lastConnectionError: null };
    mocks.fetchMailOperations.mockImplementation(async () => ({ domain: null, providers: [provider], queue: {}, feedbackCount: 0, ociSuppression: { activeCount: 0, lastSeenAt: null }, dailySendUsage: { used: 0, limit: 0, unlimited: true, remaining: null, resetAt: queueItem.createdAt } }));
    mocks.testMailOperationsProvider.mockImplementation(async () => { provider = { ...provider, lastTestStatus: 'success' }; return provider; });
    const user = await openMail();
    const unlock = await screen.findByRole('button', { name: '발송 잠금 해제' });
    expect((unlock as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: '연결 검증 (메일 미전송)' }));
    expect(mocks.testMailOperationsProvider).toHaveBeenCalledWith('fixture-admin', 'untested-oci', expect.any(String));
    expect(mocks.updateMailOperationsProvider).not.toHaveBeenCalled();
    await waitFor(() => expect((screen.getByRole('button', { name: '발송 잠금 해제' }) as HTMLButtonElement).disabled).toBe(false));
    await user.click(screen.getByRole('button', { name: '발송 잠금 해제' }));
    expect(mocks.updateMailOperationsProvider).toHaveBeenCalledWith('fixture-admin', 'untested-oci', { deliveryEnabled: true });
    expect(await screen.findByText('queue@example.invalid')).toBeTruthy();
    expect(screen.getByText(/활성 Provider 없음 400/)).toBeTruthy();
  });

  it('operations 실패여도 정상 queue/status를 표시하고 오류를 남긴다', async () => {
    mocks.fetchMailOperations.mockRejectedValue(new Error('운영 설정 503'));
    mocks.fetchMailDeliveryQueue.mockResolvedValue({ items: [queueItem], total: 1 });
    await openMail();
    expect(await screen.findByText('queue@example.invalid')).toBeTruthy();
    expect(screen.getByText(/worker: idle/)).toBeTruthy();
    expect(screen.getByText(/Provider 설정 조회 실패: 운영 설정 503/)).toBeTruthy();
  });

  it('queue 실패여도 정상 operations/status를 버리지 않는다', async () => {
    mocks.fetchMailDeliveryQueue.mockRejectedValue(new Error('큐 503'));
    await openMail();
    expect(await screen.findByText('Provider 설정이 없습니다.')).toBeTruthy();
    expect(screen.getByText(/worker: idle/)).toBeTruthy();
    expect(screen.getByText(/전달 큐 조회 실패: 큐 503/)).toBeTruthy();
    expect(screen.queryByText('전달 이력이 없습니다.')).toBeNull();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
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
    mocks.fetchDirectory.mockReset();
    mocks.testRelay.mockReset();
    mocks.fetchMailDeliveryStatus.mockReset().mockResolvedValue({ provider: { providerType: "oci_email_delivery" }, worker: { status: 'idle' }, summary: {} });
    mocks.fetchMailDeliveryQueue.mockReset().mockResolvedValue({ items: [], total: 0 });
    mocks.fetchMailDeliveryDetail.mockReset();
    mocks.retryMailDelivery.mockReset();
    mocks.updateMailOperationsProvider.mockReset();
    mocks.testMailOperationsProvider.mockReset();
    mocks.fetchDirectory.mockResolvedValue({ company: { name: "MoaWorks", domain: "moaworks.invalid" }, users: [], departments: [], roles: [], mailProvider: null });
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

  it.each([false, true])("Relay 기본 선택은 서버 정책을 사용하고 null provider에서는 요청하지 않는다: active=%s", async (active) => {
    mocks.fetchDirectory.mockResolvedValue({ company: { name: "MoaWorks", domain: "moaworks.invalid" }, users: [], departments: [], roles: [], mailProvider: active ? { id: "stale-display-provider" } : null });
    mocks.login.mockResolvedValue({ nextAction: "authenticated", accessToken: "verified-admin-token", tokenType: "bearer", expiresIn: 3600, user: {} });
    mocks.testRelay.mockResolvedValue({ providerConfigId: "current-provider", status: "success" });
    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByLabelText(/관리자 아이디/), "admin");
    await user.type(screen.getByLabelText("비밀번호"), "fixture-password");
    await user.click(screen.getByRole("button", { name: "로그인" }));
    await user.click((await screen.findAllByRole("button", { name: "서비스 운영" }))[0]);
    await user.click(await screen.findByRole("button", { name: "Relay 테스트 실행" }));
    const submit = screen.getByRole("button", { name: /^Relay 테스트$/ }) as HTMLButtonElement;
    if (!active) {
      expect(submit.disabled).toBe(true);
      expect(screen.getByText(/활성 발송 Provider가 없거나 중복되었습니다/)).toBeTruthy();
      await user.click(submit);
      expect(mocks.testRelay).not.toHaveBeenCalled();
    } else {
      await user.clear(screen.getByLabelText("테스트 수신자"));
      await user.type(screen.getByLabelText("테스트 수신자"), "qa@example.test");
      await user.click(submit);
      await waitFor(() => expect(mocks.testRelay).toHaveBeenCalledWith("verified-admin-token", { testRecipient: "qa@example.test" }));
    }
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
