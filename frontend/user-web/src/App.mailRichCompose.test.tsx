// @vitest-environment jsdom
import type { JSONContent } from "@tiptap/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as app from "./App";
import { updateMailDraft } from "./api";
import type { MailExternalDeliveryStatus } from "./api";
import * as outgoingTranslation from "./mailOutgoingTranslation";
import { projectMailDocument } from "./mailRichText";

vi.mock("./MailRichTextEditor", () => ({
  MailRichTextEditor: ({ onChange }: { onChange: (document: JSONContent) => void }) => <>
    <button aria-label="본문" type="button" onClick={() => onChange({ type: "doc", content: [{ type: "paragraph" }] })}>본문 이미지 제거</button>
    <button type="button" onClick={() => onChange({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "테스트 본문" }] }] })}>본문 입력</button>
  </>,
}));

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    getUserToken: () => localStorage.getItem("moaworks.userToken"),
    fetchMe: async () => ({ user: { userId: "user-1", companyId: "company-1", userName: "Tester", userEmail: "tester@example.test", roleId: "role-1", roleName: "User", userType: "employee", status: "active", permissions: ["mail:send"], mustChangePassword: false } }),
    fetchUiContract: async () => ({}),
    fetchWorkspacePreferences: async () => ({ locale: "ko", timezone: "Asia/Seoul", startPage: "mail", version: 1 }),
    fetchInbox: async () => mountedLists.inbox,
    fetchSentMail: async () => mountedLists.sent,
    fetchDraftMail: async () => mountedLists.draft,
    fetchScheduledMail: async () => mountedLists.scheduled,
    fetchMailDetail: async (_token: string, mailId: string) => mountedDetailLoader ? mountedDetailLoader(mailId) : mountedDetail,
    markMailRead: async () => ({ mailId: "mail-read", status: "read", isRead: true }),
    fetchMailDeliveryStatus: async () => ({ provider: { enabled: true, lastTestStatus: "success" } }),
    fetchMailBasicPreferences: async () => mountedBasicPreferencesLoader ? mountedBasicPreferencesLoader() : mountedBasicPreferences,
    fetchMailAttachmentPreview: async () => mountedPreviewLoader ? mountedPreviewLoader() : Promise.reject(new Error("preview unavailable")),
    fetchTranslationStatus: async () => ({ available: true, enabled: true, provider: "fixture" }),
    requestTranslation: async (payload: { texts: Array<{ text: string; sourceLocale: string; targetLocale: string }> }) => mountedTranslationLoader
      ? mountedTranslationLoader(payload)
      : ({ requestId: "translation-default", provider: "fixture", providerAvailable: true, fallbackUsed: false, items: payload.texts.map((item) => ({ ...item, originalText: item.text, translatedText: `EN:${item.text}`, provider: "fixture", source: "provider" })), executedAt: "2026-08-26T00:00:00Z" }),
    sendMail: async (...args: Parameters<typeof actual.sendMail>) => {
      mountedSendCalls += 1;
      if (mountedSendFailure) throw new Error("forced send failure");
      return actual.sendMail(...args);
    },
    fetchMailSignatures: async () => ({ enabled: false, position: "body_bottom", defaultSignatureId: null, version: 1, updatedAt: "2026-08-26T00:00:00Z", signatures: [] }),
    fetchMailFolders: async () => ({ folders: [] }),
    fetchMailTags: async () => ({ tags: [] }),
  };
});

const mountedSourceMail = {
  mailId: "mail-source", accountId: "account-1", senderUserId: "user-source", senderEmail: "source@example.test", senderDisplayName: "Source",
  subject: "CID 전달 원문", bodyText: "본문 이미지", bodyHtml: '<p>본문 이미지</p><img src="cid:cid-source@moaworks.invalid" alt="원본">', status: "sent", sentAt: "2026-08-26T00:00:00Z", createdAt: "2026-08-26T00:00:00Z", scheduledAt: null, updatedAt: "2026-08-26T00:00:00Z", retentionExpiresAt: null,
  attachmentCount: 2, canViewReadReceipts: false, effectiveReadPolicy: { blockRemoteImages: false, disableRiskyTags: true }, recipients: [
    { recipientEmail: "recipient@example.test", recipientUserId: null, recipientKind: "to", isRead: null, isStarred: null, receivedAt: null, readAt: null },
  ], externalDeliveries: [],
  attachments: [
    { attachmentId: "attachment-inline", fileName: "source.png", contentType: "image/png", sizeBytes: 4, disposition: "inline", contentId: "cid-source@moaworks.invalid", previewPath: "/mail/preview/source" },
    { attachmentId: "attachment-file", fileName: "source.pdf", contentType: "application/pdf", sizeBytes: 4, disposition: "attachment", contentId: null, previewPath: null },
  ],
};

type MountedMailDetail = Omit<typeof mountedSourceMail, "scheduledAt" | "status" | "externalDeliveries"> & {
  externalDeliveries: MailExternalDeliveryStatus[];
  scheduledAt: string | null;
  status: string;
  sourceAction?: "reply" | "reply_all" | "forward" | null;
  sourceMailId?: string | null;
};
let mountedDetail: MountedMailDetail = mountedSourceMail;
let mountedDetailLoader: ((mailId: string) => Promise<MountedMailDetail>) | null = null;
let mountedPreviewLoader: (() => Promise<Blob>) | null = null;
let mountedTranslationLoader: ((payload: { texts: Array<{ text: string; sourceLocale: string; targetLocale: string }> }) => Promise<Record<string, unknown>>) | null = null;
let mountedSendFailure = false;
let mountedSendCalls = 0;
let mountedDraftFailure = false;
const mountedLists = {
  sent: { mails: [], total: 0, limit: 50, offset: 0, hasMore: false } as { mails: Array<Record<string, unknown>>; total: number; limit: number; offset: number; hasMore: boolean },
  inbox: { mails: [{ mailId: "mail-source", accountId: "account-1", senderEmail: "source@example.test", senderDisplayName: "Source", subject: "CID 전달 원문", previewText: "본문 이미지", status: "sent", isRead: true, isStarred: false, sentAt: "2026-08-26T00:00:00Z", receivedAt: "2026-08-26T00:00:00Z", scheduledAt: null, retentionExpiresAt: null, attachmentCount: 2, category: "primary" }], total: 1, limit: 50, offset: 0, hasMore: false },
  draft: { mails: [], total: 0, limit: 50, offset: 0, hasMore: false } as { mails: Array<Record<string, unknown>>; total: number; limit: number; offset: number; hasMore: boolean },
  scheduled: { mails: [], total: 0, limit: 50, offset: 0, hasMore: false } as { mails: Array<Record<string, unknown>>; total: number; limit: number; offset: number; hasMore: boolean },
};

function createMountedBasicPreferences(senderDisplayMode: "name" | "name_email" | "id" = "name") {
  return { senderDisplayMode, blockRemoteImages: false, disableRiskyTags: true, showRouteCountry: false, includeSpamTrashInSearch: false, showListPreview: true, recipientInputMode: "autocomplete", confirmBeforeSend: false, saveSentCopy: true, readReceiptEnabled: false, editorMode: "html", composeMode: "popup", messageEncoding: "utf-8", draftReminderEnabled: false, senderDisplayName: "Tester", replyToEmail: null, vcardEnabled: false, translationTargetLocale: "en", translationComposeMode: "preview", version: 1, updatedAt: "2026-08-26T00:00:00Z" } as const;
}

let mountedBasicPreferences = createMountedBasicPreferences();
let mountedBasicPreferencesLoader: (() => Promise<ReturnType<typeof createMountedBasicPreferences>>) | null = null;

function mountedJson(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

function installMountedMailFetch() {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.endsWith("/auth/me")) return mountedJson({ user: { userId: "user-1", companyId: "company-1", userName: "Tester", userEmail: "tester@example.test", roleId: "role-1", roleName: "User", userType: "employee", status: "active", permissions: ["mail:send"], mustChangePassword: false } });
    if (url.endsWith("/ui-contract")) return mountedJson({});
    if (url.includes("/workspace/preferences")) return mountedJson({ locale: "ko", timezone: "Asia/Seoul", startPage: "mail", version: 1 });
    if (url.includes("/mail/inbox")) return mountedJson({ mails: [{ mailId: "mail-source", accountId: "account-1", senderEmail: "source@example.test", senderDisplayName: "Source", subject: "CID 전달 원문", previewText: "본문 이미지", status: "sent", isRead: true, isStarred: false, sentAt: "2026-08-26T00:00:00Z", receivedAt: "2026-08-26T00:00:00Z", scheduledAt: null, retentionExpiresAt: null, attachmentCount: 2, category: "primary" }], total: 1, limit: 50, offset: 0, hasMore: false });
    if (url.includes("/mail/sent") || url.includes("/mail/drafts") || url.includes("/mail/scheduled")) return mountedJson({ mails: [], total: 0, limit: 50, offset: 0, hasMore: false });
    if (url.includes("/mail/mail-source")) return mountedJson(mountedSourceMail);
    if (url.includes("/mail/delivery/status")) return mountedJson({ provider: { enabled: true, lastTestStatus: "success" } });
    if (url.includes("/mail/preferences/basic")) {
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body ?? "{}")) as { senderDisplayMode?: "name" | "id" | "name_email" };
        if (body.senderDisplayMode) mountedBasicPreferences = createMountedBasicPreferences(body.senderDisplayMode);
      }
      return mountedJson(mountedBasicPreferences);
    }
    if (url.includes("/mail/signatures")) return mountedJson({ enabled: false, position: "body_bottom", defaultSignatureId: null, version: 1, updatedAt: "2026-08-26T00:00:00Z", signatures: [] });
    if (url.includes("/workspace/personal-ai/providers")) return mountedJson({ providers: [{ provider: "openai", label: "OpenAI", apiKeyRequired: true }] });
    if (url.includes("/workspace/personal-ai/config")) return mountedJson({ provider: "openai", model: "gpt-test", apiKeyConfigured: true, connectionStatus: "ready", lastTestCode: "PERSONAL_AI_CONNECTION_READY", lastTestedAt: "2026-08-28T00:00:00Z", configSource: "personal" });
    if (url.includes("/mail/mail-draft/draft")) return mountedDraftFailure ? mountedJson({ detail: "forced draft failure" }, 500) : mountedJson(mountedDetail);
    if (url.includes("/mail/send")) return mountedSendFailure ? mountedJson({ detail: "forced send failure" }, 500) : mountedJson({ mailId: "mail-outgoing", status: "sent", sentAt: "2026-08-26T00:00:00Z", internalCount: 1, externalCount: 0, queuedCount: 0, blockedCount: 0 });
    return mountedJson({}, 404);
  }));
  return requests;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  mountedDetail = mountedSourceMail;
  mountedDetailLoader = null;
  mountedPreviewLoader = null;
  mountedTranslationLoader = null;
  mountedSendFailure = false;
  mountedSendCalls = 0;
  mountedDraftFailure = false;
  mountedBasicPreferences = createMountedBasicPreferences();
  mountedBasicPreferencesLoader = null;
  mountedLists.inbox = { mails: [{ mailId: "mail-source", accountId: "account-1", senderEmail: "source@example.test", senderDisplayName: "Source", subject: "CID 전달 원문", previewText: "본문 이미지", status: "sent", isRead: true, isStarred: false, sentAt: "2026-08-26T00:00:00Z", receivedAt: "2026-08-26T00:00:00Z", scheduledAt: null, retentionExpiresAt: null, attachmentCount: 2, category: "primary" }], total: 1, limit: 50, offset: 0, hasMore: false };
  mountedLists.draft = { mails: [], total: 0, limit: 50, offset: 0, hasMore: false };
  mountedLists.sent = { mails: [], total: 0, limit: 50, offset: 0, hasMore: false };
  mountedLists.scheduled = { mails: [], total: 0, limit: 50, offset: 0, hasMore: false };
});

it.each([
  ['sent', '상대 SMTP 수락 (수신함 도착 미확인)'],
  ['result_unknown', '결과 확인 필요 (중복 전달 위험, 관리자 확인 필요)'],
  ['queued', '외부 전달 대기'],
  ['blocked', '외부 발송 차단 (관리자 확인 필요)'],
  ['failed', '전달 실패'],
])('Stage3B mounted 사용자 상세 %s를 오류문구와 별도로 표시한다', async (status, expected) => {
  mountedDetail = { ...mountedSourceMail, externalDeliveries: [{ recipientEmail: 'external@example.invalid', recipientKind: 'to', status, attemptCount: 1, nextAttemptAt: null, sentAt: null, lastError: '상태별 상세 안내' }] };
  mountedLists.sent = mountedLists.inbox;
  installMountedMailFetch();
  localStorage.setItem('moaworks.userToken', 'fixture-token');
  vi.resetModules();
  const { default: MountedApp } = await import('./App');
  render(<MountedApp />);
  fireEvent.click(await screen.findByRole('button', { name: /^보낸편지함/ }));
  fireEvent.click(await screen.findByRole('button', { name: /CID 전달 원문/ }));
  expect(await screen.findByText(expected + ' · 상세: 상태별 상세 안내')).toBeTruthy();
  expect(screen.queryByText('전달 완료')).toBeNull();
});

type ComposeContracts = typeof app & {
  createMailComposeForm?: (values: { bodyHtml?: string | null; bodyText?: string; subject?: string }) => {
    bodyDocument: JSONContent;
    bodyHtml: string;
    bodyText: string;
  };
  buildComposeInlineAttachments?: (document: JSONContent, images: Array<{
    origin: "persisted" | "staged";
    uploadId?: string;
    contentId: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    previewPath: string;
    objectUrl: string;
    alt: string;
  }>) => Array<{ uploadId: string; contentId?: string | null }>;
  isMailComposeDirty?: (form: { to: string; cc: string; bcc: string; subject: string; scheduledAt: string; bodyDocument: JSONContent }, attachmentCount: number) => boolean;
  loadMailDetailInlinePreviews?: (input: {
    token: string;
    attachments: Array<{ disposition?: string; contentId?: string | null; previewPath?: string | null }>;
    fetchPreview: (token: string, previewPath: string) => Promise<Blob>;
    createObjectURL: (blob: Blob) => string;
    revokeObjectURL: (url: string) => void;
  }) => { ready: Promise<Record<string, string>>; dispose: () => void };
};

const contracts = app as ComposeContracts;
const outgoingContracts = outgoingTranslation as typeof outgoingTranslation & {
  createOutgoingRichTranslationPlan?: (input: {
    subject: string;
    bodyDocument: JSONContent;
    targetLocale: string;
    extractSegments: (document: JSONContent) => { segments: Array<{ id: string; text: string }> };
  }) => { texts: Array<{ text: string }>; sourceSnapshot: { subject: string; documentKey: string }; subjectIncluded: boolean; segments: Array<{ id: string; text: string }> };
  createOutgoingRichTranslationPreview?: (plan: { texts: Array<{ text: string }>; sourceSnapshot: { subject: string; documentKey: string }; subjectIncluded: boolean; segments: Array<{ id: string; text: string }> }, response: { fallbackUsed: boolean; items: Array<{ originalText: string; translatedText: string; source: string }> }) => unknown;
  applyOutgoingRichTranslationPreview?: (current: { subject: string; bodyDocument: JSONContent }, preview: unknown, options: { applySegments: (document: JSONContent, segments: Array<{ id: string; text: string }>) => JSONContent; projectDocument: typeof projectMailDocument }) => unknown;
};

const richDocument: JSONContent = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "굵은 링크", marks: [{ type: "bold" }, { type: "link", attrs: { href: "https://example.invalid/guide" } }] }] },
    { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "인용문" }] }] },
    { type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "제목" }] }] }, { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "image", attrs: { contentId: "inline@example.invalid", src: "cid:inline@example.invalid", alt: "원래 위치" } }] }] }] }] },
  ],
};

const emptyDocument: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };

function requireContract<T>(value: T | undefined): T {
  expect(value).toBeTypeOf("function");
  return value as T;
}

describe("메일 rich compose 재작업 계약", () => {
  it("mounted App은 ID preference를 설정 option과 메일 목록·상세에 동일하게 렌더한다", async () => {
    mountedBasicPreferences = createMountedBasicPreferences("id");
    mountedLists.inbox = {
      mails: [{ mailId: "mail-id-mode", accountId: "account-1", senderEmail: "hong.gildong@example.test", senderDisplayName: "홍길동", subject: "ID 표시 메일", previewText: "ID preference 본문", status: "sent", isRead: true, isStarred: false, sentAt: "2026-08-26T00:00:00Z", receivedAt: "2026-08-26T00:00:00Z", scheduledAt: null, retentionExpiresAt: null, attachmentCount: 0, category: "primary" }],
      total: 1,
      limit: 50,
      offset: 0,
      hasMore: false,
    };
    mountedDetail = {
      ...mountedSourceMail,
      mailId: "mail-id-mode",
      senderEmail: "hong.gildong@example.test",
      senderDisplayName: "홍길동",
      subject: "ID 표시 메일",
      bodyText: "ID preference 본문",
      bodyHtml: "<p>ID preference 본문</p>",
      attachmentCount: 0,
      attachments: [],
    };
    installMountedMailFetch();
    localStorage.setItem("moaworks.userToken", "test-token");
    vi.resetModules();
    const { default: MountedApp } = await import("./App");
    render(<MountedApp />);

    fireEvent.click(await screen.findByRole("button", { name: "환경설정" }));
    expect((await screen.findByLabelText("보낸 사람 표시") as HTMLSelectElement).value).toBe("id");
    expect(screen.getByRole("option", { name: "ID(이메일 @ 앞)" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));

    const mailRow = await screen.findByRole("button", { name: /ID 표시 메일/ });
    expect(mailRow.textContent).toContain("hong.gildong");
    expect(mailRow.textContent).not.toContain("홍길동");
    expect(mailRow.textContent).not.toContain("hong.gildong@example.test");
    fireEvent.click(mailRow);

    expect(await screen.findByRole("heading", { name: "ID 표시 메일" })).toBeTruthy();
    const senderTerm = screen.getByText("보낸 사람");
    expect(senderTerm.parentElement?.querySelector("dd")?.textContent).toBe("hong.gildong");
  });

  it("mounted App은 sender mode 선택을 유지하고 저장·재조회 뒤 목록에 즉시 반영한다", async () => {
    const requests = installMountedMailFetch();
    localStorage.setItem("moaworks.userToken", "test-token");
    vi.resetModules();
    const { default: MountedApp } = await import("./App");
    render(<MountedApp />);

    fireEvent.click(await screen.findByRole("button", { name: "환경설정" }));
    const select = await screen.findByLabelText("보낸 사람 표시") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "id" } });
    expect(select.value).toBe("id");
    const save = screen.getByRole("button", { name: /^저장$/ }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);

    await waitFor(() => expect(requests.some(({ url, init }) => url.includes("/mail/preferences/basic") && init?.method === "PUT" && JSON.parse(String(init.body)).senderDisplayMode === "id")).toBe(true));
    expect((await screen.findByLabelText("보낸 사람 표시") as HTMLSelectElement).value).toBe("id");
    fireEvent.click(screen.getByRole("button", { name: /^닫기$/ }));
    expect((await screen.findByRole("button", { name: /CID 전달 원문/ })).textContent).toContain("source");
  });

  it("메일 환경설정은 최신값을 불러오는 동안 sender mode 조작을 막고 응답 뒤 변경을 보존한다", async () => {
    let resolvePreferences!: (value: ReturnType<typeof createMountedBasicPreferences>) => void;
    let delayPreferenceFetch = false;
    mountedBasicPreferencesLoader = () => {
      if (!delayPreferenceFetch) return Promise.resolve(mountedBasicPreferences);
      return new Promise((resolve) => { resolvePreferences = resolve; });
    };
    installMountedMailFetch();
    localStorage.setItem("moaworks.userToken", "test-token");
    vi.resetModules();
    const { default: MountedApp } = await import("./App");
    render(<MountedApp />);

    await screen.findByRole("button", { name: /CID 전달 원문/ });
    fireEvent.click(screen.getByRole("button", { name: "환경설정" }));
    await screen.findByLabelText("보낸 사람 표시");
    fireEvent.click(screen.getByRole("button", { name: /^닫기$/ }));

    delayPreferenceFetch = true;
    fireEvent.click(screen.getByRole("button", { name: "환경설정" }));
    const loadingSelect = await screen.findByLabelText("보낸 사람 표시") as HTMLSelectElement;
    expect(loadingSelect.matches(":disabled")).toBe(true);

    resolvePreferences(createMountedBasicPreferences("name"));
    await waitFor(() => expect(loadingSelect.matches(":disabled")).toBe(false));
    fireEvent.change(loadingSelect, { target: { value: "id" } });
    expect(loadingSelect.value).toBe("id");
    expect((screen.getByRole("button", { name: /^저장$/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("inbox 목록은 자동 상세 응답이 지연되어도 즉시 렌더되고 loading을 해제한다", async () => {
    let resolveDetail!: (value: MountedMailDetail) => void;
    mountedDetailLoader = () => new Promise((resolve) => { resolveDetail = resolve; });
    installMountedMailFetch();
    localStorage.setItem("moaworks.userToken", "test-token");
    vi.resetModules();
    const { default: MountedApp } = await import("./App");
    render(<MountedApp />);

    expect(await screen.findByText("CID 전달 원문")).toBeTruthy();
    await waitFor(() => expect((screen.getByRole("button", { name: "검색" }) as HTMLButtonElement).disabled).toBe(false));
    resolveDetail(mountedDetail);
  });

  it("mounted App의 메신저 다음 AI 채팅 메뉴가 실제 개인 AI 패널을 연다", async () => {
    installMountedMailFetch();
    localStorage.setItem("moaworks.userToken", "test-token");
    vi.resetModules();
    const { default: MountedApp } = await import("./App");
    render(<MountedApp />);

    fireEvent.click(await screen.findByRole("button", { name: /AI 채팅/ }));

    expect(await screen.findByRole("heading", { name: "AI 채팅" })).toBeTruthy();
    const menuLabels = screen.getAllByRole("button").map((button) => button.textContent?.trim() || "");
    const messengerIndex = menuLabels.findIndex((label) => label.startsWith("메신저"));
    const personalAiIndex = menuLabels.findIndex((label) => label.startsWith("AI 채팅"));
    expect(personalAiIndex).toBe(messengerIndex + 1);
  });

  it("persisted inline attachmentId를 staged uploadId로 payload에 넣지 않고 현재 CID의 새 staged 행만 보낸다", () => {
    const buildAttachments = requireContract(contracts.buildComposeInlineAttachments);
    const attachments = buildAttachments(richDocument, [
      { origin: "persisted", contentId: "inline@example.invalid", fileName: "existing.png", contentType: "image/png", sizeBytes: 1, previewPath: "/mail/preview/existing", objectUrl: "blob:existing", alt: "기존" },
      { origin: "staged", uploadId: "upload-new", contentId: "removed@example.invalid", fileName: "removed.png", contentType: "image/png", sizeBytes: 1, previewPath: "/mail/preview/removed", objectUrl: "blob:removed", alt: "삭제됨" },
      { origin: "staged", uploadId: "upload-current", contentId: "inline@example.invalid", fileName: "new.png", contentType: "image/png", sizeBytes: 1, previewPath: "/mail/preview/current", objectUrl: "blob:current", alt: "새 파일" },
    ]);

    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({ uploadId: "upload-current", contentId: "inline@example.invalid", disposition: "inline" });
    expect(attachments.map((item) => item.uploadId)).not.toContain("attachment-existing");
  });

  it("scheduled와 draft 재오픈은 rich HTML의 marks, blockquote, table과 CID 위치를 보존한다", () => {
    const createForm = requireContract(contracts.createMailComposeForm);
    const original = projectMailDocument(richDocument);

    const scheduled = createForm({ subject: "예약", bodyHtml: original.bodyHtml, bodyText: original.bodyText });
    const draft = createForm({ subject: "초안", bodyHtml: original.bodyHtml, bodyText: original.bodyText });

    expect(projectMailDocument(scheduled.bodyDocument)).toEqual(original);
    expect(projectMailDocument(draft.bodyDocument)).toEqual(original);
  });

  it("재오픈 HTML의 blockquote·목록 항목·표 셀에 직접 놓인 텍스트를 보존한다", () => {
    const createForm = requireContract(contracts.createMailComposeForm);
    const reopened = createForm({
      bodyHtml: "<blockquote>직접 인용<p>중간 인용</p>끝 인용</blockquote><ul><li>직접 목록</li></ul><table><tbody><tr><td>직접 셀</td></tr></tbody></table>",
      bodyText: "fallback",
    });

    expect(reopened.bodyText).toContain("직접 인용");
    expect(reopened.bodyText.indexOf("직접 인용")).toBeLessThan(reopened.bodyText.indexOf("중간 인용"));
    expect(reopened.bodyText.indexOf("중간 인용")).toBeLessThan(reopened.bodyText.indexOf("끝 인용"));
    expect(reopened.bodyText).toContain("직접 목록");
    expect(reopened.bodyText).toContain("직접 셀");
  });

  it("draft 재저장은 같은 mail ID의 update payload에 retained attachmentId와 staged uploadId를 분리해 보낸다", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ mailId: "draft-1" }), { status: 200 }));
    vi.stubGlobal("fetch", request);
    try {
      await updateMailDraft("token", "draft-1", {
        to: [], cc: [], bcc: [], subject: "수정", bodyText: "본문", bodyHtml: "<p>본문</p>",
        attachments: [{ uploadId: "a".repeat(32), fileName: "new.txt", contentType: "text/plain", sizeBytes: 1 }],
        scheduledAt: undefined, confirmed: false, composeAction: "new", sourceMailId: undefined, copiedAttachmentIds: [],
        retainedAttachmentIds: ["attachment-persisted"],
      });
      const [url, init] = request.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(String(init.body));
      expect(url).toContain("/mail/draft-1/draft");
      expect(body.retainedAttachmentIds).toEqual(["attachment-persisted"]);
      expect(body.attachments).toEqual([expect.objectContaining({ uploadId: "a".repeat(32) })]);
      expect(body.attachments.map((item: { uploadId: string }) => item.uploadId)).not.toContain("attachment-persisted");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("발신 번역은 source snapshot과 다른 문서에는 적용하지 않고 fallback·원문 불일치·빈 번역을 거부한다", () => {
    const createPlan = requireContract(outgoingContracts.createOutgoingRichTranslationPlan);
    const createPreview = requireContract(outgoingContracts.createOutgoingRichTranslationPreview);
    const applyPreview = requireContract(outgoingContracts.applyOutgoingRichTranslationPreview);
    const extract = (document: JSONContent) => ({ segments: document.content?.[0]?.content?.map((node, index) => ({ id: `p.${index}`, text: node.text ?? "" })) ?? [] });
    const plan = createPlan({ subject: "제목", bodyDocument: richDocument, targetLocale: "en", extractSegments: extract });
    const response = {
      fallbackUsed: false,
      items: plan.texts.map((item) => ({ originalText: item.text, translatedText: `EN:${item.text}`, source: "provider" })),
    };
    const preview = createPreview(plan, response);
    const applySegments = vi.fn((document: JSONContent) => document);

    expect(() => applyPreview({ subject: "제목", bodyDocument: { ...richDocument, content: [...(richDocument.content ?? []), { type: "paragraph", content: [{ type: "text", text: "수정됨" }] }] } }, preview, {
      applySegments,
      projectDocument: projectMailDocument,
    })).toThrow(/변경|일치/u);
    expect(applySegments).not.toHaveBeenCalled();
    expect(() => createPreview(plan, { ...response, fallbackUsed: true })).toThrow();
    expect(() => createPreview(plan, { ...response, items: [{ ...response.items[0], originalText: "다른 원문" }] })).toThrow();
    expect(() => createPreview(plan, { ...response, items: response.items.map((item) => ({ ...item, translatedText: " " })) })).toThrow();
  });

  it("서식·표·CID 이미지 전용 문서도 닫기 전에 dirty로 판정한다", () => {
    const isDirty = requireContract(contracts.isMailComposeDirty);
    const base = { to: "", cc: "", bcc: "", subject: "", scheduledAt: "" };

    expect(isDirty({ ...base, bodyDocument: emptyDocument }, 0)).toBe(false);
    expect(isDirty({ ...base, bodyDocument: richDocument }, 0)).toBe(true);
  });

  it("detail CID preview는 close 뒤 늦게 만든 URL을 즉시 한 번만 revoke하고 살아있는 preview만 노출한다", async () => {
    const loadPreviews = requireContract(contracts.loadMailDetailInlinePreviews);
    let resolveBlob!: (blob: Blob) => void;
    const revoke = vi.fn();
    const loader = loadPreviews({
      token: "token",
      attachments: [{ disposition: "inline", contentId: "inline@example.invalid", previewPath: "/mail/preview/inline" }],
      fetchPreview: () => new Promise<Blob>((resolve) => { resolveBlob = resolve; }),
      createObjectURL: () => "blob:late-preview",
      revokeObjectURL: revoke,
    });

    loader.dispose();
    resolveBlob(new Blob(["image"], { type: "image/png" }));
    await expect(loader.ready).resolves.toEqual({});
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith("blob:late-preview");

    const liveRevoke = vi.fn();
    const live = loadPreviews({
      token: "token",
      attachments: [{ disposition: "inline", contentId: "replacement@example.invalid", previewPath: "/mail/preview/replacement" }],
      fetchPreview: async () => new Blob(["image"], { type: "image/png" }),
      createObjectURL: () => "blob:replacement-preview",
      revokeObjectURL: liveRevoke,
    });
    await expect(live.ready).resolves.toEqual({ "replacement@example.invalid": "blob:replacement-preview" });
    live.dispose(); // document replacement
    live.dispose(); // unmount after replacement must not double-revoke
    expect(liveRevoke).toHaveBeenCalledTimes(1);
  });

  it("mounted App 전달은 재오픈된 CID마다 outgoing attachment/copy를 포함해야 한다", async () => {
    mountedDetail = {
      ...mountedSourceMail,
      attachmentCount: 3,
      attachments: [
        ...mountedSourceMail.attachments,
        { attachmentId: "attachment-inline-unreferenced", fileName: "unused.png", contentType: "image/png", sizeBytes: 4, disposition: "inline", contentId: "cid-unused@moaworks.invalid", previewPath: "/mail/preview/unused" },
      ],
    };
    const requests = installMountedMailFetch();
    localStorage.setItem("moaworks.userToken", "test-token");

    vi.resetModules();
    const { default: MountedApp } = await import("./App");
    render(<MountedApp />);
    await screen.findByRole("button", { name: /CID 전달 원문/ });
    fireEvent.click(screen.getByRole("button", { name: /CID 전달 원문/ }));
    await screen.findByRole("button", { name: "전달" });
    fireEvent.click(screen.getByRole("button", { name: "전달" }));
    fireEvent.change(screen.getByLabelText("mail-compose-to"), { target: { value: "teammate@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "즉시 발송" }));

    await waitFor(() => expect(requests.some((request) => request.url.includes("/mail/send"))).toBe(true));
    const send = requests.find((request) => request.url.includes("/mail/send"));
    const payload = JSON.parse(String(send?.init?.body));
    expect(payload.bodyHtml).toContain("cid:cid-source@moaworks.invalid");
    expect(payload.copiedAttachmentIds).toContain("attachment-inline");
    expect(payload.copiedAttachmentIds).toContain("attachment-file");
    expect(payload.copiedAttachmentIds).not.toContain("attachment-inline-unreferenced");
  });

  it("mounted 파생 scheduled 편집은 source identity와 기존 첨부를 보존한다", async () => {
    mountedDetail = {
      ...mountedSourceMail,
      mailId: "mail-scheduled",
      status: "scheduled",
      subject: "전달 파생 예약",
      sourceAction: "forward",
      sourceMailId: "mail-source",
      scheduledAt: "2026-08-28T09:00:00Z",
    };
    mountedLists.scheduled = { mails: [{ mailId: "mail-scheduled", accountId: "account-1", senderEmail: "tester@example.test", senderDisplayName: "Tester", subject: "전달 파생 예약", previewText: "본문 이미지", status: "scheduled", isRead: true, isStarred: false, sentAt: null, receivedAt: null, scheduledAt: "2026-08-28T09:00:00Z", retentionExpiresAt: null, attachmentCount: 2, category: "primary" }], total: 1, limit: 50, offset: 0, hasMore: false };
    const requests = installMountedMailFetch();
    localStorage.setItem("moaworks.userToken", "test-token");
    vi.resetModules();
    const { default: MountedApp } = await import("./App");
    render(<MountedApp />);

    fireEvent.click(await screen.findByRole("button", { name: /예약메일함/ }));
    fireEvent.click(await screen.findByRole("button", { name: /전달 파생 예약/ }));
    fireEvent.click(await screen.findByRole("button", { name: "예약 수정" }));
    expect(screen.getByText("source.pdf")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "예약 발송" }));

    await waitFor(() => expect(requests.some((request) => request.url.includes("/mail/mail-scheduled/scheduled"))).toBe(true));
    const payload = JSON.parse(String(requests.find((request) => request.url.includes("/mail/mail-scheduled/scheduled"))?.init?.body));
    expect(payload.composeAction).toBe("forward");
    expect(payload.sourceMailId).toBe("mail-source");
    expect(payload.copiedAttachmentIds).toEqual([]);
    expect(payload.retainedAttachmentIds).toEqual(["attachment-inline", "attachment-file"]);
  });

  it("mounted draft 편집은 현재 문서에서 제거한 persisted inline을 retainedAttachmentIds에 남기면 안 된다", async () => {
    mountedDetail = {
      ...mountedSourceMail,
      mailId: "mail-draft",
      status: "draft",
      subject: "CID 초안",
      attachments: [
        { attachmentId: "attachment-inline", fileName: "source.png", contentType: "image/png", sizeBytes: 4, disposition: "inline", contentId: "cid-source@moaworks.invalid", previewPath: "/mail/preview/source" },
        { attachmentId: "attachment-ordinary", fileName: "keep.pdf", contentType: "application/pdf", sizeBytes: 4, disposition: "attachment", contentId: null, previewPath: null },
      ],
    };
    mountedLists.draft = { mails: [{ mailId: "mail-draft", accountId: "account-1", senderEmail: "tester@example.test", senderDisplayName: "Tester", subject: "CID 초안", previewText: "본문 이미지", status: "draft", isRead: true, isStarred: false, sentAt: null, receivedAt: null, scheduledAt: null, retentionExpiresAt: null, attachmentCount: 2, category: "primary" }], total: 1, limit: 50, offset: 0, hasMore: false };
    const requests = installMountedMailFetch();
    localStorage.setItem("moaworks.userToken", "test-token");
    vi.resetModules();
    const { default: MountedApp } = await import("./App");
    render(<MountedApp />);
    fireEvent.click(await screen.findByRole("button", { name: /임시보관함/ }));
    fireEvent.click(await screen.findByRole("button", { name: /CID 초안/ }));
    fireEvent.click(await screen.findByRole("button", { name: "초안 편집" }));
    fireEvent.click(screen.getByRole("button", { name: "본문" }));
    fireEvent.click(screen.getByRole("button", { name: "임시저장" }));

    await waitFor(() => expect(requests.some((request) => request.url.includes("/mail/mail-draft/draft"))).toBe(true));
    const update = requests.find((request) => request.url.includes("/mail/mail-draft/draft"));
    expect(JSON.parse(String(update?.init?.body)).retainedAttachmentIds).not.toContain("attachment-inline");
  });

  it("mounted draft 편집은 사용자가 제거한 persisted 일반 첨부를 retainedAttachmentIds에 남기면 안 된다", async () => {
    mountedDetail = {
      ...mountedSourceMail,
      mailId: "mail-draft",
      status: "draft",
      subject: "일반 첨부 초안",
      attachments: [
        { attachmentId: "attachment-inline", fileName: "source.png", contentType: "image/png", sizeBytes: 4, disposition: "inline", contentId: "cid-source@moaworks.invalid", previewPath: "/mail/preview/source" },
        { attachmentId: "attachment-ordinary", fileName: "keep.pdf", contentType: "application/pdf", sizeBytes: 4, disposition: "attachment", contentId: null, previewPath: null },
      ],
    };
    mountedLists.draft = { mails: [{ mailId: "mail-draft", accountId: "account-1", senderEmail: "tester@example.test", senderDisplayName: "Tester", subject: "일반 첨부 초안", previewText: "본문 이미지", status: "draft", isRead: true, isStarred: false, sentAt: null, receivedAt: null, scheduledAt: null, retentionExpiresAt: null, attachmentCount: 2, category: "primary" }], total: 1, limit: 50, offset: 0, hasMore: false };
    const requests = installMountedMailFetch();
    localStorage.setItem("moaworks.userToken", "test-token");
    vi.resetModules();
    const { default: MountedApp } = await import("./App");
    render(<MountedApp />);
    fireEvent.click(await screen.findByRole("button", { name: /임시보관함/ }));
    fireEvent.click(await screen.findByRole("button", { name: /일반 첨부 초안/ }));
    fireEvent.click(await screen.findByRole("button", { name: "초안 편집" }));
    fireEvent.click(screen.getByRole("button", { name: "keep.pdf 첨부 제거" }));
    fireEvent.click(screen.getByRole("button", { name: "임시저장" }));

    await waitFor(() => expect(requests.some((request) => request.url.includes("/mail/mail-draft/draft"))).toBe(true));
    expect(JSON.parse(String(requests.find((request) => request.url.includes("/mail/mail-draft/draft"))?.init?.body)).retainedAttachmentIds).not.toContain("attachment-ordinary");
  });

  it("mounted reply/forward derived draft는 composeAction과 sourceMailId를 재저장 payload에 보존한다", async () => {
    mountedDetail = {
      ...mountedSourceMail,
      mailId: "mail-draft",
      status: "draft",
      subject: "전달 파생 초안",
      sourceAction: "forward",
      sourceMailId: "mail-source",
      attachments: [],
    };
    mountedLists.draft = { mails: [{ mailId: "mail-draft", accountId: "account-1", senderEmail: "tester@example.test", senderDisplayName: "Tester", subject: "전달 파생 초안", previewText: "본문", status: "draft", isRead: true, isStarred: false, sentAt: null, receivedAt: null, scheduledAt: null, retentionExpiresAt: null, attachmentCount: 0, category: "primary" }], total: 1, limit: 50, offset: 0, hasMore: false };
    const requests = installMountedMailFetch();
    localStorage.setItem("moaworks.userToken", "test-token");
    vi.resetModules();
    const { default: MountedApp } = await import("./App");
    render(<MountedApp />);
    fireEvent.click(await screen.findByRole("button", { name: /임시보관함/ }));
    fireEvent.click(await screen.findByRole("button", { name: /전달 파생 초안/ }));
    fireEvent.click(await screen.findByRole("button", { name: "초안 편집" }));
    fireEvent.click(screen.getByRole("button", { name: "임시저장" }));

    await waitFor(() => expect(requests.some((request) => request.url.includes("/mail/mail-draft/draft"))).toBe(true));
    const payload = JSON.parse(String(requests.find((request) => request.url.includes("/mail/mail-draft/draft"))?.init?.body));
    expect(payload.composeAction).toBe("forward");
    expect(payload.sourceMailId).toBe("mail-source");
  });

  it("mounted retained-inline-only draft는 preview 실패 전에도 같은 ID로 저장한다", async () => {
    mountedDetail = {
      ...mountedSourceMail,
      mailId: "mail-draft",
      status: "draft",
      subject: "",
      bodyText: "",
      bodyHtml: '<img src="cid:cid-source@moaworks.invalid">',
      attachments: [
        { attachmentId: "attachment-inline", fileName: "source.png", contentType: "image/png", sizeBytes: 4, disposition: "inline", contentId: "cid-source@moaworks.invalid", previewPath: "/mail/preview/source" },
      ],
    };
    mountedLists.draft = { mails: [{ mailId: "mail-draft", accountId: "account-1", senderEmail: "tester@example.test", senderDisplayName: "Tester", subject: "첨부만 있는 초안", previewText: "", status: "draft", isRead: true, isStarred: false, sentAt: null, receivedAt: null, scheduledAt: null, retentionExpiresAt: null, attachmentCount: 1, category: "primary" }], total: 1, limit: 50, offset: 0, hasMore: false };
    const requests = installMountedMailFetch();
    localStorage.setItem("moaworks.userToken", "test-token");
    vi.resetModules();
    const { default: MountedApp } = await import("./App");
    render(<MountedApp />);
    fireEvent.click(await screen.findByRole("button", { name: /임시보관함/ }));
    fireEvent.click(await screen.findByRole("button", { name: /첨부만 있는 초안/ }));
    fireEvent.click(await screen.findByRole("button", { name: "초안 편집" }));
    fireEvent.click(screen.getByRole("button", { name: "임시저장" }));

    await waitFor(() => expect(requests.some((request) => request.url.includes("/mail/mail-draft/draft"))).toBe(true));
    const payload = JSON.parse(String(requests.find((request) => request.url.includes("/mail/mail-draft/draft"))?.init?.body));
    expect(payload.retainedAttachmentIds).toEqual(["attachment-inline"]);
  });

  it("mounted App은 작성 내용이 바뀐 뒤 도착한 번역 응답을 적용하지 않는다", async () => {
    let resolveTranslation!: (value: Record<string, unknown>) => void;
    let requestedTexts: Array<{ text: string; sourceLocale: string; targetLocale: string }> = [];
    mountedTranslationLoader = (payload) => {
      requestedTexts = payload.texts;
      return new Promise((resolve) => { resolveTranslation = resolve; });
    };
    const requests = installMountedMailFetch();
    localStorage.setItem("moaworks.userToken", "test-token");
    vi.resetModules();
    const { default: MountedApp } = await import("./App");
    render(<MountedApp />);
    fireEvent.click(await screen.findByRole("button", { name: "메일 작성" }));
    const subject = screen.getByLabelText("mail-compose-subject");
    fireEvent.change(subject, { target: { value: "번역 원문" } });
    fireEvent.click(await screen.findByRole("button", { name: "번역 미리보기" }));
    fireEvent.change(subject, { target: { value: "사용자가 수정한 제목" } });
    resolveTranslation({ requestId: "translation-stale", provider: "fixture", providerAvailable: true, fallbackUsed: false, items: requestedTexts.map((item) => ({ ...item, originalText: item.text, translatedText: `EN:${item.text}`, provider: "fixture", source: "provider" })), executedAt: "2026-08-26T00:00:00Z" });
    await screen.findByRole("button", { name: "번역 적용" });
    fireEvent.click(screen.getByRole("button", { name: "번역 적용" }));

    expect((screen.getByLabelText("mail-compose-subject") as HTMLInputElement).value).toBe("사용자가 수정한 제목");
    const alerts = await screen.findAllByRole("alert");
    expect(alerts.some((alert) => alert.textContent?.includes("번역 미리보기 뒤 원문이 변경되었습니다."))).toBe(true);
  });

  it("mounted App은 늦게 끝난 이전 상세 조회로 현재 선택을 덮어쓰지 않는다", async () => {
    const oldDetail = { ...mountedSourceMail, mailId: "mail-old", subject: "이전 메일" };
    const newDetail = { ...mountedSourceMail, mailId: "mail-new", subject: "현재 메일" };
    let resolveOld!: (value: typeof mountedSourceMail) => void;
    let resolveNew!: (value: typeof mountedSourceMail) => void;
    mountedLists.inbox = {
      mails: [
        { ...mountedLists.inbox.mails[0], mailId: "mail-old", subject: "이전 메일" },
        { ...mountedLists.inbox.mails[0], mailId: "mail-new", subject: "현재 메일" },
      ], total: 2, limit: 50, offset: 0, hasMore: false,
    };
    mountedDetailLoader = (mailId) => new Promise((resolve) => {
      if (mailId === "mail-old") resolveOld = resolve;
      else resolveNew = resolve;
    });
    installMountedMailFetch();
    localStorage.setItem("moaworks.userToken", "test-token");
    vi.resetModules();
    const { default: MountedApp } = await import("./App");
    render(<MountedApp />);
    fireEvent.click(await screen.findByRole("button", { name: /이전 메일/ }));
    await waitFor(() => expect(resolveOld).toBeTypeOf("function"));
    const currentSubjects = await screen.findAllByText("현재 메일");
    const currentRowButton = currentSubjects.map((element) => element.closest("button.user-mail-row__main")).find(Boolean);
    expect(currentRowButton).toBeTruthy();
    fireEvent.click(currentRowButton as HTMLButtonElement);
    await waitFor(() => expect(resolveNew).toBeTypeOf("function"));
    resolveNew(newDetail);
    await screen.findByRole("heading", { name: "현재 메일" });
    resolveOld(oldDetail);
    await Promise.resolve();

    expect(screen.getByRole("heading", { name: "현재 메일" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "이전 메일" })).toBeNull();
  });

  it("mounted App은 발송 실패 시 작성 폼을 닫거나 초기화하지 않는다", async () => {
    mountedSendFailure = true;
    installMountedMailFetch();
    localStorage.setItem("moaworks.userToken", "test-token");
    vi.resetModules();
    const { default: MountedApp } = await import("./App");
    render(<MountedApp />);
    fireEvent.click(await screen.findByRole("button", { name: "메일 작성" }));
    fireEvent.change(screen.getByLabelText("mail-compose-to"), { target: { value: "teammate@example.test" } });
    fireEvent.change(screen.getByLabelText("mail-compose-subject"), { target: { value: "실패 후 보존" } });
    fireEvent.click(screen.getByRole("button", { name: "본문 입력" }));
    fireEvent.click(screen.getByRole("button", { name: "즉시 발송" }));

    await waitFor(() => expect(mountedSendCalls).toBe(1));
    expect((screen.getByLabelText("mail-compose-to") as HTMLInputElement).value).toBe("teammate@example.test");
    expect((screen.getByLabelText("mail-compose-subject") as HTMLInputElement).value).toBe("실패 후 보존");
    expect(screen.getByRole("heading", { name: "새 메일" })).toBeTruthy();
  });

  it("mounted App은 draft 저장 실패 시 persisted blob과 편집 상태를 유지한다", async () => {
    mountedDraftFailure = true;
    mountedPreviewLoader = async () => new Blob(["image"], { type: "image/png" });
    const revoke = vi.fn();
    const NativeURL = URL;
    vi.stubGlobal("URL", Object.assign(class extends NativeURL {}, { createObjectURL: vi.fn(() => "blob:persisted-inline"), revokeObjectURL: revoke }));
    mountedDetail = { ...mountedSourceMail, mailId: "mail-draft", status: "draft", subject: "저장 실패 보존" };
    mountedLists.draft = { mails: [{ mailId: "mail-draft", accountId: "account-1", senderEmail: "tester@example.test", senderDisplayName: "Tester", subject: "저장 실패 보존", previewText: "본문", status: "draft", isRead: true, isStarred: false, sentAt: null, receivedAt: null, scheduledAt: null, retentionExpiresAt: null, attachmentCount: 2, category: "primary" }], total: 1, limit: 50, offset: 0, hasMore: false };
    const requests = installMountedMailFetch();
    localStorage.setItem("moaworks.userToken", "test-token");
    vi.resetModules();
    const { default: MountedApp } = await import("./App");
    render(<MountedApp />);
    fireEvent.click(await screen.findByRole("button", { name: /임시보관함/ }));
    fireEvent.click(await screen.findByRole("button", { name: /저장 실패 보존/ }));
    fireEvent.click(await screen.findByRole("button", { name: "초안 편집" }));
    fireEvent.click(screen.getByRole("button", { name: "임시저장" }));

    await waitFor(() => expect(requests.some((request) => request.url.includes("/mail/mail-draft/draft"))).toBe(true));
    expect((screen.getByLabelText("mail-compose-subject") as HTMLInputElement).value).toBe("저장 실패 보존");
    expect(screen.getByRole("heading", { name: "새 메일" })).toBeTruthy();
    expect(revoke).not.toHaveBeenCalled();
  });
});
