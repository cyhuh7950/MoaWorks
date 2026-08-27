import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSONContent } from "@tiptap/core";

import {
  ackNotification,
  bulkDeleteMailSignatures,
  createMailSignature,
  deleteMailSignature,
  fetchMailSignatures,
  updateMailSignature,
  updateMailSignaturePreferences,
  bulkMailAction,
  readAllNotifications,
  apiBase,
  approveApproval,
  changePassword,
  ApiRequestError,
  clearUserToken,
  createMailFolder,
  createMailTag,
  deleteMailFolder,
  deleteMailTag,
  deleteMessengerRoom,
  downloadMailAttachment,
  downloadApprovalAttachment,
  downloadMailboxBackup,
  createApproval,
  createApprovalDelegation,
  createMailboxBackup,
  createSpamRule,
  createAutoClassificationRule,
  createAutoForwardException,
  createAutoForwardTargets,
  deleteAutoClassificationRule,
  deleteAutoClassificationRules,
  fetchAutoClassificationSettings,
  fetchAutoForwardSettings,
  fetchOutOfOfficeSettings,
  reorderAutoClassificationRules,
  updateAutoClassificationRule,
  updateAutoClassificationSettings,
  updateAutoForwardException,
  updateAutoForwardSettings,
  updateOutOfOfficeSettings,
  fetchExternalMailAccounts,
  createExternalMailAccount,
  updateExternalMailAccount,
  deleteExternalMailAccount,
  bulkDeleteExternalMailAccounts,
  testExternalMailAccount,
  collectExternalMailAccount,
  deleteAutoForwardExceptions,
  deleteAutoForwardTargets,
  deleteApprovalDelegation,
  deleteApprovalDocument,
  restoreApprovalDocument,
  permanentlyDeleteApprovalDocument,
  markApprovalRead,
  fetchApprovalApprovers,
  fetchApprovalBasicPreferences,
  fetchApprovalDelegations,
  fetchApprovalInlineImage,
  fetchContacts,
  fetchApprovalLogs,
  fetchApprovalDetail,
  fetchApprovals,
  fetchDraftMail,
  fetchInbox,
  fetchMailDeliveryStatus,
  fetchMailFolderMessages,
  fetchMailFolders,
  fetchMailSpam,
  fetchMailTagMessages,
  fetchMailTags,
  fetchMailTrash,
  fetchMailDetail,
  fetchMailInlinePreview,
  fetchRecentMailRecipients,
  fetchRecentMailRecipientSettings,
  deleteRecentMailRecipient,
  bulkDeleteRecentMailRecipients,
  fetchMailStorage,
  fetchMailBasicPreferences,
  fetchMailboxBackups,
  fetchMailboxSettings,
  fetchSpamSettings,
  fetchMe,
  fetchMessengerMessages,
  fetchMessengerRoom,
  fetchMessengerRooms,
  fetchSchedules,
  fetchNotifications,
  fetchNotificationStream,
  fetchNotificationSummary,
  fetchSentMail,
  fetchScheduledMail,
  updateMailDraft,
  updateScheduledMail,
  cancelScheduledMail,
  sendScheduledMailNow,
  retryScheduledMail,
  fetchWorkspaceDirectory,
  fetchWorkspaceFiles,
  fetchWorkspaceNotice,
  fetchWorkspaceNotices,
  fetchWorkspacePreferences,
  fetchWorkspaceProfile,
  fetchWorkspaceProfilePhoto,
  fetchTranslationStatus,
  fetchUiContract,
  getUserToken,
  login,
  leaveMessengerRoom,
  markMailRead,
  readMessengerRoom,
  readWorkspaceNotice,
  redraftApproval,
  uploadApprovalAttachment,
  uploadMailAttachment,
  rejectApproval,
  requestTranslation,
  saveMailDraft,
  sendMail,
  resetMailBasicPreferences,
  retryMailboxBackup,
  deleteSpamRule,
  sendMessengerMessage,
  storeUserToken,
  submitApproval,
  toggleMailStar,
  transferMessengerRoomOwner,
  updateMailBasicPreferences,
  updateMailboxPolicy,
  updateSpamRule,
  updateSpamSettings,
  emptyMailbox,
  setMailCategory,
  updateApproval,
  updateApprovalBasicPreferences,
  updateApprovalDelegation,
  updateMailFolder,
  updateMailTag,
  type MailAttachment,
  type MailAttachmentView,
  withdrawApproval,
  type ApprovalApprover,
  type ApprovalBasicPreferences,
  type ApprovalDelegation,
  type ApprovalAttachment,
  type MailRecentRecipient,
  type MailRecentRecipientSettingsResponse,
  type ApprovalDocument,
  type ApprovalDocumentDetail,
  type AuditLog,
  type AuthUser,
  type LoginResponse,
  type MailDeliveryStatusResponse,
  type MailDetail,
  type MailListQuery,
  type MailSignature,
  type MailSignaturePreferences,
  type MailFolder,
  type MailTag,
  type MailStorageResponse,
  type MailBasicPreferences,
  type MailBackupJob,
  type MailboxSettingsRow,
  type MailMailboxSettingsResponse,
  type MailSpamRule,
  type MailSpamRulePayload,
  type MailSpamSettingsResponse,
  type MailAutoClassificationCondition,
  type MailAutoClassificationRule,
  type MailAutoClassificationRulePayload,
  type MailAutoClassificationSettings,
  type MailAutoForwardException,
  type MailAutoForwardExceptionPayload,
  type MailAutoForwardSettings,
  type MailOutOfOfficeSettings,
  type MailExternalAccount,
  type MailExternalAccountList,
  type MailExternalAccountPayload,
  type MailSummary,
  type MessengerMessage,
  type MessengerRoomDetail,
  type MessengerRoomSummary,
  type NotificationRecord,
  type NotificationSummary,
  type TranslationItem,
  type TranslationRequest,
  type WorkspaceContact,
  type WorkspaceDirectory,
  type TranslationResponse,
  type UiContract as ServerUiContract,
  type WorkspaceNotice,
  type WorkspaceProfile,
  type WorkspaceSchedule,
} from "./api";
import { resolveLocale, supportedLocales, supportedTimezones, type AppLocale } from "./i18n";
import { MessengerPanel } from "./MessengerPanel";
import { WorkspacePanels } from "./WorkspacePanels";
import { SplitView } from "./SplitView";
import { NotificationCenter } from "./NotificationCenter";
import { UserHome } from "./UserHome";
import { CompactWarning, ConfirmModal, FeedbackState, ToastViewport, useFeedbackQueue } from "./components/FeedbackSystem";
import { CommonPopup } from "./components/CommonPopup";
import {
  applyOutgoingRichTranslationPreview,
  createOutgoingRichTranslationPlan,
  createOutgoingRichTranslationPreview,
  normalizeOutgoingTranslationLocale,
  OUTGOING_TRANSLATION_LOCALES,
} from "./mailOutgoingTranslation";
import { MailRichTextEditor } from "./MailRichTextEditor";
import type { InlineImageDraft } from "./mailInlineImages";
import {
  applyTranslatedSegments,
  extractTranslationSegments,
  projectMailDocument,
} from "./mailRichText";

type MessengerRoomLifecycleAction = "none" | "transfer" | "leave" | "delete";
import {
  classifyApprovalDocuments,
  findApprovalDocumentMenu,
  resolveApprovalPostActionTarget,
  type ApprovalActualMenuKey,
  type ApprovalPostAction,
} from "./approvalShell";
import { approvalLineStatusLabel, approvalStatusLabel, filterApprovalDocuments, resolveApprovalSelection } from "./approvalDetail";
import { buildApprovalComposeSnapshot, moveApprovalApprover as moveApprovalApproverOrder, validateApprovalDraft, validateApprovalFiles } from "./approvalCompose";
import { APPROVAL_ACTION_CONFIG, buildApprovalActionTarget, validateApprovalActionOpinion, type ApprovalActionTarget, type ApprovalActionType } from "./approvalAction";
import {
  APPROVAL_ATTACHMENT_IMAGE_DISPLAYS,
  APPROVAL_WRITING_METHODS,
  buildApprovalPreferenceSnapshot,
  shouldPreviewApprovalAttachment,
  type ApprovalAttachmentImageDisplay,
  type ApprovalPreferenceDraft,
} from "./approvalPreferences";
import {
  APPROVAL_DELEGATION_STATUS_LABELS,
  buildApprovalDelegationSnapshot,
  validateApprovalDelegation,
  type ApprovalDelegationDraft,
} from "./approvalDelegation";

const NOTIFICATION_POLICY = {
  retryMaxAttempts: 3,
  retryDelayMs: 400,
  streamRetryMax: 2,
  streamReconnectDelayMs: 600,
} as const;

const MAIL_POLICY = {
  serverRetention: "서버 1개월 보관",
  localRetention: "설치형 PC 로컬 아카이브 무기한",
};

const MAIL_CATEGORIES = [
  ["primary", "기본"],
  ["promotions", "프로모션"],
  ["social", "소셜"],
  ["updates", "업데이트"],
  ["forums", "포럼"],
] as const;

type ApprovalShellMenuKey = ApprovalActualMenuKey | "settings";

function seoulDateInputValue(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function emptyApprovalDelegationDraft(): ApprovalDelegationDraft {
  const today = seoulDateInputValue();
  return { delegateUserId: "", startDate: today, endDate: today, reason: "", enabled: true };
}

type ApprovalShellMenuItem = {
  key: ApprovalShellMenuKey;
  label: string;
  description: string;
  group: "work" | "library" | "footer";
  readyMessage?: string;
};

const APPROVAL_SHELL_MENU_ITEMS: ApprovalShellMenuItem[] = [
  { key: "pending", label: "결재 대기", description: "지금 내가 처리할 순번인 문서", group: "work" },
  { key: "received", label: "수신", description: "내 결재 처리가 끝난 문서", group: "work" },
  { key: "reference", label: "참조·열람 대기", description: "내가 참조 또는 열람할 문서", group: "work" },
  { key: "scheduled", label: "예정", description: "내 결재 순번을 기다리는 문서", group: "work" },
  { key: "personal", label: "개인 문서함", description: "내가 작성한 결재 문서", group: "library" },
  { key: "department", label: "부서 문서함", description: "부서에 공유된 완료 문서", group: "library" },
  { key: "trash", label: "휴지통", description: "내가 삭제한 결재 문서", group: "library" },
  {
    key: "settings",
    label: "환경설정",
    description: "결재 작성·부재·위임 설정",
    group: "footer",
  },
];

function isApprovalActualMenuKey(key: ApprovalShellMenuKey): key is ApprovalActualMenuKey {
  return key !== "settings";
}

const DEFAULT_MAIL_LIST_QUERY: MailListQuery = {
  q: "",
  read: "all",
  starred: "all",
  attachment: "all",
  category: "primary",
  sort: "date_desc",
  limit: 50,
  offset: 0,
};

const MESSENGER_POLICY = {
  serverRetention: "서버 2주 보관",
  localRetention: "설치형 PC 대화 파일(JSON/HTML) 보관",
};

type UiContract = {
  brand: {
    primary: string;
    secondary: string;
    accent: string;
    blocked: string;
  };
  company: {
    name: string;
    domain: string;
    logoDataUrl: string;
  };
  menuOrder: string[];
  homeCardOrder: string[];
  quickComposeVisible: boolean;
  helpText: string;
  messages: {
    error: string;
    warning: string;
    blocked: string;
    empty: string;
    success: string;
    sessionExpired: string;
    permissionDenied: string;
  };
};

function resolveDefaultCompanyDomain(): string {
  const hostname = typeof window === "undefined" ? "" : window.location.hostname.trim().toLowerCase();
  return hostname === "moaworks.sinsan.kr" || hostname.endsWith(".moaworks.sinsan.kr") ? "moaworks.sinsan.kr" : "moaworks.local";
}

const defaultUiContract: UiContract = {
  brand: {
    primary: "#0f766e",
    secondary: "#111827",
    accent: "#9a6b2f",
    blocked: "#9f1239",
  },
  company: {
    name: "MoaWorks",
    domain: resolveDefaultCompanyDomain(),
    logoDataUrl: "",
  },
  menuOrder: ["메일", "결재", "메신저", "일정", "주소록", "조직도", "파일", "설정"],
  homeCardOrder: ["alerts", "approval", "mail", "messenger"],
  quickComposeVisible: true,
  helpText: "Help / 정책 안내 / 설정 > 보관 정책",
  messages: {
    error: "요청 처리 중 오류가 발생했습니다. 다시 시도해 주세요.",
    warning: "설치형 로컬 아카이브 연결을 확인하세요.",
    blocked: "접근 권한이 없거나 세션이 만료되었습니다.",
    empty: "표시할 메일이 없습니다.",
    success: "결재 초안이 저장되었습니다.",
    sessionExpired: "세션이 만료되어 다시 로그인해야 합니다.",
    permissionDenied: "공유 메일함을 열 권한이 없습니다.",
  },
};

function buildCompanyInitials(name: string): string {
  const cleaned = name.replace(/[^0-9A-Za-z가-힣]/g, "").trim();
  if (!cleaned) return "MW";
  return Array.from(cleaned).slice(0, 2).join("").toUpperCase();
}

function buildDefaultCompanyLogo(name: string, primary: string, secondary: string): string {
  const initials = buildCompanyInitials(name);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 192 192" role="img" aria-label="${name} logo">
      <defs>
        <linearGradient id="portalLogoBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${primary}" />
          <stop offset="100%" stop-color="${secondary}" />
        </linearGradient>
      </defs>
      <rect width="192" height="192" rx="44" fill="url(#portalLogoBg)" />
      <circle cx="148" cy="48" r="20" fill="rgba(255,255,255,0.14)" />
      <text x="96" y="108" text-anchor="middle" font-family="Segoe UI, Noto Sans KR, sans-serif" font-size="64" font-weight="800" fill="#ffffff">${initials}</text>
    </svg>
  `;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function mergeUiContract(raw: Partial<UiContract> | null | undefined): UiContract {
  const brand = {
    ...defaultUiContract.brand,
    ...(raw?.brand ?? {}),
  };
  const company = {
    ...defaultUiContract.company,
    ...(raw?.company ?? {}),
  };
  return {
    brand,
    company: {
      name: company.name?.trim() || defaultUiContract.company.name,
      domain: company.domain?.trim() || defaultUiContract.company.domain,
      logoDataUrl: company.logoDataUrl?.trim() || buildDefaultCompanyLogo(company.name || defaultUiContract.company.name, brand.primary, brand.secondary),
    },
    menuOrder: raw?.menuOrder?.length ? raw.menuOrder : defaultUiContract.menuOrder,
    homeCardOrder: raw?.homeCardOrder?.length ? raw.homeCardOrder : defaultUiContract.homeCardOrder,
    quickComposeVisible: raw?.quickComposeVisible ?? defaultUiContract.quickComposeVisible,
    helpText: raw?.helpText || defaultUiContract.helpText,
    messages: {
      ...defaultUiContract.messages,
      ...(raw?.messages ?? {}),
    },
  };
}

type LoginForm = {
  loginId: string;
  password: string;
};

type CreateForm = {
  title: string;
  content: string;
  approverUserIds: string[];
  referenceUserIds: string[];
  viewerUserIds: string[];
  urgent: boolean;
  shareWithDepartment: boolean;
};

type ApprovalPendingFile = {
  id: string;
  file: File;
};

type ApprovalModalMode = "none" | "create" | "edit" | "submit" | "approve" | "reject" | "withdraw" | "redraft";

type PasswordChangeForm = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

type MailComposeForm = {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  bodyDocument: JSONContent;
  scheduledAt: string;
};

type MailComposeFile = {
  id: string;
  file: File;
};

type MailComposeInlineImage = Omit<InlineImageDraft, "uploadId"> & {
  origin: "staged" | "persisted";
  uploadId?: string;
};

type RecipientPickerTarget = "to" | "cc" | "bcc";
type RecipientPickerSource = "contact" | "directory" | "recent";

type RecipientSuggestion = {
  email: string;
  name: string;
  detail: string;
  source: "recent" | "directory" | "contact";
};

const MAIL_ATTACHMENT_LIMITS = {
  maxFiles: 10,
  maxFileBytes: 10 * 1024 * 1024,
  maxTotalBytes: 25 * 1024 * 1024,
};

export function createMailDocument(bodyText = "", inlineImages: Array<{ contentId: string; alt: string }> = []): JSONContent {
  const paragraphs = bodyText.replace(/\r\n?/g, "\n").split("\n").map((line) => (
    line ? { type: "paragraph", content: [{ type: "text", text: line }] } : { type: "paragraph" }
  ));
  return {
    type: "doc",
    content: [...(paragraphs.length ? paragraphs : [{ type: "paragraph" }]), ...inlineImages.map((image) => ({
      type: "image",
      attrs: { contentId: image.contentId, src: `cid:${image.contentId}`, alt: image.alt || "본문 이미지" },
    }))],
  };
}

function parseMailHtmlDocument(bodyHtml: string, fallbackText: string): JSONContent {
  if (typeof DOMParser === "undefined") return createMailDocument(fallbackText);
  const readStyle = (element: Element) => Object.fromEntries((element.getAttribute("style") ?? "").split(";").map((item) => item.split(":")).filter((item) => item.length === 2).map(([key, value]) => [key.trim(), value.trim()]));
  const marksFor = (element: Element, inherited: JSONContent["marks"] = []) => {
    const tag = element.tagName.toLowerCase();
    const style = readStyle(element);
    const mark = tag === "strong" ? { type: "bold" } : tag === "em" ? { type: "italic" } : tag === "u" ? { type: "underline" } : tag === "s" ? { type: "strike" }
      : tag === "a" && element.getAttribute("href") ? { type: "link", attrs: { href: element.getAttribute("href")! } }
      : style["background-color"] ? { type: "highlight", attrs: { color: style["background-color"] } }
      : style["font-family"] || style["font-size"] || style["line-height"] || style.color ? { type: "textStyle", attrs: { fontFamily: style["font-family"], fontSize: style["font-size"], lineHeight: style["line-height"], color: style.color } } : null;
    return mark ? [mark, ...inherited] : inherited;
  };
  const inline = (node: Node, inherited: JSONContent["marks"] = []): JSONContent[] => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ? [{ type: "text", text: node.textContent, marks: inherited.length ? inherited : undefined }] : [];
    if (!(node instanceof Element)) return [];
    const tag = node.tagName.toLowerCase();
    if (tag === "br") return [{ type: "hardBreak" }];
    if (tag === "img") {
      const src = node.getAttribute("src") ?? "";
      return src.startsWith("cid:") ? [{ type: "image", attrs: { contentId: src.slice(4), src, alt: node.getAttribute("alt") ?? "본문 이미지", width: node.getAttribute("width") ? Number(node.getAttribute("width")) : undefined, height: node.getAttribute("height") ? Number(node.getAttribute("height")) : undefined } }] : [];
    }
    return [...node.childNodes].flatMap((child) => inline(child, marksFor(node, inherited)));
  };
  const blocks = (node: Node): JSONContent[] => {
    if (!(node instanceof Element)) return [];
    const tag = node.tagName.toLowerCase();
    const style = readStyle(node);
    const elementChildren = [...node.children].flatMap(blocks);
    const children = ["blockquote", "li", "th", "td"].includes(tag)
      ? [...node.childNodes].flatMap((child) => {
        if (child instanceof Element) return blocks(child);
        const content = inline(child);
        return content.some((item) => item.type !== "text" || item.text?.trim()) ? [{ type: "paragraph", content }] : [];
      })
      : elementChildren;
    const attrs = style["text-align"] ? { textAlign: style["text-align"] } : undefined;
    if (tag === "p") return [{ type: "paragraph", attrs, content: [...node.childNodes].flatMap((child) => inline(child)) }];
    if (/^h[1-3]$/.test(tag)) return [{ type: "heading", attrs: { level: Number(tag.slice(1)), ...(attrs ?? {}) }, content: [...node.childNodes].flatMap((child) => inline(child)) }];
    if (tag === "blockquote") return [{ type: "blockquote", attrs, content: children.length ? children : [{ type: "paragraph" }] }];
    if (tag === "ul" || tag === "ol") return [{ type: tag === "ul" ? "bulletList" : "orderedList", attrs: tag === "ol" && node.getAttribute("start") ? { start: Number(node.getAttribute("start")) } : undefined, content: children }];
    if (tag === "li") return [{ type: "listItem", content: children.length ? children : [{ type: "paragraph" }] }];
    if (tag === "table") return [{ type: "table", content: children }];
    if (tag === "tr") return [{ type: "tableRow", content: children }];
    if (tag === "th" || tag === "td") return [{ type: tag === "th" ? "tableHeader" : "tableCell", attrs: { ...(node.getAttribute("colspan") ? { colspan: Number(node.getAttribute("colspan")) } : {}), ...(node.getAttribute("rowspan") ? { rowspan: Number(node.getAttribute("rowspan")) } : {}), ...(attrs ?? {}) }, content: children.length ? children : [{ type: "paragraph" }] }];
    if (tag === "hr") return [{ type: "horizontalRule" }];
    if (tag === "img") return inline(node);
    return children.length ? children : inline(node).length ? [{ type: "paragraph", content: inline(node) }] : [];
  };
  const root = new DOMParser().parseFromString(bodyHtml, "text/html").body;
  const content = [...root.children].flatMap(blocks);
  return { type: "doc", content: content.length ? content : createMailDocument(fallbackText).content };
}

export function createMailComposeForm(values: Partial<Omit<MailComposeForm, "bodyHtml" | "bodyDocument" | "bodyText">> & { bodyText?: string; bodyHtml?: string | null } = {}): MailComposeForm {
  const bodyDocument = values.bodyHtml ? parseMailHtmlDocument(values.bodyHtml, values.bodyText ?? "") : createMailDocument(values.bodyText ?? "");
  const projection = projectMailDocument(bodyDocument);
  return {
    to: values.to ?? "",
    cc: values.cc ?? "",
    bcc: values.bcc ?? "",
    subject: values.subject ?? "",
    bodyText: projection.bodyText,
    bodyHtml: projection.bodyHtml,
    bodyDocument,
    scheduledAt: values.scheduledAt ?? "",
  };
}

function createEmptyMailComposeForm(): MailComposeForm {
  return createMailComposeForm();
}

export function buildComposeInlineAttachments(document: JSONContent, images: MailComposeInlineImage[]): Array<Pick<MailAttachment, "uploadId" | "fileName" | "contentType" | "sizeBytes" | "disposition" | "contentId" | "previewPath">> {
  const referenced = new Set(projectMailDocument(document).contentIds);
  return images.filter((image) => image.origin === "staged" && Boolean(image.uploadId) && referenced.has(image.contentId)).map((image) => ({ uploadId: image.uploadId!, fileName: image.fileName, contentType: image.contentType, sizeBytes: image.sizeBytes, disposition: "inline", contentId: image.contentId, previewPath: image.previewPath }));
}

export function isMailComposeDirty(form: Pick<MailComposeForm, "to" | "cc" | "bcc" | "subject" | "scheduledAt" | "bodyDocument">, attachmentCount: number): boolean {
  return Boolean(form.to || form.cc || form.bcc || form.subject || form.scheduledAt || attachmentCount || JSON.stringify(form.bodyDocument) !== JSON.stringify(createEmptyMailComposeForm().bodyDocument));
}

export function loadMailDetailInlinePreviews(input: { token: string; attachments: Array<Pick<MailAttachmentView, "disposition" | "contentId" | "previewPath">>; fetchPreview: (token: string, previewPath: string) => Promise<Blob>; createObjectURL: (blob: Blob) => string; revokeObjectURL: (url: string) => void }) {
  let disposed = false;
  const owned = new Set<string>();
  const ready = Promise.all(input.attachments.filter((item) => item.disposition === "inline" && item.contentId && item.previewPath).map(async (item) => {
    try {
      const url = input.createObjectURL(await input.fetchPreview(input.token, item.previewPath!));
      if (disposed) { input.revokeObjectURL(url); return null; }
      owned.add(url);
      return [item.contentId!, url] as const;
    } catch { return null; }
  })).then((entries) => disposed ? {} : Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => entry !== null)));
  return { ready, dispose: () => { if (disposed) return; disposed = true; for (const url of owned) input.revokeObjectURL(url); owned.clear(); } };
}

type ReasonAction = {
  documentId: string;
  reason: string;
};

type WorkspaceTab = "mail" | "approval" | "messenger";
type UserPortalMenu = "home" | "mail" | "approval" | "messenger" | "schedule" | "contacts" | "org" | "files" | "alerts" | "notices" | "settings" | "help";
type MailboxType = "inbox" | "sent";
type MailFolderType = MailboxType | "starred" | "unread" | "draft" | "scheduled" | "spam" | "trash" | "localArchive" | string;

type MailComposeContext = "new" | "reply" | "reply_all" | "forward";
type MailTrashSource = "inbox" | "sent" | "draft";
const sourceMailboxOptions: MailTrashSource[] = ["inbox", "sent", "draft"];

function mailSelectionKey(item: Pick<MailSummary, "mailId" | "sourceMailbox">, folder: MailFolderType): string {
  if (folder !== "trash") return item.mailId;
  return item.mailId + "::" + (item.sourceMailbox ?? "inbox");
}

function parseTrashSelectionKey(key: string): { mailId: string; sourceMailbox: MailTrashSource } | null {
  const separator = key.lastIndexOf("::");
  if (separator < 1) return null;
  const sourceMailbox = key.slice(separator + 2);
  if (!sourceMailboxOptions.includes(sourceMailbox as MailTrashSource)) return null;
  return { mailId: key.slice(0, separator), sourceMailbox: sourceMailbox as MailTrashSource };
}

export function maskMailReadReceiptAddress(value: string): string {
  const separator = value.indexOf("@");
  return separator > 0 && separator < value.length - 1 ? `${value.slice(0, separator)}***${value.slice(separator)}` : "주소 비공개";
}

function withMailSubjectPrefix(subject: string, mode: MailComposeContext) {
  const prefix = mode === "forward" ? "Fwd:" : "Re:";
  let baseSubject = subject.trim();
  while (/^(re|fwd|fw):\s*/i.test(baseSubject)) {
    baseSubject = baseSubject.replace(/^(re|fwd|fw):\s*/i, "").trimStart();
  }
  return baseSubject ? `${prefix} ${baseSubject}` : prefix;
}

function buildMailReplyRecipients(
  detail: MailDetail,
  actorEmail: string,
  mode: "reply" | "reply_all",
): { to: string[]; cc: string[] } {
  const ownEmail = actorEmail.trim().toLowerCase();
  const visibleRecipients = detail.recipients.filter((item) => item.recipientKind !== "bcc");
  const originalTo = visibleRecipients
    .filter((item) => item.recipientKind === "to")
    .map((item) => item.recipientEmail.trim().toLowerCase());
  const originalCc = visibleRecipients
    .filter((item) => item.recipientKind === "cc")
    .map((item) => item.recipientEmail.trim().toLowerCase());
  const senderEmail = detail.senderEmail.trim().toLowerCase();
  const toCandidates = mode === "reply" ? [senderEmail] : [senderEmail, ...originalTo];
  const to = mode === "reply"
    ? [...new Set(toCandidates.filter(Boolean))]
    : [...new Set(toCandidates.filter((email) => email && email !== ownEmail))];
  const toSet = new Set(to);
  const cc = mode === "reply_all"
    ? [...new Set(originalCc.filter((email) => email && email !== ownEmail && !toSet.has(email)))]
    : [];
  return { to, cc };
}

function buildMailQuotedBody(detail: MailDetail): string {
  const visibleRecipients = detail.recipients.filter((item) => item.recipientKind !== "bcc");
  const to = visibleRecipients
    .filter((item) => item.recipientKind === "to")
    .map((item) => item.recipientEmail)
    .join(", ");
  const cc = visibleRecipients
    .filter((item) => item.recipientKind === "cc")
    .map((item) => item.recipientEmail)
    .join(", ");
  return [
    "",
    "--- 원문 ---",
    `일시: ${formatMailDate(detail.sentAt || detail.createdAt)}`,
    `보낸 사람: ${detail.senderEmail}`,
    `받는 사람: ${to || "-"}`,
    `참조: ${cc || "-"}`,
    `제목: ${detail.subject}`,
    "",
    detail.bodyText,
  ].join("\n");
}

function escapeMailHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sanitizeMailHtml(html: string, allowRemoteImages: boolean, allowedInlineObjectUrls = new Set<string>()): string {
  const documentNode = new DOMParser().parseFromString(html, "text/html");
  documentNode.querySelectorAll("script,iframe,object,embed,form,input,button,meta,link,base,video,audio,source,svg,math").forEach((node) => node.remove());
  documentNode.querySelectorAll("style").forEach((styleElement) => {
    const css = styleElement.textContent || "";
    if (/expression\s*\(|javascript:|behavior\s*:|-moz-binding|@import/i.test(css)) {
      styleElement.remove();
    } else if (!allowRemoteImages) {
      styleElement.textContent = css.replace(/url\s*\([^)]*\)/gi, "none");
    }
  });
  documentNode.querySelectorAll("*").forEach((element) => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || name === "srcdoc" || name === "srcset") {
        element.removeAttribute(attribute.name);
      } else if (name === "style") {
        const style = attribute.value;
        if (/expression\s*\(|javascript:|behavior\s*:|-moz-binding/i.test(style)) {
          element.removeAttribute("style");
        } else if (!allowRemoteImages) {
          element.setAttribute("style", style.replace(/url\s*\([^)]*\)/gi, "none"));
        }
      }
    }
    if (element instanceof HTMLAnchorElement) {
      const href = element.getAttribute("href") || "";
      if (!/^(https?:|mailto:)/i.test(href)) element.removeAttribute("href");
      element.target = "_blank";
      element.rel = "noopener noreferrer";
    }
    if (element instanceof HTMLImageElement) {
      const source = element.getAttribute("src") || "";
      if (allowedInlineObjectUrls.has(source)) {
        return;
      }
      if (!/^(https?:|data:image\/(?:png|gif|jpeg|webp);base64,)/i.test(source)) {
        element.removeAttribute("src");
      } else if (!allowRemoteImages && /^https?:/i.test(source)) {
        element.dataset.remoteSrc = source;
        element.removeAttribute("src");
        element.alt = element.alt ? "[원격 이미지 차단됨] " + element.alt : "[원격 이미지 차단됨]";
      }
    }
  });
  return '<!doctype html><html><head><meta charset="utf-8"><style>' +
    'body{margin:0;padding:12px;color:#0f172a;background:#fff;font:12px/1.6 Arial,sans-serif;overflow-wrap:anywhere}' +
    'img{max-width:100%;height:auto}table{max-width:100%;border-collapse:collapse}a{color:#0f766e}' +
    '</style></head><body>' + documentNode.body.innerHTML + '</body></html>';
}

function replaceMailInlineCids(
  html: string,
  attachments: MailAttachmentView[],
  previewUrls: Record<string, string>,
): string {
  const documentNode = new DOMParser().parseFromString(html, "text/html");
  const allowed = new Set(attachments.filter((attachment) => attachment.disposition === "inline").map((attachment) => attachment.contentId).filter(Boolean));
  documentNode.querySelectorAll("img[src^=\"cid:\"]").forEach((image) => {
    const contentId = image.getAttribute("src")?.slice(4) ?? "";
    const previewUrl = allowed.has(contentId) ? previewUrls[contentId] : undefined;
    if (previewUrl) {
      image.setAttribute("src", previewUrl);
      return;
    }
    const fallback = documentNode.createElement("span");
    fallback.className = "user-mail-inline-image-unavailable";
    fallback.textContent = `[본문 이미지를 표시할 수 없습니다${image.getAttribute("alt") ? `: ${image.getAttribute("alt")}` : ""}]`;
    image.replaceWith(fallback);
  });
  return documentNode.body.innerHTML;
}

function buildForwardMailHtml(detail: MailDetail, bodyText: string): string {
  const note = bodyText.split("\n--- 원문 ---", 1)[0].trim();
  const visibleRecipients = detail.recipients.filter((item) => item.recipientKind !== "bcc");
  const to = visibleRecipients.filter((item) => item.recipientKind === "to").map((item) => item.recipientEmail).join(", ");
  const cc = visibleRecipients.filter((item) => item.recipientKind === "cc").map((item) => item.recipientEmail).join(", ");
  const original = detail.bodyHtml
    ? sanitizeMailHtml(detail.bodyHtml, true).replace(/^.*?<body>/s, "").replace(/<\/body>.*$/s, "")
    : "<pre>" + escapeMailHtml(detail.bodyText) + "</pre>";
  return [
    note ? "<p>" + escapeMailHtml(note).replace(/\n/g, "<br>") + "</p>" : "",
    "<hr>",
    "<p><strong>원문</strong><br>일시: " + escapeMailHtml(formatMailDate(detail.sentAt || detail.createdAt)) + "<br>",
    "보낸 사람: " + escapeMailHtml(detail.senderEmail) + "<br>받는 사람: " + escapeMailHtml(to || "-") + "<br>",
    "참조: " + escapeMailHtml(cc || "-") + "<br>제목: " + escapeMailHtml(detail.subject) + "</p>",
    "<blockquote>" + original + "</blockquote>",
  ].join("");
}
function formatFileSize(value: number) {
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

function formatMailDate(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function summarizeMailReadReceipts(detail: MailDetail): string {
  const internalRecipients = detail.recipients.filter((item) => Boolean(item.recipientUserId));
  const internalCount = internalRecipients.length;
  const readCount = internalRecipients.filter((item) => item.isRead === true).length;
  return internalCount ? `읽음 ${readCount} / ${internalCount}` : "확인 불가";
}

type QuickComposeMode = "none" | "mail" | "approval" | "messenger";
type UnifiedSearchType = "mail" | "approval" | "messenger" | "schedule" | "contacts" | "org" | "files";
type UnifiedSearchResult = { id: string; type: UnifiedSearchType; title: string; detail: string; menu: UserPortalMenu; mailbox?: MailboxType };

type SurfaceCardProps = {
  title: string;
  value: string;
  subtext: string;
  tone: "teal" | "sand" | "ink" | "rose";
  onClick?: () => void;
};

const toneMap: Record<SurfaceCardProps["tone"], { background: string; border: string; accent: string }> = {
  teal: { background: "linear-gradient(135deg, #0f766e, #115e59)", border: "#115e59", accent: "#99f6e4" },
  sand: { background: "linear-gradient(135deg, #9a6b2f, #7c4a10)", border: "#7c4a10", accent: "#fde68a" },
  ink: { background: "linear-gradient(135deg, #1f2937, #0f172a)", border: "#0f172a", accent: "#bfdbfe" },
  rose: { background: "linear-gradient(135deg, #9f1239, #7f1d1d)", border: "#7f1d1d", accent: "#fecdd3" },
};

function SurfaceCard({ title, value, subtext, tone, onClick }: SurfaceCardProps) {
  const currentTone = toneMap[tone];
  return (
    <article
      onClick={onClick}
      style={{
        background: currentTone.background,
        borderRadius: 24,
        padding: "22px 24px",
        color: "#f8fafc",
        border: `1px solid ${currentTone.border}`,
        boxShadow: "0 20px 40px rgba(15, 23, 42, 0.18)",
        minHeight: 172,
        cursor: onClick ? "pointer" : "default",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 13, letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.82 }}>{title}</div>
          <div style={{ marginTop: 18, fontSize: 32, fontWeight: 800, lineHeight: 1.12 }}>{value}</div>
        </div>
        <div
          style={{
            minWidth: 68,
            height: 68,
            borderRadius: 18,
            background: "rgba(255,255,255,0.12)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: currentTone.accent,
            fontSize: 26,
            fontWeight: 800,
          }}
        >
          •
        </div>
      </div>
      <div style={{ marginTop: 18, fontSize: 14, color: "rgba(248,250,252,0.88)", lineHeight: 1.6 }}>{subtext}</div>
    </article>
  );
}

function formatDateLabel(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function summarizeMailPreview(detail: MailDetail | null, fallbackSubject: string): string {
  if (!detail) return fallbackSubject;
  const source = detail.bodyText || detail.subject || fallbackSubject;
  return source.length > 96 ? `${source.slice(0, 96)}...` : source;
}

function normalizeClientError(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError) {
    return error.message;
  }
  return error instanceof Error ? error.message : fallback;
}

function normalizeLoginIdInput(value: string): string {
  return value.trim().toLowerCase();
}

function buildCompanyLoginEmail(loginId: string, companyDomain: string): string {
  return `${normalizeLoginIdInput(loginId)}@${companyDomain.trim().toLowerCase()}`;
}

function normalizeMailRecipients(value: string, companyDomain: string): string[] {
  const domain = companyDomain.trim().toLowerCase();
  return value
    .split(/[;,\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const angleAddress = item.match(/<\s*([^<>\s]+@[^<>\s]+)\s*>$/u)?.[1];
      if (angleAddress) return angleAddress.toLowerCase();
      if (/^[^\s@]+@[^\s@]+$/u.test(item)) return item.toLowerCase();
      if (/^[a-z0-9._%+-]+$/iu.test(item)) return `${item.toLowerCase()}@${domain}`;
      return "";
    })
    .filter(Boolean);
}

function formatConfirmedRecipient(suggestion: RecipientSuggestion): string {
  return `${suggestion.name.trim() || suggestion.email} <${suggestion.email}>`;
}

const MAIL_SETTINGS_TABS = ["기본환경", "서명", "메일함", "스팸", "자동분류", "자동전달", "부재중응답", "외부메일", "최근보낸메일"] as const;
type MailSettingsTab = "basic" | "signature" | "mailbox" | "spam" | "classification" | "forwarding" | "outOfOffice" | "external" | "recent";
const openExternalMailTab = () => window.dispatchEvent(new Event("moaworks:open-external-mail"));
const openRecentMailTab = () => window.dispatchEvent(new Event("moaworks:open-recent-mail"));

function MailBasicSettingsPanel({ value, saved, loading, error, conflict, translationEnabled, onChange, onSave, onCancel, onReset, onReload, onOpenSignature, onOpenMailbox, onOpenSpam, onOpenClassification, onOpenForwarding, onOpenOutOfOffice }: {
  value: MailBasicPreferences | null;
  saved: MailBasicPreferences | null;
  loading: boolean;
  error: string;
  conflict: boolean;
  translationEnabled: boolean;
  onChange: (patch: Partial<MailBasicPreferences>) => void;
  onSave: () => void;
  onCancel: () => void;
  onReset: () => void;
  onReload: () => void;
  onOpenSignature: () => void;
  onOpenMailbox: () => void;
  onOpenSpam: () => void;
  onOpenClassification: () => void;
  onOpenForwarding: () => void;
  onOpenOutOfOffice: () => void;
}) {
  const dirty = Boolean(value && saved && JSON.stringify(value) !== JSON.stringify(saved));
  if (loading && !value) return <FeedbackState state="loading" title="메일 기본환경을 불러오는 중입니다." />;
  if (!value) return <FeedbackState state="error" title="메일 기본환경을 불러오지 못했습니다." message={error} />;
  const toggle = (key: keyof MailBasicPreferences, label: string, title?: string) => (
    <label className="user-mail-setting-toggle" title={title}><span>{label}{title ? <i aria-label={`${label} 설명`}>i</i> : null}</span><input type="checkbox" checked={Boolean(value[key])} onChange={(event) => onChange({ [key]: event.target.checked })} /></label>
  );
  return <section className="user-mail-settings" aria-label="메일 환경설정">
    <header><div><small>메일 환경설정</small><h2>기본환경</h2></div><span aria-live="polite">{dirty ? "저장하지 않은 변경 있음" : "저장됨"}</span></header>
    <nav aria-label="메일 설정 탭">{MAIL_SETTINGS_TABS.map((tab, index) => <button key={tab} type="button" aria-current={index === 0 ? "page" : undefined} onClick={index === 1 ? onOpenSignature : index === 2 ? onOpenMailbox : index === 3 ? onOpenSpam : index === 4 ? onOpenClassification : index === 5 ? onOpenForwarding : index === 6 ? onOpenOutOfOffice : index === 7 ? openExternalMailTab : index === 8 ? openRecentMailTab : undefined}>{tab}</button>)}</nav>
    {error ? <CompactWarning item={{ id: "mail-basic-preferences", source: "mail-settings", tone: "warning", title: conflict ? "다른 위치에서 설정이 변경되었습니다." : "설정을 처리하지 못했습니다.", message: error, action: conflict ? { label: "서버 최신값 다시 불러오기", onAction: onReload } : undefined }} /> : null}
    <div className="user-mail-settings__body">
      <fieldset><legend>메일 읽기 설정</legend>
        <label><span>보낸 사람 표시</span><select value={value.senderDisplayMode} onChange={(event) => onChange({ senderDisplayMode: event.target.value as MailBasicPreferences["senderDisplayMode"] })}><option value="name">이름</option><option value="name_email">이름 + 이메일</option></select></label>
        {toggle("blockRemoteImages", "원격 이미지 차단", "외부 이미지 자동 로드를 차단합니다.")}
        {toggle("disableRiskyTags", "위험 태그 비활성화", "향후 HTML 표시에서도 위험 요소를 차단합니다.")}
        {toggle("showRouteCountry", "전달 경로 국가 표시")}
        {toggle("includeSpamTrashInSearch", "검색에 스팸·휴지통 포함")}
      </fieldset>
      <fieldset><legend>메일 쓰기 설정</legend>
        <label><span>수신자 입력 방식</span><select value={value.recipientInputMode} onChange={(event) => onChange({ recipientInputMode: event.target.value as MailBasicPreferences["recipientInputMode"] })}><option value="autocomplete">자동완성</option><option value="name_only">이름만 입력</option><option value="search">검색 선택</option></select></label>
        {toggle("confirmBeforeSend", "발송 전 확인")}{toggle("saveSentCopy", "보낸메일 저장", "끄면 발송 원문은 유지하고 보낸편지함에서만 숨깁니다.")}{toggle("readReceiptEnabled", "수신확인 요청")}
        <label><span>편집 방식</span><select value={value.editorMode} onChange={(event) => onChange({ editorMode: event.target.value as MailBasicPreferences["editorMode"] })}><option value="html">HTML</option><option value="plain">일반 텍스트</option></select></label>
        <label><span>작성창</span><select value={value.composeMode} onChange={(event) => onChange({ composeMode: event.target.value as MailBasicPreferences["composeMode"] })}><option value="normal">일반</option><option value="popup">팝업</option></select></label>
        <label title="외부 MIME 본문 charset에 적용됩니다."><span>문자 인코딩 <i>i</i></span><select value={value.messageEncoding} onChange={(event) => onChange({ messageEncoding: event.target.value as MailBasicPreferences["messageEncoding"] })}><option value="utf-8">UTF-8</option><option value="euc-kr">EUC-KR</option><option value="iso-2022-jp">ISO-2022-JP</option></select></label>
        {toggle("draftReminderEnabled", "임시저장 알림")}
        <label><span>발신자 이름</span><input maxLength={100} value={value.senderDisplayName} onChange={(event) => onChange({ senderDisplayName: event.target.value })} /></label>
        <label><span>답장 주소</span><input type="email" maxLength={254} value={value.replyToEmail ?? ""} onChange={(event) => onChange({ replyToEmail: event.target.value || null })} /></label>
        {toggle("vcardEnabled", "vCard 첨부")}
        {translationEnabled ? <>
          <label><span>번역 기본 언어</span><select value={value.translationTargetLocale} onChange={(event) => onChange({ translationTargetLocale: event.target.value })}><option value="ko">한국어</option><option value="en">영어</option><option value="ja">일본어</option><option value="zh-cn">중국어(간체)</option><option value="es">스페인어</option><option value="fr">프랑스어</option><option value="de">독일어</option></select></label>
          <label><span>발신 번역 방식</span><select value={value.translationComposeMode} onChange={(event) => onChange({ translationComposeMode: event.target.value as MailBasicPreferences["translationComposeMode"] })}><option value="preview">미리보기 후 적용</option><option value="apply">번역 후 적용 확인</option></select></label>
        </> : null}
      </fieldset>
    </div>
    <footer><button type="button" onClick={onReset} disabled={loading}>기본값 적용</button><span /><button type="button" onClick={onCancel} disabled={loading}>닫기</button><button type="button" onClick={onSave} disabled={loading || !dirty}>저장</button></footer>
  </section>;
}

function MailSignatureSettingsPanel({
  value, saved, loading, error, conflict, onChange, onSavePreferences, onCancel, onReload,
  onSaveSignature, onDeleteSignatures, onOpenBasic, onOpenMailbox, onOpenSpam, onOpenClassification, onOpenForwarding, onOpenOutOfOffice,
}: {
  value: MailSignaturePreferences | null;
  saved: MailSignaturePreferences | null;
  loading: boolean;
  error: string;
  conflict: boolean;
  onChange: (patch: Partial<MailSignaturePreferences>) => void;
  onSavePreferences: () => Promise<void>;
  onCancel: () => void;
  onReload: () => Promise<void>;
  onSaveSignature: (signature: MailSignature | null, form: { name: string; contentText: string; makeDefault: boolean }) => Promise<boolean>;
  onDeleteSignatures: (signatures: MailSignature[]) => Promise<boolean>;
  onOpenBasic: () => void;
  onOpenMailbox: () => void;
  onOpenSpam: () => void;
  onOpenClassification: () => void;
  onOpenForwarding: () => void;
  onOpenOutOfOffice: () => void;
}) {
  type MailSignatureEditorForm = { name: string; contentText: string; makeDefault: boolean };
  const emptyEditorForm: MailSignatureEditorForm = { name: "", contentText: "", makeDefault: false };
  const isMailSignatureEditorDirty = (initial: MailSignatureEditorForm, current: MailSignatureEditorForm) =>
    initial.name !== current.name
    || initial.contentText !== current.contentText
    || initial.makeDefault !== current.makeDefault;
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editor, setEditor] = useState<MailSignature | null | false>(false);
  const [editorInitialForm, setEditorInitialForm] = useState<MailSignatureEditorForm>(emptyEditorForm);
  const [editorForm, setEditorForm] = useState<MailSignatureEditorForm>(emptyEditorForm);
  const [deleteTargets, setDeleteTargets] = useState<MailSignature[]>([]);
  const editorCloseRequestRef = useRef<(() => void) | null>(null);
  const dirty = Boolean(value && saved && JSON.stringify(value) !== JSON.stringify(saved));
  const openEditor = (signature: MailSignature | null) => {
    const nextForm = {
      name: signature?.name ?? "",
      contentText: signature?.contentText ?? "",
      makeDefault: signature ? value?.defaultSignatureId === signature.signatureId : false,
    };
    setEditor(signature);
    setEditorInitialForm(nextForm);
    setEditorForm(nextForm);
  };
  if (loading && !value) return <FeedbackState state="loading" title="메일 서명을 불러오는 중입니다." />;
  if (!value) return <FeedbackState state="error" title="메일 서명을 불러오지 못했습니다." message={error} action={{ label: "다시 시도", onAction: () => void onReload() }} />;
  const selected = value.signatures.filter((item) => selectedIds.includes(item.signatureId));
  return <section className="user-mail-settings user-mail-signature-settings" aria-label="메일 서명 환경설정">
    <header><div><small>메일 환경설정</small><h2>서명</h2></div><span aria-live="polite">{dirty ? "저장하지 않은 변경 있음" : "저장됨"}</span></header>
    <nav aria-label="메일 설정 탭">{MAIL_SETTINGS_TABS.map((tab, index) => <button key={tab} type="button" aria-current={index === 1 ? "page" : undefined} onClick={index === 0 ? onOpenBasic : index === 2 ? onOpenMailbox : index === 3 ? onOpenSpam : index === 4 ? onOpenClassification : index === 5 ? onOpenForwarding : index === 6 ? onOpenOutOfOffice : index === 7 ? openExternalMailTab : index === 8 ? openRecentMailTab : undefined}>{tab}</button>)}</nav>
    {error ? <CompactWarning item={{ id: "mail-signatures", source: "mail-settings", tone: "warning", title: conflict ? "다른 위치에서 서명이 변경되었습니다." : "서명을 처리하지 못했습니다.", message: error, action: conflict ? { label: "서버 최신값 다시 불러오기", onAction: () => void onReload() } : undefined }} /> : null}
    <div className="user-mail-settings__body user-mail-signature-settings__body">
      <fieldset>
        <legend>서명 정책</legend>
        <label><span>서명 사용 <i title="발송·예약·임시저장 시 서버가 최신 기본 서명을 적용합니다.">i</i></span><input type="checkbox" checked={value.enabled} disabled={!value.signatures.length} onChange={(event) => onChange({ enabled: event.target.checked })} /></label>
        <label><span>삽입 위치</span><select value={value.position} onChange={(event) => onChange({ position: event.target.value as MailSignaturePreferences["position"] })}><option value="body_top">본문 상단</option><option value="body_bottom">본문 하단</option></select></label>
        <label><span>기본 서명</span><select value={value.defaultSignatureId ?? ""} onChange={(event) => onChange({ defaultSignatureId: event.target.value || null, enabled: event.target.value ? value.enabled : false })}><option value="">선택 안 함</option>{value.signatures.map((item) => <option key={item.signatureId} value={item.signatureId}>{item.name}</option>)}</select></label>
      </fieldset>
      <fieldset className="user-mail-signature-list">
        <legend>서명 목록</legend>
        <div className="user-mail-signature-list__toolbar">
          <button type="button" onClick={() => openEditor(null)} disabled={loading || value.signatures.length >= 20}>서명 추가</button>
          <button type="button" onClick={() => setDeleteTargets(selected)} disabled={loading || !selected.length}>선택 삭제</button>
          <small>{value.signatures.length}/20개</small>
        </div>
        {!value.signatures.length ? <FeedbackState state="empty" title="등록된 서명이 없습니다." message="서명 추가 버튼으로 첫 서명을 등록하세요." /> : value.signatures.map((item) => <article key={item.signatureId} className="user-mail-signature-row">
          <input type="checkbox" aria-label={`${item.name} 선택`} checked={selectedIds.includes(item.signatureId)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, item.signatureId] : current.filter((id) => id !== item.signatureId))} />
          <div><strong>{item.name}{value.defaultSignatureId === item.signatureId ? <em>기본</em> : null}</strong><pre>{item.contentText}</pre></div>
          <button type="button" onClick={() => openEditor(item)}>수정</button>
          <button type="button" onClick={() => setDeleteTargets([item])}>삭제</button>
        </article>)}
      </fieldset>
    </div>
    <footer><span /><button type="button" onClick={onCancel} disabled={loading}>닫기</button><button type="button" onClick={() => void onSavePreferences()} disabled={loading || !dirty || (value.enabled && !value.defaultSignatureId)}>저장</button></footer>
    <CommonPopup title={editor ? "서명 수정" : "서명 추가"} open={editor !== false} onClose={() => setEditor(false)} dirty={isMailSignatureEditorDirty(editorInitialForm, editorForm)} error={error} saving={loading} closeRequestRef={editorCloseRequestRef}>
      <div className="user-mail-signature-editor">
        <label><span>이름</span><input autoFocus maxLength={50} value={editorForm.name} onChange={(event) => setEditorForm((current) => ({ ...current, name: event.target.value }))} /></label>
        <label><span>일반 텍스트 내용</span><textarea maxLength={4000} value={editorForm.contentText} onChange={(event) => setEditorForm((current) => ({ ...current, contentText: event.target.value }))} /></label>
        <label><input type="checkbox" checked={editorForm.makeDefault} onChange={(event) => setEditorForm((current) => ({ ...current, makeDefault: event.target.checked }))} /> 기본 서명으로 지정</label>
        <div className="feedback-confirm-actions"><button type="button" onClick={() => editorCloseRequestRef.current?.()}>취소</button><button type="button" disabled={loading || !editorForm.name.trim() || !editorForm.contentText.trim()} onClick={async () => { if (await onSaveSignature(editor || null, editorForm)) setEditor(false); }}>저장</button></div>
      </div>
    </CommonPopup>
    <ConfirmModal open={deleteTargets.length > 0} title="서명 삭제 확인" message={<><strong>{deleteTargets.length}개 서명</strong>을 삭제합니다. 기본 서명이면 남은 최신 서명이 자동 승계됩니다.</>} confirmLabel="삭제" busy={loading} onCancel={() => setDeleteTargets([])} onConfirm={async () => { if (await onDeleteSignatures(deleteTargets)) { setDeleteTargets([]); setSelectedIds([]); } }} />
  </section>;
}

const MAILBOX_LABELS: Record<string, string> = {
  "system:inbox": "받은편지함",
  "system:sent": "보낸편지함",
  "system:draft": "임시보관함",
  "system:scheduled": "예약메일함",
  "system:spam": "스팸함",
  "system:trash": "휴지통",
};

function formatMailboxBytes(value: number): string {
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

function MailboxSettingsPanel({
  value, loading, error, busyKey, onReload, onClose, onOpenBasic, onOpenSignature, onOpenSpam, onOpenClassification, onOpenForwarding, onOpenOutOfOffice,
  onSavePolicy, onEmpty, onBackup, onRetry, onDownload,
  onAddFolder, onEditFolder, onDeleteFolder, onAddTag, onEditTag, onDeleteTag,
}: {
  value: MailMailboxSettingsResponse | null;
  loading: boolean;
  error: string;
  busyKey: string;
  onReload: () => void;
  onClose: () => void;
  onOpenBasic: () => void;
  onOpenSignature: () => void;
  onOpenSpam: () => void;
  onOpenClassification: () => void;
  onOpenForwarding: () => void;
  onOpenOutOfOffice: () => void;
  onSavePolicy: (mailbox: MailboxSettingsRow, retentionDays: MailboxSettingsRow["retentionDays"]) => Promise<boolean>;
  onEmpty: (mailbox: MailboxSettingsRow, confirmPermanent: boolean) => Promise<boolean>;
  onBackup: (mailbox: MailboxSettingsRow) => Promise<void>;
  onRetry: (job: MailBackupJob) => Promise<void>;
  onDownload: (job: MailBackupJob) => Promise<void>;
  onAddFolder: () => void;
  onEditFolder: (folder: MailFolder) => void;
  onDeleteFolder: (folder: MailFolder) => void;
  onAddTag: () => void;
  onEditTag: (tag: MailTag) => void;
  onDeleteTag: (tag: MailTag) => void;
}) {
  const [retentionDrafts, setRetentionDrafts] = useState<Record<string, string>>({});
  const [emptyTarget, setEmptyTarget] = useState<MailboxSettingsRow | null>(null);
  const [confirmPermanent, setConfirmPermanent] = useState(false);
  useEffect(() => {
    setRetentionDrafts(Object.fromEntries((value?.mailboxes ?? []).map((row) => [row.mailboxKey, row.retentionDays === null ? "" : String(row.retentionDays)])));
  }, [value?.mailboxes]);
  useEffect(() => {
    if (!emptyTarget) return;
    const current = value?.mailboxes.find((row) => row.mailboxKey === emptyTarget.mailboxKey);
    if (current && current !== emptyTarget) setEmptyTarget(current);
  }, [emptyTarget, value?.mailboxes]);
  if (loading && !value) return <FeedbackState state="loading" title="메일함 설정을 불러오는 중입니다." />;
  if (!value) return <FeedbackState state="error" title="메일함 설정을 불러오지 못했습니다." message={error} action={{ label: "다시 시도", onAction: onReload }} />;
  const activeBackup = value.backupJobs.some((job) => job.status === "queued" || job.status === "running");
  const statusLabel: Record<MailBackupJob["status"], string> = { queued: "대기", running: "진행 중", completed: "완료", failed: "실패", expired: "만료" };
  return <section className="user-mail-settings user-mail-mailbox-settings" aria-label="메일함 환경설정">
    <header><div><small>메일 환경설정</small><h2>메일함</h2></div><span aria-live="polite">{activeBackup ? "메일함 백업 처리 중" : "설정 확인 완료"}</span></header>
    <nav aria-label="메일 설정 탭">{MAIL_SETTINGS_TABS.map((tab, index) => <button key={tab} type="button" aria-current={index === 2 ? "page" : undefined} onClick={index === 0 ? onOpenBasic : index === 1 ? onOpenSignature : index === 3 ? onOpenSpam : index === 4 ? onOpenClassification : index === 5 ? onOpenForwarding : index === 6 ? onOpenOutOfOffice : index === 7 ? openExternalMailTab : index === 8 ? openRecentMailTab : undefined}>{tab}</button>)}</nav>
    {error ? <CompactWarning item={{ id: "mailbox-settings", source: "mail-settings", tone: "warning", title: "메일함 설정을 처리하지 못했습니다.", message: error, action: { label: "서버 최신값 다시 불러오기", onAction: onReload } }} /> : null}
    <div className="user-mail-mailbox-settings__body">
      <div className="user-mail-mailbox-settings__toolbar">
        <button type="button" onClick={onAddFolder}>사용자 메일함 추가</button>
        <button type="button" onClick={onAddTag}>태그 추가</button>
        <button
          type="button"
          className="user-mail-mailbox-settings__info"
          title="보관기간이 지난 메일은 휴지통으로 이동하고, 휴지통 메일은 30일 뒤 영구 삭제됩니다. 사용량은 사용자 보기 기준 논리 사용량입니다."
          aria-label="메일함 보관기간과 사용량 설명"
        >i</button>
      </div>
      <div className="user-mail-mailbox-settings__table-wrap">
        <table>
          <caption>메일함별 보관기간, 안 읽은 메일 수, 전체 메일 수, 사용자 보기 기준 사용량과 관리 작업</caption>
          <thead><tr><th>메일함</th><th>보관기간</th><th>안 읽음/전체</th><th>사용량</th><th>관리</th></tr></thead>
          <tbody>{value.mailboxes.map((row) => {
            const folderId = row.mailboxKey.startsWith("folder:") ? row.mailboxKey.slice("folder:".length) : "";
            const folder = folderId ? { folderId, name: row.name, sortOrder: 0, messageCount: row.totalCount } satisfies MailFolder : null;
            const draft = retentionDrafts[row.mailboxKey] ?? "";
            const nextRetention = draft ? Number(draft) as 30 | 90 | 180 | 365 : null;
            const policyDirty = nextRetention !== row.retentionDays;
            return <tr key={row.mailboxKey}>
              <td><strong>{MAILBOX_LABELS[row.mailboxKey] ?? row.name}</strong>{row.mailboxType === "folder" ? <small>사용자 메일함</small> : null}</td>
              <td>{row.retentionEditable ? <div className="user-mail-mailbox-settings__retention"><select aria-label={`${row.name} 보관기간`} value={draft} disabled={loading} onChange={(event) => setRetentionDrafts((current) => ({ ...current, [row.mailboxKey]: event.target.value }))}><option value="">무기한</option><option value="30">30일</option><option value="90">90일</option><option value="180">180일</option><option value="365">365일</option></select><button type="button" disabled={!policyDirty || Boolean(busyKey)} onClick={() => void onSavePolicy(row, nextRetention)}>저장</button></div> : <span>{row.retentionDays === null ? "무기한" : `${row.retentionDays}일`}</span>}</td>
              <td>{row.unreadCount === null ? `- / ${row.totalCount}` : `${row.unreadCount} / ${row.totalCount}`}</td>
              <td>{formatMailboxBytes(row.usedBytes)}</td>
              <td><div className="user-mail-mailbox-settings__actions">
                <button type="button" disabled={activeBackup || Boolean(busyKey)} onClick={() => void onBackup(row)}>백업</button>
                <button type="button" className="is-destructive" disabled={!row.totalCount || Boolean(busyKey)} onClick={() => { setEmptyTarget(row); setConfirmPermanent(false); }}>비우기</button>
                {folder ? <><button type="button" onClick={() => onEditFolder(folder)}>수정</button><button type="button" onClick={() => onDeleteFolder(folder)}>삭제</button></> : null}
              </div></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      <section className="user-mail-mailbox-settings__tags">
        <h3>태그 관리</h3>
        {!value.tags.length ? <p>등록된 태그가 없습니다.</p> : value.tags.map((tag) => <div key={tag.tagId}><span className={`user-mail-tag-dot is-${tag.color}`} /><strong>{tag.name}</strong><small>{tag.messageCount}개</small><button type="button" onClick={() => onEditTag(tag)}>수정</button><button type="button" onClick={() => onDeleteTag(tag)}>삭제</button></div>)}
      </section>
      <section className="user-mail-mailbox-settings__backups" aria-live="polite">
        <h3>백업 작업</h3>
        {!value.backupJobs.length ? <p>요청한 백업이 없습니다.</p> : value.backupJobs.map((job) => {
          const downloadable = job.status === "completed" && Boolean(job.expiresAt) && new Date(job.expiresAt ?? 0).getTime() > Date.now();
          return <article key={job.jobId}><div><strong>{job.mailboxLabel}</strong><span>{statusLabel[job.status]}</span><small>{job.processedCount}/{job.totalCount} · {formatMailboxBytes(job.artifactSizeBytes)}</small></div><progress max={Math.max(1, job.totalCount)} value={job.processedCount} /><div>{job.status === "failed" ? <button type="button" disabled={Boolean(busyKey)} onClick={() => void onRetry(job)}>재시도</button> : null}{downloadable ? <button type="button" disabled={Boolean(busyKey)} onClick={() => void onDownload(job)}>ZIP 다운로드</button> : null}{job.errorCode ? <small>{job.errorCode}</small> : null}</div></article>;
        })}
      </section>
    </div>
    <footer><span /><button type="button" onClick={onClose} disabled={Boolean(busyKey)}>닫기</button></footer>
    <CommonPopup title={`${emptyTarget ? (MAILBOX_LABELS[emptyTarget.mailboxKey] ?? emptyTarget.name) : "메일함"} 비우기`} open={Boolean(emptyTarget)} onClose={() => setEmptyTarget(null)} saving={Boolean(busyKey)} kind="alertdialog">
      <div className="user-mail-mailbox-settings__empty-confirm">
        <p>현재 {emptyTarget?.totalCount ?? 0}개의 사용자 보기에서 메일을 제거합니다. 공유 원문과 첨부 원본은 삭제하지 않습니다.</p>
        {emptyTarget?.mailboxKey === "system:trash" ? <label><input type="checkbox" checked={confirmPermanent} onChange={(event) => setConfirmPermanent(event.target.checked)} /> 휴지통 비우기는 복구할 수 없음을 확인했습니다.</label> : null}
        <div className="feedback-confirm-actions"><button type="button" disabled={Boolean(busyKey)} onClick={() => setEmptyTarget(null)}>취소</button><button type="button" className="is-destructive" disabled={Boolean(busyKey) || (emptyTarget?.mailboxKey === "system:trash" && !confirmPermanent)} onClick={async () => { if (emptyTarget && await onEmpty(emptyTarget, confirmPermanent)) setEmptyTarget(null); }}>비우기</button></div>
      </div>
    </CommonPopup>
  </section>;
}

function maskSpamRuleValue(rule: MailSpamRule): string {
  if (rule.matchType === "email") {
    const [local, domain] = rule.matchValue.split("@");
    return `${local.slice(0, 2)}***@${domain}`;
  }
  const labels = rule.matchValue.split(".");
  return `${labels[0].slice(0, 2)}***.${labels.slice(1).join(".")}`;
}

function MailSpamSettingsPanel({
  value, loading, error, busy, onReload, onClose, onOpenBasic, onOpenSignature, onOpenMailbox, onOpenClassification, onOpenForwarding, onOpenOutOfOffice,
  onChangePolicy, onSavePolicy, onSaveRule, onDeleteRule,
}: {
  value: MailSpamSettingsResponse | null;
  loading: boolean;
  error: string;
  busy: boolean;
  onReload: () => void;
  onClose: () => void;
  onOpenBasic: () => void;
  onOpenSignature: () => void;
  onOpenMailbox: () => void;
  onOpenClassification: () => void;
  onOpenForwarding: () => void;
  onOpenOutOfOffice: () => void;
  onChangePolicy: (enabled: boolean) => void;
  onSavePolicy: () => Promise<void>;
  onSaveRule: (rule: MailSpamRule | null, payload: MailSpamRulePayload) => Promise<string | null>;
  onDeleteRule: (rule: MailSpamRule) => Promise<boolean>;
}) {
  const emptyForm: MailSpamRulePayload = { ruleType: "deny", matchType: "email", matchValue: "", enabled: true };
  const [search, setSearch] = useState("");
  const [ruleTypeFilter, setRuleTypeFilter] = useState<"all" | "allow" | "deny">("all");
  const [matchTypeFilter, setMatchTypeFilter] = useState<"all" | "email" | "domain">("all");
  const [editor, setEditor] = useState<MailSpamRule | null | false>(false);
  const [form, setForm] = useState<MailSpamRulePayload>(emptyForm);
  const [fieldError, setFieldError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<MailSpamRule | null>(null);
  const openEditor = (rule: MailSpamRule | null) => {
    setEditor(rule);
    setForm(rule ? { ruleType: rule.ruleType, matchType: rule.matchType, matchValue: rule.matchValue, enabled: rule.enabled } : emptyForm);
    setFieldError("");
  };
  if (loading && !value) return <FeedbackState state="loading" title="스팸 설정을 불러오는 중입니다." />;
  if (!value) return <FeedbackState state="error" title="스팸 설정을 불러오지 못했습니다." message={error} action={{ label: "다시 시도", onAction: onReload }} />;
  const normalizedSearch = search.trim().toLowerCase();
  const filteredRules = value.rules.filter((rule) =>
    (ruleTypeFilter === "all" || rule.ruleType === ruleTypeFilter)
    && (matchTypeFilter === "all" || rule.matchType === matchTypeFilter)
    && (!normalizedSearch || rule.matchValue.includes(normalizedSearch))
  );
  return <section className="user-mail-settings user-mail-spam-settings" aria-label="스팸 환경설정">
    <header><div><small>메일 환경설정</small><h2>스팸</h2></div><span aria-live="polite">규칙 {value.rules.length}/200개</span></header>
    <nav aria-label="메일 설정 탭">{MAIL_SETTINGS_TABS.map((tab, index) => <button key={tab} type="button" aria-current={index === 3 ? "page" : undefined} onClick={index === 0 ? onOpenBasic : index === 1 ? onOpenSignature : index === 2 ? onOpenMailbox : index === 4 ? onOpenClassification : index === 5 ? onOpenForwarding : index === 6 ? onOpenOutOfOffice : index === 7 ? openExternalMailTab : index === 8 ? openRecentMailTab : undefined}>{tab}</button>)}</nav>
    {error ? <CompactWarning item={{ id: "spam-settings", source: "mail-settings", tone: "warning", title: "스팸 설정을 처리하지 못했습니다.", message: error, action: { label: "서버 최신값 다시 불러오기", onAction: onReload } }} /> : null}
    <div className="user-mail-spam-settings__body">
      <section className="user-mail-spam-settings__policy">
        <label><span>스팸 필터 사용 <i title="허용 규칙은 모든 거부 규칙보다 우선하며 새로 받는 메일부터 적용됩니다.">i</i></span><input type="checkbox" role="switch" checked={value.filterEnabled} disabled={busy} onChange={(event) => onChangePolicy(event.target.checked)} /></label>
        <span>거부 일치 처리: <strong>스팸함 이동</strong></span>
        <button type="button" disabled={busy} onClick={() => void onSavePolicy()}>정책 저장</button>
      </section>
      <div className="user-mail-spam-settings__toolbar">
        <input aria-label="스팸 규칙 검색" placeholder="이메일 또는 도메인 검색" value={search} onChange={(event) => setSearch(event.target.value.toLowerCase())} />
        <select aria-label="구분 필터" value={ruleTypeFilter} onChange={(event) => setRuleTypeFilter(event.target.value as typeof ruleTypeFilter)}><option value="all">구분 전체</option><option value="allow">허용</option><option value="deny">거부</option></select>
        <select aria-label="대상 필터" value={matchTypeFilter} onChange={(event) => setMatchTypeFilter(event.target.value as typeof matchTypeFilter)}><option value="all">대상 전체</option><option value="email">이메일</option><option value="domain">도메인</option></select>
        <button type="button" disabled={busy || value.rules.length >= 200} onClick={() => openEditor(null)}>규칙 추가</button>
      </div>
      <div className="user-mail-spam-settings__table-wrap">
        {!filteredRules.length ? <div className="user-mail-spam-settings__empty"><span>{value.rules.length ? "조건에 맞는 규칙이 없습니다." : "등록된 스팸 규칙이 없습니다."}</span><button type="button" disabled={busy || value.rules.length >= 200} onClick={() => openEditor(null)}>규칙 추가</button></div> : <table>
          <caption>스팸 허용 및 거부 규칙</caption>
          <thead><tr><th>구분</th><th>대상</th><th>값</th><th>활성</th><th>생성일</th><th>관리</th></tr></thead>
          <tbody>{filteredRules.map((rule) => <tr key={rule.ruleId}><td><span className={`user-mail-spam-settings__badge is-${rule.ruleType}`}>{rule.ruleType === "allow" ? "허용" : "거부"}</span></td><td>{rule.matchType === "email" ? "이메일" : "도메인"}</td><td>{rule.matchValue}</td><td>{rule.enabled ? "사용" : "중지"}</td><td>{formatMailDate(rule.createdAt)}</td><td><button type="button" disabled={busy} onClick={() => openEditor(rule)}>수정</button><button type="button" className="is-destructive" disabled={busy} onClick={() => setDeleteTarget(rule)}>삭제</button></td></tr>)}</tbody>
        </table>}
      </div>
    </div>
    <footer><span /><button type="button" disabled={busy} onClick={onClose}>닫기</button></footer>
    <CommonPopup title={editor ? "스팸 규칙 수정" : "스팸 규칙 추가"} open={editor !== false} onClose={() => setEditor(false)} saving={busy} error="">
      <div className="user-mail-spam-settings__editor">
        <label><span>구분</span><select value={form.ruleType} disabled={busy} onChange={(event) => setForm((current) => ({ ...current, ruleType: event.target.value as MailSpamRulePayload["ruleType"] }))}><option value="allow">허용</option><option value="deny">거부</option></select></label>
        <label><span>대상</span><select value={form.matchType} disabled={busy} onChange={(event) => setForm((current) => ({ ...current, matchType: event.target.value as MailSpamRulePayload["matchType"] }))}><option value="email">이메일</option><option value="domain">도메인</option></select></label>
        <label><span>값</span><input autoFocus maxLength={320} value={form.matchValue} disabled={busy} placeholder={form.matchType === "email" ? "user@example.com" : "example.com"} aria-invalid={Boolean(fieldError)} onChange={(event) => { setForm((current) => ({ ...current, matchValue: event.target.value })); setFieldError(""); }} />{fieldError ? <small role="alert">{fieldError}</small> : null}</label>
        <label className="user-mail-spam-settings__enabled"><input type="checkbox" checked={form.enabled} disabled={busy} onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))} /> 활성</label>
        <div className="feedback-confirm-actions"><button type="button" disabled={busy} onClick={() => setEditor(false)}>취소</button><button type="button" disabled={busy || !form.matchValue.trim()} onClick={async () => { const message = await onSaveRule(editor || null, form); if (message) setFieldError(message); else setEditor(false); }}>저장</button></div>
      </div>
    </CommonPopup>
    <CommonPopup title="스팸 규칙 삭제" open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} saving={busy} kind="alertdialog">
      <div className="user-mail-spam-settings__delete"><p><strong>{deleteTarget?.ruleType === "allow" ? "허용" : "거부"}</strong> · {deleteTarget?.matchType === "email" ? "이메일" : "도메인"} · {deleteTarget ? maskSpamRuleValue(deleteTarget) : ""}</p><div className="feedback-confirm-actions"><button type="button" disabled={busy} onClick={() => setDeleteTarget(null)}>취소</button><button type="button" className="is-destructive" disabled={busy} onClick={async () => { if (deleteTarget && await onDeleteRule(deleteTarget)) setDeleteTarget(null); }}>삭제</button></div></div>
    </CommonPopup>
  </section>;
}

const AUTO_FIELD_LABELS: Record<MailAutoClassificationCondition["field"], string> = {
  sender_email: "보낸 사람 이메일", sender_domain: "보낸 사람 도메인", recipient_email: "받는 사람",
  subject: "제목", body: "본문", attachment: "첨부",
};
const AUTO_OPERATOR_LABELS: Record<MailAutoClassificationCondition["operator"], string> = {
  equals: "일치", contains: "포함", subdomain: "하위 도메인 포함", starts_with: "시작", ends_with: "끝", exists: "있음", missing: "없음",
};
const autoOperators = (field: MailAutoClassificationCondition["field"]): MailAutoClassificationCondition["operator"][] => ({
  sender_email: ["equals", "contains"], sender_domain: ["equals", "subdomain"], recipient_email: ["equals", "contains"],
  subject: ["contains", "equals", "starts_with", "ends_with"], body: ["contains"], attachment: ["exists", "missing"],
}[field] as MailAutoClassificationCondition["operator"][]);
const emptyAutoRule = (): MailAutoClassificationRulePayload => ({ name: "", enabled: true, conditions: [{ field: "subject", operator: "contains", value: "" }], targetFolderId: null, tagIds: [] });

function MailAutoClassificationPanel({ value, loading, error, busy, onReload, onClose, onOpenBasic, onOpenSignature, onOpenMailbox, onOpenSpam, onOpenForwarding, onOpenOutOfOffice, onChangePolicy, onSavePolicy, onSaveRule, onDelete, onReorder }: {
  value: MailAutoClassificationSettings | null; loading: boolean; error: string; busy: boolean;
  onReload: () => void; onClose: () => void; onOpenBasic: () => void; onOpenSignature: () => void; onOpenMailbox: () => void; onOpenSpam: () => void; onOpenForwarding: () => void; onOpenOutOfOffice: () => void;
  onChangePolicy: (enabled: boolean) => void; onSavePolicy: () => Promise<void>;
  onSaveRule: (rule: MailAutoClassificationRule | null, payload: MailAutoClassificationRulePayload) => Promise<string | null>;
  onDelete: (ruleIds: string[]) => Promise<boolean>; onReorder: (ruleIds: string[]) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [editor, setEditor] = useState<MailAutoClassificationRule | null | false>(false);
  const [form, setForm] = useState<MailAutoClassificationRulePayload>(emptyAutoRule());
  const [formError, setFormError] = useState("");
  const openEditor = (rule: MailAutoClassificationRule | null) => {
    setEditor(rule);
    setForm(rule ? { name: rule.name, enabled: rule.enabled, conditions: rule.conditions.map((item) => ({ ...item })), targetFolderId: rule.targetFolderId, tagIds: [...rule.tagIds] } : emptyAutoRule());
    setFormError("");
  };
  if (loading && !value) return <FeedbackState state="loading" title="자동분류 설정을 불러오는 중입니다." />;
  if (!value) return <FeedbackState state="error" title="자동분류 설정을 불러오지 못했습니다." message={error} action={{ label: "다시 시도", onAction: onReload }} />;
  const normalized = search.trim().toLowerCase();
  const filtered = value.rules.filter((rule) => (!normalized || `${rule.name} ${rule.conditions.map((item) => `${AUTO_FIELD_LABELS[item.field]} ${item.value ?? ""}`).join(" ")}`.toLowerCase().includes(normalized)) && (statusFilter === "all" || (statusFilter === "enabled") === rule.enabled));
  const move = async (rule: MailAutoClassificationRule, offset: number) => {
    const current = value.rules.findIndex((item) => item.ruleId === rule.ruleId);
    const target = current + offset;
    if (target < 0 || target >= value.rules.length) return;
    const ids = value.rules.map((item) => item.ruleId);
    [ids[current], ids[target]] = [ids[target], ids[current]];
    await onReorder(ids);
  };
  return <section className="user-mail-settings user-mail-auto-classification" aria-label="자동분류 환경설정">
    <header><div><small>메일 환경설정</small><h2>자동분류</h2></div><span aria-live="polite">규칙 {value.rules.length}/100개</span></header>
    <nav aria-label="메일 설정 탭">{MAIL_SETTINGS_TABS.map((tab, index) => <button key={tab} type="button" aria-current={index === 4 ? "page" : undefined} onClick={index === 0 ? onOpenBasic : index === 1 ? onOpenSignature : index === 2 ? onOpenMailbox : index === 3 ? onOpenSpam : index === 5 ? onOpenForwarding : index === 6 ? onOpenOutOfOffice : index === 7 ? openExternalMailTab : index === 8 ? openRecentMailTab : undefined}>{tab}</button>)}</nav>
    {error ? <CompactWarning item={{ id: "auto-classification", source: "mail-settings", tone: "warning", title: "자동분류 설정을 처리하지 못했습니다.", message: error, action: { label: "서버 최신값 다시 불러오기", onAction: onReload } }} /> : null}
    <div className="user-mail-auto-classification__body">
      <section className="user-mail-auto-classification__policy"><label><span>자동분류 사용 <i title="스팸 판정 후 정상 신규 수신 메일에만 적용됩니다.">i</i></span><input type="checkbox" role="switch" checked={value.enabled} disabled={busy} onChange={(event) => onChangePolicy(event.target.checked)} /></label><button type="button" disabled={busy} onClick={() => void onSavePolicy()}>정책 저장</button></section>
      <div className="user-mail-auto-classification__toolbar"><input aria-label="자동분류 규칙 검색" placeholder="규칙명·조건 검색" value={search} onChange={(event) => setSearch(event.target.value)} /><select aria-label="자동분류 상태 필터" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="all">상태 전체</option><option value="enabled">사용</option><option value="disabled">중지</option></select><button type="button" disabled={busy || value.rules.length >= 100} onClick={() => openEditor(null)}>규칙 추가</button><button type="button" className="is-destructive" disabled={busy || !selected.length} onClick={async () => { if (await onDelete(selected)) setSelected([]); }}>선택 삭제</button></div>
      <div className="user-mail-auto-classification__table-wrap">{!filtered.length ? <div className="user-mail-auto-classification__empty"><span>{value.rules.length ? "조건에 맞는 규칙이 없습니다." : "등록된 자동분류 규칙이 없습니다."}</span><button type="button" disabled={busy || value.rules.length >= 100} onClick={() => openEditor(null)}>규칙 추가</button></div> : <table><caption>자동분류 규칙 우선순위와 마지막 실행 결과</caption><thead><tr><th>선택</th><th>우선순위</th><th>규칙명</th><th>조건 요약</th><th>보관 메일함/태그</th><th>상태</th><th>마지막 실행 결과</th><th>관리</th></tr></thead><tbody>{filtered.map((rule) => { const folder = value.folders.find((item) => item.folderId === rule.targetFolderId); const tags = rule.tagIds.map((id) => value.tags.find((item) => item.tagId === id)?.name).filter(Boolean); const index = value.rules.findIndex((item) => item.ruleId === rule.ruleId); const eventLabel = rule.lastEvent ? rule.lastEvent.result === "applied" ? "적용" : rule.lastEvent.result === "failed" ? "실패" : "일치했으나 동작 없음" : "실행 전"; return <tr key={rule.ruleId}><td><input type="checkbox" aria-label={`${rule.name} 선택`} checked={selected.includes(rule.ruleId)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, rule.ruleId] : current.filter((id) => id !== rule.ruleId))} /></td><td>{rule.priority}</td><td>{rule.name}</td><td title={rule.conditions.map((item) => `${AUTO_FIELD_LABELS[item.field]} ${AUTO_OPERATOR_LABELS[item.operator]} ${item.value ?? ""}`).join(" AND ")}>{rule.conditions.map((item) => `${AUTO_FIELD_LABELS[item.field]} ${AUTO_OPERATOR_LABELS[item.operator]}`).join(" AND ")}</td><td>{[folder?.name, ...tags].filter(Boolean).join(", ") || "-"}</td><td>{rule.enabled ? "사용" : "중지"}</td><td><span className={`user-mail-auto-classification__event is-${rule.lastEvent?.result ?? "none"}`} title={rule.lastEvent ? `${formatMailDate(rule.lastEvent.createdAt)} · ${rule.lastEvent.reasonCode}` : "아직 실행되지 않았습니다."}>{eventLabel}</span></td><td><button type="button" aria-label={`${rule.name} 위로`} disabled={busy || index === 0} onClick={() => void move(rule, -1)}>위로</button><button type="button" aria-label={`${rule.name} 아래로`} disabled={busy || index === value.rules.length - 1} onClick={() => void move(rule, 1)}>아래로</button><button type="button" disabled={busy} onClick={() => openEditor(rule)}>수정</button><button type="button" className="is-destructive" disabled={busy} onClick={() => void onDelete([rule.ruleId])}>삭제</button></td></tr>; })}</tbody></table>}</div>
    </div>
    <footer><span /><button type="button" disabled={busy} onClick={onClose}>닫기</button></footer>
    <CommonPopup title={editor ? "자동분류 규칙 수정" : "자동분류 규칙 추가"} open={editor !== false} onClose={() => setEditor(false)} saving={busy} error={formError}>
      <div className="user-mail-auto-classification__editor">
        <label><span>규칙명</span><input autoFocus maxLength={80} value={form.name} disabled={busy} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label>
        <label className="is-inline"><input type="checkbox" checked={form.enabled} disabled={busy} onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))} /> 활성</label>
        <fieldset><legend>조건 (모두 충족)</legend>{form.conditions.map((condition, index) => <div className="user-mail-auto-classification__condition" key={index}><select aria-label={`조건 ${index + 1} 필드`} value={condition.field} onChange={(event) => { const field = event.target.value as MailAutoClassificationCondition["field"]; const next = [...form.conditions]; next[index] = { field, operator: autoOperators(field)[0], value: field === "attachment" ? null : "" }; setForm((current) => ({ ...current, conditions: next })); }} >{Object.entries(AUTO_FIELD_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select aria-label={`조건 ${index + 1} 연산자`} value={condition.operator} onChange={(event) => { const next = [...form.conditions]; next[index] = { ...condition, operator: event.target.value as MailAutoClassificationCondition["operator"] }; setForm((current) => ({ ...current, conditions: next })); }}>{autoOperators(condition.field).map((operator) => <option key={operator} value={operator}>{AUTO_OPERATOR_LABELS[operator]}</option>)}</select>{condition.field !== "attachment" ? <input aria-label={`조건 ${index + 1} 값`} maxLength={254} value={condition.value ?? ""} onChange={(event) => { const next = [...form.conditions]; next[index] = { ...condition, value: event.target.value }; setForm((current) => ({ ...current, conditions: next })); }} /> : <span>값 없음</span>}<button type="button" aria-label={`조건 ${index + 1} 삭제`} disabled={form.conditions.length <= 1} onClick={() => setForm((current) => ({ ...current, conditions: current.conditions.filter((_, itemIndex) => itemIndex !== index) }))}>삭제</button></div>)}<button type="button" disabled={form.conditions.length >= 5} onClick={() => setForm((current) => ({ ...current, conditions: [...current.conditions, { field: "subject", operator: "contains", value: "" }] }))}>조건 추가</button></fieldset>
        <label><span>보관 메일함</span><select value={form.targetFolderId ?? ""} onChange={(event) => setForm((current) => ({ ...current, targetFolderId: event.target.value || null }))}><option value="">선택 안 함</option>{value.folders.map((folder) => <option key={folder.folderId} value={folder.folderId}>{folder.name}</option>)}</select></label>
        <fieldset><legend>태그 (최대 5개)</legend><div className="user-mail-auto-classification__tags">{value.tags.map((tag) => <label key={tag.tagId}><input type="checkbox" checked={form.tagIds.includes(tag.tagId)} disabled={!form.tagIds.includes(tag.tagId) && form.tagIds.length >= 5} onChange={(event) => setForm((current) => ({ ...current, tagIds: event.target.checked ? [...current.tagIds, tag.tagId] : current.tagIds.filter((id) => id !== tag.tagId) }))} />{tag.name}</label>)}</div></fieldset>
        <div className="feedback-confirm-actions"><button type="button" disabled={busy} onClick={() => setEditor(false)}>취소</button><button type="button" disabled={busy} onClick={async () => { if (!form.name.trim()) { setFormError("규칙명을 입력해 주세요."); return; } if (form.conditions.some((item) => item.field !== "attachment" && !item.value?.trim())) { setFormError("조건 값을 입력해 주세요."); return; } if (!form.targetFolderId && !form.tagIds.length) { setFormError("메일함 또는 태그를 선택해 주세요."); return; } const message = await onSaveRule(editor || null, form); if (message) setFormError(message); else setEditor(false); }}>저장</button></div>
      </div>
    </CommonPopup>
  </section>;
}

const emptyAutoForwardException = (): MailAutoForwardExceptionPayload => ({ matcherType: "sender_email", matcherValue: "", action: "skip", targetEmails: [], enabled: true });

function MailAutoForwardingPanel({ value, loading, error, busy, onReload, onClose, onOpenTab, onChange, onSavePolicy, onAddTargets, onDeleteTargets, onSaveException, onDeleteExceptions }: {
  value: MailAutoForwardSettings | null; loading: boolean; error: string; busy: boolean;
  onReload: () => void; onClose: () => void; onOpenTab: (tab: MailSettingsTab) => void;
  onChange: (patch: Partial<MailAutoForwardSettings>) => void; onSavePolicy: () => Promise<void>;
  onAddTargets: (emails: string[]) => Promise<string | null>; onDeleteTargets: (ids: string[]) => Promise<boolean>;
  onSaveException: (item: MailAutoForwardException | null, payload: MailAutoForwardExceptionPayload) => Promise<string | null>;
  onDeleteExceptions: (ids: string[]) => Promise<boolean>;
}) {
  const [targetEditor, setTargetEditor] = useState(false); const [targetText, setTargetText] = useState(""); const [targetError, setTargetError] = useState("");
  const [exceptionEditor, setExceptionEditor] = useState<MailAutoForwardException | null | false>(false); const [exceptionForm, setExceptionForm] = useState<MailAutoForwardExceptionPayload>(emptyAutoForwardException()); const [exceptionError, setExceptionError] = useState("");
  const [selectedTargets, setSelectedTargets] = useState<string[]>([]); const [selectedExceptions, setSelectedExceptions] = useState<string[]>([]); const [activationConfirm, setActivationConfirm] = useState(false);
  if (loading && !value) return <FeedbackState state="loading" title="자동전달 설정을 불러오는 중입니다." />;
  if (!value) return <FeedbackState state="error" title="자동전달 설정을 불러오지 못했습니다." message={error} action={{ label: "다시 시도", onAction: onReload }} />;
  const externalCount = value.targets.filter((item) => item.targetKind === "external").length;
  const resultLabel = (result: { status: string } | null) => result ? ({ internal_delivered: "내부 전달", queued: "대기", blocked: "외부 발송 잠금", retry_pending: "재시도", sent: "발송 완료", failed: "실패" }[result.status] ?? result.status) : "실행 전";
  const savePolicy = async () => { if (value.enabled && value.providerLocked && externalCount > 0) setActivationConfirm(true); else await onSavePolicy(); };
  const editException = (item: MailAutoForwardException | null) => { setExceptionEditor(item); setExceptionForm(item ? { matcherType: item.matcherType, matcherValue: item.matcherValue, action: item.action, targetEmails: item.targetEmails, enabled: item.enabled } : emptyAutoForwardException()); setExceptionError(""); };
  return <section className="user-mail-settings user-mail-auto-forwarding" aria-label="자동전달 환경설정">
    <header><div><small>메일 환경설정</small><h2>자동전달</h2></div><span aria-live="polite">주소 {value.targets.length}/10 · 예외 {value.exceptions.length}/100</span><button type="button" onClick={onClose}>닫기</button></header>
    <nav aria-label="메일 설정 탭">{MAIL_SETTINGS_TABS.map((tab, index) => <button key={tab} type="button" aria-current={index === 5 ? "page" : undefined} onClick={() => onOpenTab((["basic", "signature", "mailbox", "spam", "classification", "forwarding", "outOfOffice", "external", "recent"] as const)[index])}>{tab}</button>)}</nav>
    {error ? <CompactWarning item={{ id: "auto-forwarding", source: "mail-settings", tone: "warning", title: "자동전달 설정을 처리하지 못했습니다.", message: error, action: { label: "서버 최신값 다시 불러오기", onAction: onReload } }} /> : null}
    <div className="user-mail-auto-forwarding__body">
      <section className="user-mail-auto-forwarding__policy"><label><span>자동전달 사용 <i title="스팸 판정과 자동분류 뒤 직접 수신 메일에만 적용됩니다.">i</i></span><input type="checkbox" role="switch" checked={value.enabled} disabled={busy} onChange={(event) => onChange({ enabled: event.target.checked })} /></label><label><span>원본 처리</span><select aria-label="원본 보관" value={value.keepOriginal ? "keep" : "remove"} onChange={(event) => onChange({ keepOriginal: event.target.value === "keep" })}><option value="keep">원본 보관</option><option value="remove">성공 후 원본 보관 안 함</option></select></label><button type="button" disabled={busy} onClick={() => void savePolicy()}>정책 저장</button></section>
      <section className="user-mail-auto-forwarding__group"><div className="user-mail-auto-forwarding__toolbar"><h3>자동전달 메일 주소</h3>{value.providerLocked && externalCount ? <span className="user-mail-auto-forwarding__lock" title="provider가 잠겨 있어 외부 queue는 blocked 상태로 보존됩니다.">외부 발송 잠금</span> : null}<button type="button" disabled={busy || value.targets.length >= 10} onClick={() => { setTargetText(""); setTargetError(""); setTargetEditor(true); }}>주소 추가</button><button type="button" disabled={busy || !selectedTargets.length} onClick={async () => { if (await onDeleteTargets(selectedTargets)) setSelectedTargets([]); }}>선택 삭제</button></div><div className="user-mail-auto-forwarding__table-wrap"><table><caption>기본 자동전달 주소</caption><thead><tr><th>선택</th><th>주소</th><th>대상 구분</th><th>마지막 결과</th><th>관리</th></tr></thead><tbody>{value.targets.map((item) => <tr key={item.targetId}><td><input type="checkbox" aria-label={`${item.email} 선택`} checked={selectedTargets.includes(item.targetId)} onChange={(event) => setSelectedTargets((current) => event.target.checked ? [...current, item.targetId] : current.filter((id) => id !== item.targetId))} /></td><td>{item.email}</td><td>{item.targetKind === "internal" ? "내부" : "외부"}</td><td title={item.lastResult?.reasonCode}>{resultLabel(item.lastResult)}</td><td><button type="button" disabled={busy} onClick={() => void onDeleteTargets([item.targetId])}>삭제</button></td></tr>)}</tbody></table></div></section>
      <section className="user-mail-auto-forwarding__group"><div className="user-mail-auto-forwarding__toolbar"><h3>예외 자동전달 규칙</h3><button type="button" disabled={busy || value.exceptions.length >= 100} onClick={() => editException(null)}>규칙 추가</button><button type="button" disabled={busy || !selectedExceptions.length} onClick={async () => { if (await onDeleteExceptions(selectedExceptions)) setSelectedExceptions([]); }}>선택 삭제</button></div><div className="user-mail-auto-forwarding__table-wrap"><table><caption>발신자 예외 자동전달 규칙</caption><thead><tr><th>선택</th><th>발신자</th><th>동작</th><th>대체 주소</th><th>상태</th><th>마지막 결과</th><th>관리</th></tr></thead><tbody>{value.exceptions.map((item) => <tr key={item.exceptionId}><td><input type="checkbox" aria-label={`${item.matcherValue} 선택`} checked={selectedExceptions.includes(item.exceptionId)} onChange={(event) => setSelectedExceptions((current) => event.target.checked ? [...current, item.exceptionId] : current.filter((id) => id !== item.exceptionId))} /></td><td>{item.matcherType === "sender_email" ? "이메일" : "도메인"} · {item.matcherValue}</td><td>{item.action === "skip" ? "전달 안 함" : "대체 주소로 전달"}</td><td title={item.targetEmails.join(", ")}>{item.targetEmails.join(", ") || "-"}</td><td>{item.enabled ? "사용" : "중지"}</td><td title={item.lastResult?.reasonCode}>{resultLabel(item.lastResult)}</td><td><button type="button" disabled={busy} onClick={() => editException(item)}>수정</button><button type="button" disabled={busy} onClick={() => void onDeleteExceptions([item.exceptionId])}>삭제</button></td></tr>)}</tbody></table></div></section>
    </div>
    <CommonPopup title="자동전달 메일 주소 추가" open={targetEditor} onClose={() => setTargetEditor(false)} saving={busy} error={targetError}><div className="user-mail-auto-forwarding__editor"><label>이메일 주소 (줄바꿈 또는 쉼표, 최대 10개)<textarea autoFocus value={targetText} onChange={(event) => setTargetText(event.target.value)} /></label><div className="user-mail-settings__actions"><button type="button" onClick={() => setTargetEditor(false)}>취소</button><button type="button" disabled={busy} onClick={async () => { const emails = targetText.split(/[\n,]/).map((item) => item.trim()).filter(Boolean); const result = await onAddTargets(emails); if (result) setTargetError(result); else setTargetEditor(false); }}>저장</button></div></div></CommonPopup>
    <CommonPopup title={exceptionEditor ? "예외 자동전달 규칙 수정" : "예외 자동전달 규칙 추가"} open={exceptionEditor !== false} onClose={() => setExceptionEditor(false)} saving={busy} error={exceptionError}><div className="user-mail-auto-forwarding__editor"><label>발신자 조건<select value={exceptionForm.matcherType} onChange={(event) => setExceptionForm((current) => ({ ...current, matcherType: event.target.value as MailAutoForwardExceptionPayload["matcherType"] }))}><option value="sender_email">보낸 사람 이메일</option><option value="sender_domain">보낸 사람 도메인</option></select></label><label>조건 값<input autoFocus value={exceptionForm.matcherValue} onChange={(event) => setExceptionForm((current) => ({ ...current, matcherValue: event.target.value }))} /></label><label>동작<select value={exceptionForm.action} onChange={(event) => setExceptionForm((current) => ({ ...current, action: event.target.value as MailAutoForwardExceptionPayload["action"], targetEmails: event.target.value === "skip" ? [] : current.targetEmails }))}><option value="skip">전달 안 함</option><option value="override">대체 주소로 전달</option></select></label>{exceptionForm.action === "override" ? <label>대체 주소<textarea value={exceptionForm.targetEmails.join("\n")} onChange={(event) => setExceptionForm((current) => ({ ...current, targetEmails: event.target.value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean) }))} /></label> : null}<label className="is-inline"><input type="checkbox" checked={exceptionForm.enabled} onChange={(event) => setExceptionForm((current) => ({ ...current, enabled: event.target.checked }))} />사용</label><div className="user-mail-settings__actions"><button type="button" onClick={() => setExceptionEditor(false)}>취소</button><button type="button" disabled={busy} onClick={async () => { const result = await onSaveException(exceptionEditor || null, exceptionForm); if (result) setExceptionError(result); else setExceptionEditor(false); }}>저장</button></div></div></CommonPopup>
    <CommonPopup title="자동전달 사용 확인" open={activationConfirm} onClose={() => setActivationConfirm(false)} saving={busy}><div className="user-mail-auto-forwarding__editor"><p>외부 주소 {externalCount}개가 포함되어 있습니다. provider 잠금 상태에서는 queue가 blocked로 남습니다.</p><div className="user-mail-settings__actions"><button type="button" onClick={() => setActivationConfirm(false)}>취소</button><button type="button" onClick={async () => { await onSavePolicy(); setActivationConfirm(false); }}>확인</button></div></div></CommonPopup>
  </section>;
}

function MailOutOfOfficePanel({ value, saved, loading, error, busy, onReload, onClose, onOpenTab, onChange, onSave, onCancel }: {
  value: MailOutOfOfficeSettings | null;
  saved: MailOutOfOfficeSettings | null;
  loading: boolean;
  error: string;
  busy: boolean;
  onReload: () => void;
  onClose: () => void;
  onOpenTab: (tab: MailSettingsTab) => void;
  onChange: (patch: Partial<MailOutOfOfficeSettings>) => void;
  onSave: () => Promise<void>;
  onCancel: () => void;
}) {
  const [activationConfirm, setActivationConfirm] = useState(false);
  if (loading && !value) return <FeedbackState state="loading" title="부재중응답 설정을 불러오는 중입니다." />;
  if (!value) return <FeedbackState state="error" title="부재중응답 설정을 불러오지 못했습니다." message={error} action={{ label: "다시 시도", onAction: onReload }} />;
  const dirty = Boolean(saved && JSON.stringify(value) !== JSON.stringify(saved));
  const stateLabel = { disabled: "사용 안 함", scheduled: "예약", active: "사용 중", expired: "기간 종료" }[value.state];
  const resultLabel = value.lastResult ? ({ internal_delivered: "내부 응답 완료", queued: "외부 발송 대기", blocked: "외부 발송 잠금", retry_pending: "재시도 대기", sent: "외부 발송 완료", failed: "응답 실패" }[value.lastResult.status]) : "응답 기록 없음";
  const requestSave = async () => {
    if (value.enabled && !saved?.enabled) setActivationConfirm(true);
    else await onSave();
  };
  return <section className="user-mail-settings user-mail-out-of-office" aria-label="부재중응답 환경설정">
    <header><div><small>메일 환경설정 / 부재중응답</small><h2>부재중응답</h2></div><span className={`user-mail-out-of-office__state is-${value.state}`}>{stateLabel}</span><button type="button" onClick={onClose}>닫기</button></header>
    <nav aria-label="메일 설정 탭">{MAIL_SETTINGS_TABS.map((tab, index) => <button key={tab} type="button" aria-current={index === 6 ? "page" : undefined} onClick={() => onOpenTab((["basic", "signature", "mailbox", "spam", "classification", "forwarding", "outOfOffice", "external", "recent"] as const)[index])}>{tab}</button>)}</nav>
    {error ? <CompactWarning item={{ id: "out-of-office", source: "mail-settings", tone: "warning", title: error.includes("변경") ? "다른 위치에서 설정이 변경되었습니다." : "부재중응답 설정을 처리하지 못했습니다.", message: error, action: { label: "서버 최신값 다시 불러오기", onAction: onReload } }} /> : null}
    <div className="user-mail-out-of-office__body">
      <section className="user-mail-out-of-office__summary"><div><strong>마지막 응답 결과</strong><span title={value.lastResult?.reasonCode}>{resultLabel}</span></div><div><strong>누적 응답 수</strong><span>{value.responseCount}건</span></div>{value.providerLocked ? <span className="user-mail-out-of-office__lock" title="provider가 잠겨 있어 외부 응답 queue는 blocked 상태로 보존됩니다.">외부 발송 잠금</span> : null}</section>
      <fieldset><legend>부재중응답 정책</legend>
        <label className="user-mail-out-of-office__switch"><span>부재중응답 사용 <i title="같은 기간에는 발신자별 한 번만 자동응답합니다.">i</i></span><input type="checkbox" role="switch" checked={value.enabled} disabled={busy} onChange={(event) => onChange({ enabled: event.target.checked })} /></label>
        <div className="user-mail-out-of-office__dates"><label><span>시작일</span><input type="date" value={value.startDate ?? ""} onChange={(event) => onChange({ startDate: event.target.value || null })} /></label><label><span>종료일</span><input type="date" value={value.endDate ?? ""} onChange={(event) => onChange({ endDate: event.target.value || null })} /></label></div>
        <label><span>응답 제목</span><input maxLength={200} value={value.subject} onChange={(event) => onChange({ subject: event.target.value })} /></label>
        <label><span>응답 메시지</span><textarea maxLength={4000} value={value.message} onChange={(event) => onChange({ message: event.target.value })} /></label>
        <label><span>대상 범위 <i title="내부는 같은 회사의 활성 사용자만 포함하며 등록되지 않은 회사 도메인 주소는 제외합니다.">i</i></span><select value={value.targetScope} onChange={(event) => onChange({ targetScope: event.target.value as MailOutOfOfficeSettings["targetScope"] })}><option value="all">내부 + 외부</option><option value="internal">내부만</option><option value="external">외부만</option></select></label>
      </fieldset>
    </div>
    <footer><span /><button type="button" disabled={busy || !dirty} onClick={onCancel}>취소</button><button type="button" disabled={busy || !dirty || (value.enabled && (!value.startDate || !value.endDate || !value.subject.trim() || !value.message.trim()))} onClick={() => void requestSave()}>저장</button></footer>
    <CommonPopup title="부재중응답 사용 확인" open={activationConfirm} onClose={() => setActivationConfirm(false)} saving={busy}><div className="user-mail-out-of-office__confirm"><p><strong>기간</strong> {value.startDate} ~ {value.endDate}</p><p><strong>대상 범위</strong> {value.targetScope === "all" ? "내부 + 외부" : value.targetScope === "internal" ? "내부만" : "외부만"}</p><p><strong>외부 응답</strong> {value.providerLocked ? "provider 잠금으로 blocked 보존" : "발송 대기열 등록 가능"}</p><div className="user-mail-settings__actions"><button type="button" onClick={() => setActivationConfirm(false)}>취소</button><button type="button" disabled={busy} onClick={async () => { await onSave(); setActivationConfirm(false); }}>확인</button></div></div></CommonPopup>
  </section>;
}

const formatDateTime = formatMailDate;

const emptyExternalForm = (): MailExternalAccountPayload => ({ displayName: "", host: "", port: 995, tlsMode: "ssl", username: "", password: "", targetFolderId: null, deleteFromServer: false, enabled: false });

function MailExternalPanel({ value, folders, loading, error, busy, onReload, onClose, onOpenTab, onSave, onDelete, onBulkDelete, onTest, onCollect }: {
  value: MailExternalAccountList | null; folders: MailFolder[]; loading: boolean; error: string; busy: boolean;
  onReload: () => void; onClose: () => void; onOpenTab: (tab: MailSettingsTab) => void;
  onSave: (item: MailExternalAccount | null, form: MailExternalAccountPayload) => Promise<string | null>;
  onDelete: (id: string) => Promise<void>; onBulkDelete: (ids: string[]) => Promise<void>;
  onTest: (id: string) => Promise<void>; onCollect: (id: string) => Promise<void>;
}) {
  const [editor, setEditor] = useState<MailExternalAccount | null | false>(false);
  const [form, setForm] = useState<MailExternalAccountPayload>(emptyExternalForm());
  const [savedForm, setSavedForm] = useState<MailExternalAccountPayload>(emptyExternalForm());
  const [selected, setSelected] = useState<string[]>([]); const [formError, setFormError] = useState(""); const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [externalDeleteConfirmPopup, setExternalDeleteConfirmPopup] = useState(false);
  const externalAccountDirty = editor !== false && JSON.stringify(form) !== JSON.stringify(savedForm);
  const requestCloseEditor = () => { if (externalAccountDirty && !window.confirm("저장하지 않은 외부메일 변경을 취소할까요?")) return; setEditor(false); setFormError(""); };
  const requestLeave = (action: () => void) => { if (externalAccountDirty && !window.confirm("저장하지 않은 외부메일 변경을 취소하고 이동할까요?")) return; setEditor(false); setFormError(""); action(); };
  const lastJobLabel = (item: MailExternalAccount) => item.lastJob ? `${item.lastJob.status === "completed" ? "성공" : item.lastJob.status === "partial" ? "부분 성공" : item.lastJob.status === "failed" ? "실패" : "진행 중"} · 신규 ${item.lastJob.importedCount} · 중복 ${item.lastJob.duplicateCount} · 삭제 ${item.lastJob.deletedCount} · 실패 ${item.lastJob.failedCount}` : "실행 전";
  const commitExternalForm = async () => { const message=await onSave(editor||null,form); if(message)setFormError(message); else { setEditor(false); setExternalDeleteConfirmPopup(false); } };
  const edit = (item: MailExternalAccount | null) => {
    const next = item ? { displayName:item.display_name, host:item.host, port:item.port, tlsMode:item.tls_mode, username:item.username, password:"", targetFolderId:item.target_folder_id, deleteFromServer:item.delete_from_server, enabled:item.enabled, expectedVersion:item.version } : emptyExternalForm();
    setEditor(item); setForm(next); setSavedForm(next); setFormError("");
  };
  if (loading && !value) return <FeedbackState state="loading" title="외부메일 설정을 불러오는 중입니다." />;
  if (!value) return <FeedbackState state="error" title="외부메일 설정을 불러오지 못했습니다." message={error} action={{ label:"다시 시도", onAction:onReload }} />;
  return <section className="user-mail-settings user-mail-external" aria-label="외부메일 환경설정">
    <header><div><small>메일 환경설정 / 외부메일</small><h2>외부메일</h2></div><span>계정 {value.accountCount}/5 · 동작 중 {value.activeJobCount}</span><button type="button" onClick={()=>requestLeave(onClose)}>닫기</button></header>
    <nav aria-label="메일 설정 탭">{MAIL_SETTINGS_TABS.map((tab,index)=><button key={tab} type="button" aria-current={index===7?"page":undefined} onClick={()=>requestLeave(()=>onOpenTab((["basic","signature","mailbox","spam","classification","forwarding","outOfOffice","external","recent"] as const)[index]))}>{tab}</button>)}</nav>
    {error ? <CompactWarning item={{id:"external-mail",source:"mail-settings",tone:"warning",title:"외부메일 설정을 처리하지 못했습니다.",message:error,action:{label:"새로고침",onAction:onReload}}} /> : null}
    <div className="user-mail-external__toolbar"><button type="button" disabled={busy||value.accountCount>=5} onClick={()=>edit(null)}>추가</button><button type="button" disabled={busy||!selected.length} onClick={()=>void onBulkDelete(selected).then(()=>setSelected([]))}>전체삭제</button><button type="button" disabled={busy} onClick={onReload}>새로고침</button><i title="POP3 SSL(995) 또는 STARTTLS(110)만 지원하며 비밀번호는 화면에 다시 표시하지 않습니다.">i</i></div>
    {value.accounts.some(item=>item.lastJob) ? <div className="user-mail-external__results" aria-label="최근 수집 결과">{value.accounts.filter(item=>item.lastJob).map(item=><span key={item.id} title={item.lastJob?.errorCode??""}><strong>{item.display_name}</strong> {lastJobLabel(item)} · {item.lastJob?.completedAt?formatMailDate(item.lastJob.completedAt):"-"}</span>)}</div> : null}
    <div className="user-mail-external__table-wrap"><table><caption>외부메일 계정 목록</caption><thead><tr><th>선택</th><th>서버</th><th>포트</th><th>보안연결</th><th>아이디</th><th>저장 메일함</th><th>원본 삭제</th><th>상태</th><th>마지막 수집</th><th>관리</th></tr></thead><tbody>
      {!value.accounts.length ? <tr><td colSpan={10}><div className="user-mail-external__empty">설정된 외부메일이 없습니다.<button type="button" onClick={()=>edit(null)}>추가</button></div></td></tr> : value.accounts.map(item=><tr key={item.id}><td><input type="checkbox" aria-label={`${item.display_name} 선택`} checked={selected.includes(item.id)} onChange={e=>setSelected(current=>e.target.checked?[...current,item.id]:current.filter(id=>id!==item.id))}/></td><td>{item.host}</td><td>{item.port}</td><td>{item.tls_mode==="ssl"?"SSL":"STARTTLS"}</td><td>{item.username}</td><td>{item.target_folder_id ? folders.find(f=>f.folderId===item.target_folder_id)?.name ?? "받은편지함" : "받은편지함"}</td><td>{item.delete_from_server?"삭제":"보관"}</td><td>{item.connection_status==="success"?(item.enabled?"사용 중":"검증 완료"):item.connection_status==="failed"?"검증 실패":"연결 테스트 필요"}</td><td>{item.last_collect_at?formatDateTime(item.last_collect_at):"실행 전"}</td><td><button type="button" disabled={busy} onClick={()=>edit(item)}>수정</button><button type="button" disabled={busy} onClick={()=>void onTest(item.id)}>연결 테스트</button><button type="button" disabled={busy||item.connection_status!=="success"} onClick={()=>void onCollect(item.id)}>지금 수집</button><button type="button" disabled={busy} onClick={()=>void onDelete(item.id)}>삭제</button></td></tr>)}</tbody></table></div>
    <CommonPopup title={editor?"외부메일 수정":"외부메일 추가"} open={editor!==false} onClose={requestCloseEditor} saving={busy} error={formError}><div className="user-mail-external__editor">
      <label>별칭<input maxLength={50} value={form.displayName} onChange={e=>setForm(c=>({...c,displayName:e.target.value}))}/></label><label>POP3 서버<input maxLength={253} value={form.host} onChange={e=>setForm(c=>({...c,host:e.target.value}))}/></label>
      <label>보안연결<select value={form.tlsMode} onChange={e=>{const tlsMode=e.target.value as "ssl"|"starttls";setForm(c=>({...c,tlsMode,port:tlsMode==="ssl"?995:110}))}}><option value="ssl">SSL (995)</option><option value="starttls">STARTTLS (110)</option></select></label><label>포트<input readOnly value={form.port}/></label>
      <label>아이디<input maxLength={254} value={form.username} onChange={e=>setForm(c=>({...c,username:e.target.value}))}/></label><label>비밀번호<input type="password" autoComplete="new-password" placeholder={editor&&editor.passwordConfigured?"변경할 때만 입력":"비밀번호 입력"} value={form.password??""} onChange={e=>setForm(c=>({...c,password:e.target.value}))}/></label>
      <label>저장 메일함<select value={form.targetFolderId??""} onChange={e=>setForm(c=>({...c,targetFolderId:e.target.value||null}))}><option value="">받은편지함</option>{folders.map(f=><option key={f.folderId} value={f.folderId}>{f.name}</option>)}</select></label>
      <label className="is-inline"><input type="checkbox" checked={form.deleteFromServer} onChange={e=>setForm(c=>({...c,deleteFromServer:e.target.checked}))}/>서버 원본 삭제 <i title="로컬 저장이 완료된 메일만 서버에서 삭제합니다.">i</i></label>{form.deleteFromServer?<label className="is-inline"><input type="checkbox" checked={deleteConfirm} onChange={e=>setDeleteConfirm(e.target.checked)}/>원본 삭제 위험을 확인했습니다.</label>:null}
      <label className="is-inline"><input type="checkbox" checked={form.enabled} disabled={!editor||editor.connection_status!=="success"} onChange={e=>setForm(c=>({...c,enabled:e.target.checked}))}/>자동 수집 사용</label>
      <div className="user-mail-settings__actions"><button type="button" onClick={requestCloseEditor}>취소</button><button type="button" disabled={busy||!form.displayName.trim()||!form.host.trim()||!form.username.trim()||(!editor&&!form.password?.trim())|| (form.deleteFromServer&&!deleteConfirm)} onClick={()=>{if(form.deleteFromServer)setExternalDeleteConfirmPopup(true);else void commitExternalForm()}}>저장</button></div>
    </div></CommonPopup>
    <CommonPopup title="서버 원본 삭제 확인" open={externalDeleteConfirmPopup} onClose={()=>setExternalDeleteConfirmPopup(false)} saving={busy}><div className="user-mail-external__editor"><p>로컬 저장이 완료된 메일만 외부 서버에서 삭제합니다. 이 설정으로 저장할까요?</p><div className="user-mail-settings__actions"><button type="button" onClick={()=>setExternalDeleteConfirmPopup(false)}>취소</button><button type="button" disabled={busy} onClick={()=>void commitExternalForm()}>확인</button></div></div></CommonPopup>
  </section>;
}

function MailRecentRecipientsPanel({ value, loading, error, busy, onReload, onClose, onOpenTab, onDelete }: {
  value: MailRecentRecipientSettingsResponse | null;
  loading: boolean;
  error: string;
  busy: boolean;
  onReload: () => void;
  onClose: () => void;
  onOpenTab: (tab: MailSettingsTab) => void;
  onDelete: (payload: { recipientIds?: string[]; deleteAll?: boolean }) => Promise<boolean>;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<{ recipientIds?: string[]; deleteAll?: boolean; label: string } | null>(null);
  const recipients = value?.recipients ?? [];
  const selectedExisting = selected.filter((id) => recipients.some((item) => item.recipientId === id));
  const allSelected = recipients.length > 0 && selectedExisting.length === recipients.length;
  const tabs: MailSettingsTab[] = ["basic", "signature", "mailbox", "spam", "classification", "forwarding", "outOfOffice", "external", "recent"];
  if (loading && !value) return <FeedbackState state="loading" title="최근 보낸 메일주소를 불러오는 중입니다." />;
  if (!value) return <FeedbackState state="error" title="최근 보낸 메일주소를 불러오지 못했습니다." message={error} action={{ label: "다시 시도", onAction: onReload }} />;
  return <section className="user-mail-settings user-mail-recent" aria-label="최근보낸메일 환경설정">
    <header><div><small>메일 환경설정 / 최근보낸메일</small><h2>최근보낸메일</h2></div><span aria-live="polite">주소 {value.totalCount}개</span><button type="button" onClick={onClose}>닫기</button></header>
    <nav aria-label="메일 설정 탭">{MAIL_SETTINGS_TABS.map((tab,index)=><button key={tab} type="button" aria-current={index===8?"page":undefined} onClick={()=>onOpenTab(tabs[index])}>{tab}</button>)}</nav>
    {error ? <CompactWarning item={{ id: "recent-mail", source: "mail-settings", tone: "warning", title: "최근 주소를 처리하지 못했습니다.", message: error, action: { label: "새로고침", onAction: onReload } }} /> : null}
    <div className="user-mail-recent__body">
      <div className="user-mail-recent__toolbar">
        <label title="현재 최근 주소 전체 선택"><input type="checkbox" aria-label="전체 선택" checked={allSelected} disabled={busy || !recipients.length} onChange={(event) => setSelected(event.target.checked ? recipients.flatMap((item) => item.recipientId ? [item.recipientId] : []) : [])} />전체 선택</label>
        <button type="button" disabled={busy || !selectedExisting.length} onClick={() => setDeleteTarget({ recipientIds: selectedExisting, label: `선택한 ${selectedExisting.length}개 주소` })}>선택 삭제</button>
        <button type="button" className="is-destructive" disabled={busy || !recipients.length} onClick={() => setDeleteTarget({ deleteAll: true, label: `최근 주소 ${recipients.length}개 전체` })}>전체 삭제</button>
        <button type="button" disabled={busy} onClick={onReload}>새로고침</button>
        <i title="최근 주소는 실제 발송 완료 시 등록되며 삭제해도 원본 메일과 수신확인에는 영향이 없습니다.">i</i>
      </div>
      <div className="user-mail-recent__table-wrap"><table><caption>최근 보낸메일 주소 목록</caption><thead><tr><th>선택</th><th>이메일 주소</th><th>이름 / 부서</th><th>마지막 사용</th><th>사용 횟수</th><th>관리</th></tr></thead><tbody>
        {!recipients.length ? <tr><td colSpan={6}><div className="user-mail-recent__empty">최근 보낸 메일주소가 없습니다.</div></td></tr> : recipients.map((item) => <tr key={item.recipientId ?? item.email}>
          <td><input type="checkbox" aria-label={`${item.email} 선택`} checked={Boolean(item.recipientId && selectedExisting.includes(item.recipientId))} disabled={busy || !item.recipientId} onChange={(event) => item.recipientId && setSelected((current) => event.target.checked ? [...current, item.recipientId as string] : current.filter((id) => id !== item.recipientId))} /></td>
          <td><strong>{item.email}</strong></td><td>{item.name ?? "-"}<small>{item.departmentName ?? "외부 주소"}</small></td><td>{formatMailDate(item.lastUsedAt)}</td><td>{item.useCount}회</td>
          <td><button type="button" disabled={busy || !item.recipientId} onClick={() => item.recipientId && setDeleteTarget({ recipientIds: [item.recipientId], label: item.email })}>삭제</button></td>
        </tr>)}
      </tbody></table></div>
    </div>
    <ConfirmModal open={deleteTarget !== null} title="최근 주소 삭제 확인" message={<><strong>{deleteTarget?.label}</strong>을 최근 목록에서 삭제합니다. 원본 메일은 유지됩니다.</>} confirmLabel="삭제" busy={busy} onCancel={() => setDeleteTarget(null)} onConfirm={async () => { if (deleteTarget && await onDelete(deleteTarget)) { setDeleteTarget(null); setSelected([]); } }} />
  </section>;
}

function hasExternalRecipients(recipients: string[], companyDomain: string): boolean {
  const suffix = `@${companyDomain.trim().toLowerCase()}`;
  return recipients.some((item) => !item.endsWith(suffix));
}

export default function App() {
  const [token, setToken] = useState("");
  const [locale, setLocale] = useState<AppLocale>(resolveLocale(window.localStorage.getItem("moaworks.locale")));
  const [timezone, setTimezone] = useState(window.localStorage.getItem("moaworks.timezone") || "Asia/Seoul");
  const [uiContract, setUiContract] = useState<UiContract>(() => defaultUiContract);
  const [searchText, setSearchText] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchFilter, setSearchFilter] = useState<"all" | UnifiedSearchType>("all");
  const [searchResults, setSearchResults] = useState<UnifiedSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchWorkspaceSelection, setSearchWorkspaceSelection] = useState<{ menu: "schedule" | "contacts" | "org" | "files"; id: string } | null>(null);
  const [loginForm, setLoginForm] = useState<LoginForm>({ loginId: "", password: "" });
  const [passwordChangeForm, setPasswordChangeForm] = useState<PasswordChangeForm>({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [createForm, setCreateForm] = useState<CreateForm>({
    title: "", content: "", approverUserIds: [], referenceUserIds: [], viewerUserIds: [], urgent: false, shareWithDepartment: false,
  });
  const [approvalModal, setApprovalModal] = useState<ApprovalModalMode>("none");
  const [approvalActionTarget, setApprovalActionTarget] = useState<ApprovalActionTarget | null>(null);
  const [approvalEditorDocumentId, setApprovalEditorDocumentId] = useState("");
  const [approvalComposeTab, setApprovalComposeTab] = useState<"document" | "line">("document");
  const [approvalRetainedAttachments, setApprovalRetainedAttachments] = useState<ApprovalAttachment[]>([]);
  const [approvalPendingFiles, setApprovalPendingFiles] = useState<ApprovalPendingFile[]>([]);
  const [approvalComposeBaseline, setApprovalComposeBaseline] = useState("");
  const [approvalShellMenu, setApprovalShellMenu] = useState<ApprovalShellMenuKey>("pending");
  const [selectedApprovalId, setSelectedApprovalId] = useState("");
  const [approvalStatusFilter, setApprovalStatusFilter] = useState("all");
  const [approvalSearch, setApprovalSearch] = useState("");
  const [approverSearch, setApproverSearch] = useState("");
  const [approvalApprovers, setApprovalApprovers] = useState<ApprovalApprover[]>([]);
  const [approvalLogs, setApprovalLogs] = useState<AuditLog[]>([]);
  const [selectedApprovalDetail, setSelectedApprovalDetail] = useState<ApprovalDocumentDetail | null>(null);
  const [approvalDetailLoading, setApprovalDetailLoading] = useState(false);
  const [approvalDetailError, setApprovalDetailError] = useState("");
  const [approvalAttachmentError, setApprovalAttachmentError] = useState("");
  const [approvalLogsLoading, setApprovalLogsLoading] = useState(false);
  const [approvalLogsError, setApprovalLogsError] = useState("");
  const [approvalDetailMaximized, setApprovalDetailMaximized] = useState(false);
  const [approvalLineModalOpen, setApprovalLineModalOpen] = useState(false);
  const [approvalHistoryModalOpen, setApprovalHistoryModalOpen] = useState(false);
  const [approvalPreferences, setApprovalPreferences] = useState<ApprovalBasicPreferences | null>(null);
  const [approvalPreferencesDraft, setApprovalPreferencesDraft] = useState<ApprovalPreferenceDraft>({
    writingMethod: "general",
    attachmentImageDisplay: "thumbnail",
    signatureName: "",
    removeSignature: false,
  });
  const [approvalPreferencesBaseline, setApprovalPreferencesBaseline] = useState("");
  const [approvalPreferencesLoading, setApprovalPreferencesLoading] = useState(false);
  const [approvalPreferencesSaving, setApprovalPreferencesSaving] = useState(false);
  const [approvalPreferencesError, setApprovalPreferencesError] = useState("");
  const [approvalSettingsTab, setApprovalSettingsTab] = useState<"basic" | "delegation">("basic");
  const [approvalDelegations, setApprovalDelegations] = useState<ApprovalDelegation[]>([]);
  const [approvalDelegationsTotal, setApprovalDelegationsTotal] = useState(0);
  const [approvalDelegationsPage, setApprovalDelegationsPage] = useState(1);
  const [approvalDelegationsLoading, setApprovalDelegationsLoading] = useState(false);
  const [approvalDelegationsError, setApprovalDelegationsError] = useState("");
  const [selectedApprovalDelegationId, setSelectedApprovalDelegationId] = useState("");
  const [approvalDelegationPopupMode, setApprovalDelegationPopupMode] = useState<"none" | "create" | "edit">("none");
  const [approvalDelegationDraft, setApprovalDelegationDraft] = useState<ApprovalDelegationDraft>(emptyApprovalDelegationDraft);
  const [approvalDelegationBaseline, setApprovalDelegationBaseline] = useState("");
  const [approvalDelegationSaving, setApprovalDelegationSaving] = useState(false);
  const [approvalDelegationError, setApprovalDelegationError] = useState("");
  const [approvalDelegationSearch, setApprovalDelegationSearch] = useState("");
  const [approvalDelegationCandidatesLoading, setApprovalDelegationCandidatesLoading] = useState(false);
  const [approvalDelegationCandidatesError, setApprovalDelegationCandidatesError] = useState("");
  const [approvalDelegationDeleteTarget, setApprovalDelegationDeleteTarget] = useState<ApprovalDelegation | null>(null);
  const [approvalSignatureFile, setApprovalSignatureFile] = useState<File | null>(null);
  const [approvalSignaturePreviewUrl, setApprovalSignaturePreviewUrl] = useState("");
  const [approvalPendingMenu, setApprovalPendingMenu] = useState<ApprovalShellMenuKey | null>(null);
  const [approvalPendingPortalMenu, setApprovalPendingPortalMenu] = useState<UserPortalMenu | null>(null);
  const [approvalLineSignatureUrls, setApprovalLineSignatureUrls] = useState<Record<string, string>>({});
  const [approvalAttachmentPreviewUrls, setApprovalAttachmentPreviewUrls] = useState<Record<string, string>>({});
  const approvalSettingsObjectUrl = useRef("");
  const approvalDetailObjectUrls = useRef<string[]>([]);
  const approvalRequestSequence = useRef(0);
  const approvalComposeCloseRequestRef = useRef<(() => void) | null>(null);
  const approvalDelegationCloseRequestRef = useRef<(() => void) | null>(null);
  const approvalDelegationCandidatesRequestRef = useRef<{ token: string; request: Promise<{ users: ApprovalApprover[] }> } | null>(null);
  const approvalDelegationCandidatesLoadedTokenRef = useRef("");
  const [loading, setLoading] = useState(false);
  const [approvalError, setApprovalError] = useState("");
  const approvalComposeSnapshot = useMemo(
    () => buildApprovalComposeSnapshot(
      createForm,
      approvalRetainedAttachments.map((item) => item.attachmentId),
      approvalPendingFiles.map((item) => ({ name: item.file.name, size: item.file.size })),
    ),
    [approvalPendingFiles, approvalRetainedAttachments, createForm],
  );
  const approvalComposeDirty = Boolean(approvalComposeBaseline) && approvalComposeSnapshot !== approvalComposeBaseline;
  const approvalPreferencesSnapshot = useMemo(
    () => buildApprovalPreferenceSnapshot(approvalPreferencesDraft),
    [approvalPreferencesDraft],
  );
  const approvalPreferencesDirty = Boolean(approvalPreferencesBaseline)
    && approvalPreferencesSnapshot !== approvalPreferencesBaseline;
  const approvalDelegationSnapshot = useMemo(
    () => buildApprovalDelegationSnapshot(approvalDelegationDraft),
    [approvalDelegationDraft],
  );
  const approvalDelegationDirty = Boolean(approvalDelegationBaseline)
    && approvalDelegationSnapshot !== approvalDelegationBaseline;
  const [documents, setDocuments] = useState<ApprovalDocument[]>([]);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [notificationSummary, setNotificationSummary] = useState<NotificationSummary | null>(null);
  const [notificationError, setNotificationError] = useState("");
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [homeSchedules, setHomeSchedules] = useState<WorkspaceSchedule[]>([]);
  const [homeNotices, setHomeNotices] = useState<WorkspaceNotice[]>([]);
  const [selectedNotice, setSelectedNotice] = useState<WorkspaceNotice | null>(null);
  const [homeLoading, setHomeLoading] = useState(false);
  const [homeError, setHomeError] = useState("");
  const [homeScheduleSelectionId, setHomeScheduleSelectionId] = useState("");
  const [reasonAction, setReasonAction] = useState<ReasonAction>({ documentId: "", reason: "" });
  const { items: feedbackItems, push: pushFeedback, dismiss: dismissFeedback, clearTransient: clearTransientFeedback } = useFeedbackQueue();
  const [mailDeleteConfirmOpen, setMailDeleteConfirmOpen] = useState(false);
  const [mailComposeCloseConfirmOpen, setMailComposeCloseConfirmOpen] = useState(false);
  const [mailBulkBusy, setMailBulkBusy] = useState(false);
  function setMessage(nextMessage: string) {
    if (!nextMessage) {
      clearTransientFeedback();
      return;
    }
    pushFeedback({
      id: `app:${activePortalMenu}:${nextMessage}`,
      source: activePortalMenu,
      tone: "success",
      title: nextMessage,
    });
  }
  const [translationStatus, setTranslationStatus] = useState<{ provider: string; enabled: boolean; available: boolean } | null>(null);
  const [translationSource, setTranslationSource] = useState("");
  const [translationTargetLocale, setTranslationTargetLocale] = useState("en");
  const [translationResult, setTranslationResult] = useState<TranslationItem[]>([]);
  const [translationLoading, setTranslationLoading] = useState(false);
  const [translationError, setTranslationError] = useState("");
  const [mailTranslationKind, setMailTranslationKind] = useState<"incoming" | "outgoing" | null>(null);
  const [mailTranslationPreview, setMailTranslationPreview] = useState<{ subject: string; body: string; segments?: Array<{ id: string; text: string }>; sourceSnapshot?: { subject: string; documentKey: string }; mailId?: string } | null>(null);
  const [outgoingTranslationTargetLocale, setOutgoingTranslationTargetLocale] = useState("en");
  const [outgoingTranslationOpen, setOutgoingTranslationOpen] = useState(false);
  const [showTranslatedMail, setShowTranslatedMail] = useState(false);
  const translationUiVisible = translationStatus?.available === true;
  const [me, setMe] = useState<AuthUser | null>(null);
  const [headerProfile, setHeaderProfile] = useState<WorkspaceProfile | null>(null);
  const [headerProfilePhotoUrl, setHeaderProfilePhotoUrl] = useState("");
  const headerProfilePhotoUrlRef = useRef("");
  const [logsCount, setLogsCount] = useState(0);
  const [notificationMode, setNotificationMode] = useState<"polling" | "streaming" | "fallback">("polling");
  const [showNotificationPanel, setShowNotificationPanel] = useState(false);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceTab>("mail");
  const [activePortalMenu, setActivePortalMenu] = useState<UserPortalMenu>("home");
  const [calendarSettingsRequestKey, setCalendarSettingsRequestKey] = useState(0);
  const appliedPreferenceTokenRef = useRef("");
  const [activeMailbox, setActiveMailbox] = useState<MailboxType>("inbox");
  const [activeMailFolder, setActiveMailFolder] = useState<MailFolderType>("inbox");
  const [quickComposeMode, setQuickComposeMode] = useState<QuickComposeMode>("none");
  const [showQuickComposePicker, setShowQuickComposePicker] = useState(false);
  const [selectedContactEmail, setSelectedContactEmail] = useState("");
  const [selectedOrgMember, setSelectedOrgMember] = useState("");
  const [selectedFileId, setSelectedFileId] = useState("");
  const [mailFoldersData, setMailFoldersData] = useState<MailFolder[]>([]);
  const [mailTagsData, setMailTagsData] = useState<MailTag[]>([]);
  const [mailContextMails, setMailContextMails] = useState<MailSummary[]>([]);
  const [mailResourceModal, setMailResourceModal] = useState<"none" | "folder" | "tag">("none");
  const [mailResourceEditId, setMailResourceEditId] = useState("");
  const [mailResourceName, setMailResourceName] = useState("");
  const [mailTagColor, setMailTagColor] = useState<MailTag["color"]>("gray");
  const [mailMoveFolderId, setMailMoveFolderId] = useState("");
  const [mailTargetTagId, setMailTargetTagId] = useState("");
  const [mailPurgeConfirmOpen, setMailPurgeConfirmOpen] = useState(false);
  const [mailResourceDelete, setMailResourceDelete] = useState<{ kind: "folder" | "tag"; id: string; name: string } | null>(null);
  const [inboxMails, setInboxMails] = useState<MailSummary[]>([]);
  const [sentMails, setSentMails] = useState<MailSummary[]>([]);
  const [draftMails, setDraftMails] = useState<MailSummary[]>([]);
  const [scheduledMails, setScheduledMails] = useState<MailSummary[]>([]);
  const [selectedMailId, setSelectedMailId] = useState("");
  const [selectedMailIds, setSelectedMailIds] = useState<string[]>([]);
  const [mailListQuery, setMailListQuery] = useState<MailListQuery>(DEFAULT_MAIL_LIST_QUERY);
  const [mailSearchDraft, setMailSearchDraft] = useState("");
  const [mailListMeta, setMailListMeta] = useState({ total: 0, limit: 50, offset: 0, hasMore: false });
  const [mailMoveCategory, setMailMoveCategory] = useState("primary");
  const [mailBulkReloadError, setMailBulkReloadError] = useState("");
  const [composeWindow, setComposeWindow] = useState<"normal" | "minimized" | "maximized">("normal");
  const [mailComposeContext, setMailComposeContext] = useState<MailComposeContext>("new");
  const [mailComposePosition, setMailComposePosition] = useState<{ left: number; top: number } | null>(null);
  const [mailDetailExpanded, setMailDetailExpanded] = useState(false);
  const [selectedMailDetail, setSelectedMailDetail] = useState<MailDetail | null>(null);
  const [mailDetailInlinePreviewUrls, setMailDetailInlinePreviewUrls] = useState<Record<string, string>>({});
  const [showRemoteMailImages, setShowRemoteMailImages] = useState(false);
  const [mailReadReceiptOpen, setMailReadReceiptOpen] = useState(false);
  const [mailDetailLoading, setMailDetailLoading] = useState(false);
  const [mailDetailError, setMailDetailError] = useState("");
  const [mailDeliveryStatus, setMailDeliveryStatus] = useState<MailDeliveryStatusResponse | null>(null);
  const [mailComposeForm, setMailComposeForm] = useState<MailComposeForm>(createEmptyMailComposeForm);
  const [mailComposeFiles, setMailComposeFiles] = useState<MailComposeFile[]>([]);
  const [mailComposeInlineImages, setMailComposeInlineImages] = useState<MailComposeInlineImage[]>([]);
  const mailComposeInlineImagesRef = useRef<MailComposeInlineImage[]>([]);
  const mailComposeInlineImageRequestRef = useRef(0);
  const [mailComposeSourceDetail, setMailComposeSourceDetail] = useState<MailDetail | null>(null);
  const [mailComposeSourceMailId, setMailComposeSourceMailId] = useState("");
  const [editingScheduledMailId, setEditingScheduledMailId] = useState("");
  const [editingDraftMailId, setEditingDraftMailId] = useState("");
  const [mailComposePersistedAttachments, setMailComposePersistedAttachments] = useState<MailAttachmentView[]>([]);
  const mailComposeToRef = useRef<HTMLInputElement>(null);
  const [selectedForwardAttachmentIds, setSelectedForwardAttachmentIds] = useState<string[]>([]);
  const [recipientPickerTarget, setRecipientPickerTarget] = useState<RecipientPickerTarget | null>(null);
  const [recipientSuggestions, setRecipientSuggestions] = useState<RecipientSuggestion[]>([]);
  const [recipientPickerSource, setRecipientPickerSource] = useState<RecipientPickerSource>("contact");
  const [recipientPickerQuery, setRecipientPickerQuery] = useState("");
  const selectedForwardAttachments = mailComposeSourceDetail?.attachments.filter((item) => item.disposition !== "inline" && selectedForwardAttachmentIds.includes(item.attachmentId)) ?? [];
  const mailComposeReferencedContentIds = new Set(projectMailDocument(mailComposeForm.bodyDocument).contentIds);
  const mailComposeRetainedAttachments = mailComposePersistedAttachments.filter((attachment) => (
    attachment.disposition !== "inline" || Boolean(attachment.contentId && mailComposeReferencedContentIds.has(attachment.contentId))
  ));
  const mailComposeRetainedOrdinaryAttachments = mailComposeRetainedAttachments.filter((attachment) => attachment.disposition !== "inline");
  const mailComposeStagedInlineImages = mailComposeInlineImages.filter((image) => image.origin === "staged");
  const selectedForwardInlineAttachments = mailComposeSourceDetail?.attachments.filter((item) => (
    item.disposition === "inline"
    && selectedForwardAttachmentIds.includes(item.attachmentId)
    && Boolean(item.contentId && mailComposeReferencedContentIds.has(item.contentId))
  )) ?? [];

  async function refreshHeaderProfile() {
    if (!token || !me) return;
    const profile = await fetchWorkspaceProfile(token);
    let nextUrl = "";
    if (profile.photoAvailable) {
      const blob = await fetchWorkspaceProfilePhoto(token);
      if (blob) nextUrl = URL.createObjectURL(blob);
    }
    if (headerProfilePhotoUrlRef.current) URL.revokeObjectURL(headerProfilePhotoUrlRef.current);
    headerProfilePhotoUrlRef.current = nextUrl;
    setHeaderProfile(profile); setHeaderProfilePhotoUrl(nextUrl);
  }
  const mailComposeNewAttachmentBytes = mailComposeFiles.reduce((sum, item) => sum + item.file.size, 0);
  const mailComposeInlineImageBytes = mailComposeStagedInlineImages.reduce((sum, item) => sum + item.sizeBytes, 0);
  const mailComposeSourceAttachmentBytes = selectedForwardAttachments.reduce((sum, item) => sum + item.sizeBytes, 0);
  const mailComposeSourceInlineAttachmentBytes = selectedForwardInlineAttachments.reduce((sum, item) => sum + item.sizeBytes, 0);
  const mailComposeRetainedAttachmentBytes = mailComposeRetainedAttachments.reduce((sum, item) => sum + item.sizeBytes, 0);
  const mailComposeAttachmentBytes = mailComposeNewAttachmentBytes + mailComposeInlineImageBytes + mailComposeSourceAttachmentBytes + mailComposeSourceInlineAttachmentBytes + mailComposeRetainedAttachmentBytes;
  const mailComposeAttachmentCount = mailComposeFiles.length + mailComposeStagedInlineImages.length + selectedForwardAttachments.length + selectedForwardInlineAttachments.length + mailComposeRetainedAttachments.length;
  const [recipientPickerLoading, setRecipientPickerLoading] = useState(false);
  const [mailError, setMailError] = useState("");
  const [mailLoading, setMailLoading] = useState(false);
  const [mailCategoryBusy, setMailCategoryBusy] = useState(false);
  const [mailStorage, setMailStorage] = useState<MailStorageResponse | null>(null);
  const [mailStorageLoading, setMailStorageLoading] = useState(false);
  const [mailStorageError, setMailStorageError] = useState("");
  const [mailSettingsOpen, setMailSettingsOpen] = useState(false);
  const [mailPreferences, setMailPreferences] = useState<MailBasicPreferences | null>(null);
  const [savedMailPreferences, setSavedMailPreferences] = useState<MailBasicPreferences | null>(null);
  const [mailPreferencesLoading, setMailPreferencesLoading] = useState(false);
  const [mailPreferencesError, setMailPreferencesError] = useState("");
  const [mailPreferencesConflict, setMailPreferencesConflict] = useState(false);
  const [mailSettingsTab, setMailSettingsTab] = useState<MailSettingsTab>("basic");
  const [mailSignatures, setMailSignatures] = useState<MailSignaturePreferences | null>(null);
  const [savedMailSignatures, setSavedMailSignatures] = useState<MailSignaturePreferences | null>(null);
  const [mailSignaturesLoading, setMailSignaturesLoading] = useState(false);
  const [mailSignaturesError, setMailSignaturesError] = useState("");
  const [mailSignaturesConflict, setMailSignaturesConflict] = useState(false);
  const [mailboxSettings, setMailboxSettings] = useState<MailMailboxSettingsResponse | null>(null);
  const [mailboxSettingsLoading, setMailboxSettingsLoading] = useState(false);
  const [mailboxSettingsError, setMailboxSettingsError] = useState("");
  const [mailboxSettingsBusyKey, setMailboxSettingsBusyKey] = useState("");
  const [spamSettings, setSpamSettings] = useState<MailSpamSettingsResponse | null>(null);
  const [spamSettingsLoading, setSpamSettingsLoading] = useState(false);
  const [spamSettingsError, setSpamSettingsError] = useState("");
  const [spamSettingsBusy, setSpamSettingsBusy] = useState(false);
  const [autoClassificationSettings, setAutoClassificationSettings] = useState<MailAutoClassificationSettings | null>(null);
  const [autoClassificationLoading, setAutoClassificationLoading] = useState(false);
  const [autoClassificationError, setAutoClassificationError] = useState("");
  const [autoClassificationBusy, setAutoClassificationBusy] = useState(false);
  const [autoForwardSettings, setAutoForwardSettings] = useState<MailAutoForwardSettings | null>(null);
  const [autoForwardLoading, setAutoForwardLoading] = useState(false);
  const [autoForwardError, setAutoForwardError] = useState("");
  const [autoForwardBusy, setAutoForwardBusy] = useState(false);
  const [outOfOfficeSettings, setOutOfOfficeSettings] = useState<MailOutOfOfficeSettings | null>(null);
  const [savedOutOfOfficeSettings, setSavedOutOfOfficeSettings] = useState<MailOutOfOfficeSettings | null>(null);
  const [outOfOfficeLoading, setOutOfOfficeLoading] = useState(false);
  const [outOfOfficeError, setOutOfOfficeError] = useState("");
  const [outOfOfficeBusy, setOutOfOfficeBusy] = useState(false);
  const [externalAccounts, setExternalAccounts] = useState<MailExternalAccountList | null>(null);
  const [externalAccountsLoading, setExternalAccountsLoading] = useState(false);
  const [externalAccountsError, setExternalAccountsError] = useState("");
  const [externalAccountsBusy, setExternalAccountsBusy] = useState(false);
  const [recentRecipients, setRecentRecipients] = useState<MailRecentRecipientSettingsResponse | null>(null);
  const [recentRecipientsLoading, setRecentRecipientsLoading] = useState(false);
  const [recentRecipientsError, setRecentRecipientsError] = useState("");
  const [recentRecipientsBusy, setRecentRecipientsBusy] = useState(false);
  const [messengerRoomsData, setMessengerRoomsData] = useState<MessengerRoomSummary[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState("");
  const [selectedRoomDetail, setSelectedRoomDetail] = useState<MessengerRoomDetail | null>(null);
  const [roomMessages, setRoomMessages] = useState<MessengerMessage[]>([]);
  const [messengerDraft, setMessengerDraft] = useState("");
  const [messengerError, setMessengerError] = useState("");
  const [messengerLoading, setMessengerLoading] = useState(false);
  const [messengerLifecycleAction, setMessengerLifecycleAction] = useState<MessengerRoomLifecycleAction>("none");
  const [messengerNewOwnerId, setMessengerNewOwnerId] = useState("");
  const notificationStreamAbortRef = useRef<AbortController | null>(null);
  const notificationStreamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notificationButtonRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const streamCursorRef = useRef<string>("");
  const streamRetryRef = useRef(0);
  const mailWorkspaceRequestRef = useRef(0);
  const mailDetailRequestRef = useRef(0);
  const activeMailSignature = mailSignatures?.enabled
    ? mailSignatures.signatures.find((item) => item.signatureId === mailSignatures.defaultSignatureId) ?? null
    : null;

  async function loadNotificationData(targetToken: string): Promise<void> {
    setNotificationLoading(true);
    try {
      const summary = await fetchNotificationSummary(targetToken);
      const response = await fetchNotifications(targetToken, { limit: 20, unreadOnly: false });
      setNotificationSummary(summary);
      setNotifications([...(response.notifications ?? [])].sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime()));
    } finally {
      setNotificationLoading(false);
    }
  }

  function saveLocale(nextLocale: AppLocale) {
    setLocale(nextLocale);
    window.localStorage.setItem("moaworks.locale", nextLocale);
  }

  function saveTimezone(nextTimezone: string) {
    setTimezone(nextTimezone);
    window.localStorage.setItem("moaworks.timezone", nextTimezone);
  }

  function resetQuickComposeMode() {
    if (quickComposeMode !== "none") {
      setQuickComposeMode("none");
    }
    if (showQuickComposePicker) {
      setShowQuickComposePicker(false);
    }
  }

  function resolveQuickComposeMode(menu: UserPortalMenu): QuickComposeMode {
    if (menu === "mail") return "mail";
    if (menu === "approval") return "approval";
    if (menu === "messenger") return "messenger";
    return "none";
  }

  async function openQuickCompose() {
    if (!token) return;
    const nextMode = resolveQuickComposeMode(activePortalMenu);
    if (nextMode === "none") {
      setQuickComposeMode("none");
      setShowQuickComposePicker(true);
      return;
    }
    await openQuickComposeByMode(nextMode);
  }

  async function openQuickComposeByMode(nextMode: QuickComposeMode) {
    setShowQuickComposePicker(false);
    setQuickComposeMode(nextMode);
    if (nextMode === "mail") {
      setActiveMailFolder(activeMailbox === "sent" ? "sent" : "inbox");
      setActivePortalMenu("mail");
      setMailError("");
      return;
    }
    if (nextMode === "messenger") {
      setActivePortalMenu("messenger");
      if (!selectedRoomId && messengerRoomsData[0]?.roomId) {
        await selectMessengerRoom(token, messengerRoomsData[0].roomId, { markRead: true });
      }
      return;
    }
    setActivePortalMenu("approval");
  }

  function setPortalMenu(nextMenu: UserPortalMenu) {
    if (activePortalMenu === "approval" && approvalShellMenu === "settings" && nextMenu !== "approval" && approvalPreferencesDirty) {
      setApprovalPendingPortalMenu(nextMenu);
      return;
    }
    resetQuickComposeMode();
    setShowNotificationPanel(false);
    clearTransientFeedback();
    setApprovalError("");
    setMailError("");
    setMessengerError("");
    setSearchError("");
    setActivePortalMenu(nextMenu);
  }

  function setMailFolder(folder: MailFolderType) {
    mailWorkspaceRequestRef.current += 1;
    mailDetailRequestRef.current += 1;
    setActiveMailFolder(folder);
    setSelectedMailIds([]);
    setSelectedMailId("");
    setMailReadReceiptOpen(false);
    setSelectedMailDetail(null);
    setMailBulkReloadError("");
    setMailListQuery((current) => ({ ...current, offset: 0 }));
    resetQuickComposeMode();
    if (folder === "sent") {
      setActiveMailbox("sent");
      return;
    }
    if (folder === "inbox" || folder === "starred" || folder === "unread" || folder === "draft" || folder === "scheduled") {
      setActiveMailbox("inbox");
      return;
    }
    if (folder === "localArchive") {
      setActiveMailbox("inbox");
      return;
    }
    setActiveMailbox("inbox");
  }

  function openMailFolder(folder: MailFolderType) {
    setMailFolder(folder);
    if (!token || folder === "localArchive") return;
    const nextQuery = { ...mailListQuery, offset: 0 };
    void loadMailWorkspace(token, folder === "sent" ? "sent" : "inbox", undefined, folder, nextQuery);
  }

  function getMailListByFolder(folder: MailFolderType) {
    if (folder === "sent") return sentMails;
    if (folder === "starred" || folder === "unread" || folder === "inbox") return inboxMails;
    if (folder === "draft") return draftMails;
    if (folder === "scheduled") return scheduledMails;
    if (folder === "localArchive") return [];
    return mailContextMails;
  }

  function ui020Mailbox(folder: MailFolderType): string {
    if (folder === "spam" || folder === "trash") return folder;
    if (folder.startsWith("folder:")) return "folder";
    if (folder.startsWith("tag:")) return "tag";
    return folder === "sent" ? "sent" : folder === "draft" ? "draft" : folder === "scheduled" ? "scheduled" : "inbox";
  }

  async function refreshMailResources(targetToken: string) {
    const [folders, tags, preferences, signatures] = await Promise.all([fetchMailFolders(targetToken), fetchMailTags(targetToken), fetchMailBasicPreferences(targetToken), fetchMailSignatures(targetToken)]);
    setMailFoldersData(folders.folders ?? []);
    setMailTagsData(tags.tags ?? []);
    setMailPreferences(preferences);
    setSavedMailPreferences(preferences);
    setMailSignatures(signatures);
    setSavedMailSignatures(signatures);
  }

  function openMailResourceModal(kind: "folder" | "tag", item?: MailFolder | MailTag) {
    setMailResourceModal(kind);
    setMailResourceEditId(kind === "folder" ? (item as MailFolder | undefined)?.folderId ?? "" : (item as MailTag | undefined)?.tagId ?? "");
    setMailResourceName(item?.name ?? "");
    setMailTagColor(kind === "tag" ? (item as MailTag | undefined)?.color ?? "gray" : "gray");
  }

  async function saveMailResource() {
    const name = mailResourceName.trim();
    if (!token || !name || mailBulkBusy) return;
    setMailBulkBusy(true);
    try {
      if (mailResourceModal === "folder") {
        if (mailResourceEditId) await updateMailFolder(token, mailResourceEditId, name);
        else await createMailFolder(token, name);
      } else if (mailResourceModal === "tag") {
        if (mailResourceEditId) await updateMailTag(token, mailResourceEditId, name, mailTagColor);
        else await createMailTag(token, name, mailTagColor);
      }
      await refreshMailResources(token);
      if (mailSettingsOpen && mailSettingsTab === "mailbox") await loadMailboxSettings(token, false);
      setMailResourceModal("none");
      setMessage(mailResourceEditId ? "이름을 변경했습니다." : "새 항목을 추가했습니다.");
    } catch (error) {
      setMailError(normalizeClientError(error, "메일함 또는 태그 저장에 실패했습니다."));
    } finally {
      setMailBulkBusy(false);
    }
  }

  async function removeMailResource(kind: "folder" | "tag", id: string) {
    if (!token || mailBulkBusy) return;
    setMailBulkBusy(true);
    try {
      if (kind === "folder") await deleteMailFolder(token, id);
      else await deleteMailTag(token, id);
      await refreshMailResources(token);
      if (mailSettingsOpen && mailSettingsTab === "mailbox") await loadMailboxSettings(token, false);
      if (activeMailFolder === kind + ":" + id) openMailFolder("inbox");
      setMessage(kind === "folder" ? "메일함을 삭제하고 포함 메일을 받은편지함으로 옮겼습니다." : "태그를 삭제했습니다.");
    } catch (error) {
      setMailError(normalizeClientError(error, "삭제에 실패했습니다."));
    } finally {
      setMailBulkBusy(false);
    }
  }

  async function runUi020BulkAction(action: "move_folder" | "add_tag" | "remove_tag" | "spam" | "not_spam" | "restore" | "purge", targetId?: string) {
    if (!token || !selectedMailIds.length || mailBulkBusy) return false;
    setMailBulkBusy(true);
    setMailError("");
    try {
      const trashViews = activeMailFolder === "trash"
        ? selectedMailIds.map(parseTrashSelectionKey).filter((item): item is { mailId: string; sourceMailbox: MailTrashSource } => item !== null)
        : undefined;
      if (activeMailFolder === "trash" && trashViews?.length !== selectedMailIds.length) {
        throw new Error("휴지통 선택 정보가 올바르지 않습니다.");
      }
      const mailIds = trashViews ? [...new Set(trashViews.map((item) => item.mailId))] : selectedMailIds;
      const result = await bulkMailAction(
        token, mailIds, action, ui020Mailbox(activeMailFolder), undefined,
        action === "move_folder" ? targetId : undefined,
        action === "add_tag" || action === "remove_tag" ? targetId : undefined,
        trashViews,
      );
      setMessage(result.changedCount + "개 메일을 처리했습니다.");
      setSelectedMailIds([]);
      await Promise.all([loadMailWorkspace(token, activeMailbox, undefined, activeMailFolder, mailListQuery), refreshMailResources(token)]);
      return true;
    } catch (error) {
      setMailError(normalizeClientError(error, "메일 처리에 실패했습니다."));
      return false;
    } finally {
      setMailBulkBusy(false);
    }
  }
  function openNewMailCompose() {
    void refreshMailSignaturesForCompose();
    setMailComposeContext("new");
    setMailComposePosition(null);
    setMailComposeFiles([]);
    clearMailComposeInlineImages();
    setMailComposeSourceDetail(null);
    setMailComposeSourceMailId("");
    setEditingScheduledMailId("");
    setEditingDraftMailId("");
    setMailComposePersistedAttachments([]);
    setSelectedForwardAttachmentIds([]);
    setRecipientPickerTarget(null);
    setComposeWindow("normal");
    setMailComposeForm(createEmptyMailComposeForm());
    setMailError("");
    setQuickComposeMode("mail");
  }

  function openAddressBookMailCompose(email: string) {
    setActivePortalMenu("mail");
    openNewMailCompose();
    setMailComposeForm({ ...createEmptyMailComposeForm(), to: email });
  }

  async function refreshMailSignaturesForCompose() {
    if (!token) return;
    try {
      const latest = await fetchMailSignatures(token);
      setMailSignatures(latest);
      setSavedMailSignatures(latest);
    } catch (error) {
      setMailSignatures(null);
      pushFeedback({
        id: `mail-signature-compose-warning-${Date.now()}`,
        source: "mail",
        tone: "warning",
        title: "최신 서명을 불러오지 못했습니다.",
        message: normalizeClientError(error, "메일 작성은 계속할 수 있으며, 저장 시 서버가 최신 서명을 다시 확인합니다."),
      });
    }
  }

  function startMailComposeDrag(event: React.MouseEvent<HTMLDivElement>) {
    if (composeWindow !== "normal") return;
    const popup = event.currentTarget.closest("form");
    if (!popup) return;
    const rect = popup.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    const move = (moveEvent: MouseEvent) => {
      const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
      const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
      setMailComposePosition({ left: Math.min(Math.max(8, moveEvent.clientX - offsetX), maxLeft), top: Math.min(Math.max(8, moveEvent.clientY - offsetY), maxTop) });
    };
    const stop = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", stop); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop, { once: true });
  }

  function inferMailboxFromMailId(mailId: string): MailboxType {
    if (inboxMails.some((item) => item.mailId === mailId)) return "inbox";
    if (draftMails.some((item) => item.mailId === mailId)) return "sent";
    return "sent";
  }

  function updateMailListQuery(patch: Partial<MailListQuery>) {
    const nextQuery = { ...mailListQuery, ...patch, offset: patch.offset ?? 0 };
    setMailListQuery(nextQuery);
    setSelectedMailIds([]);
    setMailBulkReloadError("");
    if (token) {
      void loadMailWorkspace(token, activeMailFolder === "sent" ? "sent" : "inbox", undefined, activeMailFolder, nextQuery);
    }
  }

  async function runBulkMailAction(action: "read" | "unread" | "star" | "unstar" | "move" | "delete", targetCategory?: string): Promise<boolean> {
    if (!token || selectedMailIds.length === 0 || mailBulkBusy) return false;
    setMailBulkBusy(true);
    setMailError("");
    setMailBulkReloadError("");
    try {
      const mailbox = ui020Mailbox(activeMailFolder);
      const result = await bulkMailAction(token, selectedMailIds, action, mailbox, targetCategory);
      setMessage(`${result.changedCount}개 변경 · ${result.unchangedCount}개 유지`);
      setSelectedMailIds([]);
      const reloaded = await loadMailWorkspace(token, activeMailbox, undefined, activeMailFolder, mailListQuery);
      if (!reloaded) {
        setMailBulkReloadError("저장은 완료됐지만 목록을 다시 불러오지 못했습니다. 새로고침해 주세요.");
      }
      return true;
    } catch (error) {
      setMailError(error instanceof Error ? error.message : "메일 일괄 처리에 실패했습니다.");
      return false;
    } finally {
      setMailBulkBusy(false);
    }
  }

  async function changeSelectedMailCategory(category: string) {
    if (!token || !selectedMailId || !["inbox", "starred", "unread"].includes(activeMailFolder) || mailCategoryBusy) return;
    if ((selectedMailSummary?.category || "primary") === category) return;
    setMailCategoryBusy(true);
    setMailError("");
    try {
      await setMailCategory(token, selectedMailId, category);
      const nextQuery = { ...mailListQuery, category: category as MailListQuery["category"], offset: 0 };
      setMailListQuery(nextQuery);
      try {
        const response = await fetchInbox(token, nextQuery);
        setInboxMails(response.mails ?? []);
        setMailListMeta({ total: response.total, limit: response.limit, offset: response.offset, hasMore: response.hasMore });
      } catch {
        setMailError("저장은 완료됐지만 목록을 다시 불러오지 못했습니다.");
        return;
      }
      setMessage("메일 분류를 변경했습니다.");
    } catch (error) {
      setMailError(normalizeClientError(error, "메일 분류 변경에 실패했습니다."));
    } finally {
      setMailCategoryBusy(false);
    }
  }
  async function refreshUiContract() {
    const contract = await fetchUiContract();
    setUiContract(mergeUiContract(contract as ServerUiContract));
  }

  function toTranslationLocale(code: string): string {
    const normalized = code.trim().replace("_", "-").toLowerCase();
    if (normalized === "zh-cn") {
      return "zh-cn";
    }
    return normalized.split("-")[0];
  }

  async function loadTranslationState(targetToken = token) {
    try {
      const status = await fetchTranslationStatus(targetToken);
      setTranslationStatus(status as { provider: string; enabled: boolean; available: boolean });
    } catch {
      setTranslationStatus(null);
    }
  }

  async function refreshMailDeliveryState(targetToken = token) {
    if (!targetToken) {
      setMailDeliveryStatus(null);
      return;
    }
    try {
      const status = await fetchMailDeliveryStatus(targetToken);
      setMailDeliveryStatus(status);
    } catch {
      setMailDeliveryStatus(null);
    }
  }

  async function runTranslationDemo(event: FormEvent) {
    event.preventDefault();
    if (!token) {
      setTranslationError("로그인 후 번역 도구를 사용할 수 있습니다.");
      return;
    }
    const trimmed = translationSource.trim();
    if (!trimmed) {
      setTranslationError("원문을 입력하세요.");
      return;
    }
    setTranslationLoading(true);
    setTranslationError("");
    const sourceLocale = toTranslationLocale(locale);
    const targetLocale = toTranslationLocale(translationTargetLocale);
    try {
      const payload: TranslationRequest = {
        texts: [{ text: trimmed, sourceLocale, targetLocale }],
        includeSource: true,
        useCache: true,
      };
      const response: TranslationResponse = await requestTranslation(payload, token);
      setTranslationResult(response.items);
    } catch (error) {
      setTranslationError(error instanceof Error ? error.message : "번역 실패");
      setTranslationResult([]);
    } finally {
      setTranslationLoading(false);
    }
  }

  async function translateIncomingMail() {
    if (!token || !selectedMailDetail || !translationUiVisible) return;
    const translatingMailId = selectedMailDetail.mailId;
    setTranslationLoading(true); setTranslationError(""); setMailTranslationKind("incoming");
    try {
      const targetLocale = toTranslationLocale(locale);
      const response = await requestTranslation({ texts: [{ text: selectedMailDetail.bodyText || selectedMailDetail.subject, sourceLocale: "auto", targetLocale }], includeSource: true, useCache: true }, token);
      const item = response.items[0];
      if (!item || response.fallbackUsed || item.source === "fallback" || !item.translatedText.trim()) {
        setMailTranslationPreview(null);
        setShowTranslatedMail(false);
        setTranslationError("메일 번역에 실패했습니다. 잠시 후 다시 시도해 주세요.");
        return;
      }
      const body = item.translatedText;
      setMailTranslationPreview({ subject: selectedMailDetail.subject, body, mailId: translatingMailId });
      setShowTranslatedMail(true);
    } catch (error) { setTranslationError(normalizeClientError(error, "메일 번역 실패")); }
    finally { setTranslationLoading(false); }
  }

  async function translateOutgoingMail() {
    if (!token || !translationUiVisible) return;
    setOutgoingTranslationOpen(true);
    setMailTranslationPreview(null);
    setMailTranslationKind("outgoing");
    let plan: ReturnType<typeof createOutgoingRichTranslationPlan>;
    try {
      plan = createOutgoingRichTranslationPlan({ subject: mailComposeForm.subject, bodyDocument: mailComposeForm.bodyDocument, targetLocale: outgoingTranslationTargetLocale, extractSegments: extractTranslationSegments });
    } catch (error) {
      setTranslationError(normalizeClientError(error, "메일 본문 번역을 준비하지 못했습니다."));
      return;
    }
    if (!plan.texts.length) { setTranslationError("번역할 제목 또는 본문을 입력하세요."); return; }
    setTranslationLoading(true); setTranslationError("");
    try {
      const response = await requestTranslation({ texts: plan.texts, includeSource: true, useCache: true }, token);
      const preview = createOutgoingRichTranslationPreview(plan, response);
      const projection = projectMailDocument(applyTranslatedSegments(mailComposeForm.bodyDocument, preview.segments));
      setMailTranslationPreview({ subject: preview.subject, body: projection.bodyText, segments: preview.segments, sourceSnapshot: preview.sourceSnapshot });
    } catch (error) { setTranslationError(normalizeClientError(error, "메일 번역 실패")); }
    finally { setTranslationLoading(false); }
  }

  function applyOutgoingTranslation() {
    const preview = mailTranslationPreview;
    if (!preview?.segments || mailTranslationKind !== "outgoing") return;
    const translatedSegments = preview.segments;
    try {
      const sourceSnapshot = preview.sourceSnapshot;
      if (!sourceSnapshot) throw new Error("번역 원문 스냅샷이 없습니다.");
      const next = applyOutgoingRichTranslationPreview(mailComposeForm, { subject: preview.subject, segments: translatedSegments, sourceSnapshot }, { applySegments: applyTranslatedSegments, projectDocument: projectMailDocument });
      setMailComposeForm((current) => (
        JSON.stringify(current.bodyDocument) === sourceSnapshot.documentKey && current.subject === sourceSnapshot.subject
          ? next
          : current
      ));
    } catch (error) {
      setTranslationError(normalizeClientError(error, "번역 결과를 본문에 적용하지 못했습니다."));
      return;
    }
    setOutgoingTranslationOpen(false); setMailTranslationPreview(null); setTranslationError("");
  }

  function closeOutgoingTranslation() {
    setOutgoingTranslationOpen(false);
    setMailTranslationPreview(null);
    if (mailTranslationKind === "outgoing") setTranslationError("");
  }

  async function runScheduledAction(action: "cancel" | "send" | "retry") {
    if (!token || !selectedMailDetail || (activeMailFolder !== "scheduled" && !(action === "retry" && activeMailFolder === "sent"))) return;
    setMailLoading(true); setMailError("");
    try {
      if (action === "cancel") await cancelScheduledMail(token, selectedMailDetail.mailId);
      else if (action === "retry") await retryScheduledMail(token, selectedMailDetail.mailId);
      else await sendScheduledMailNow(token, selectedMailDetail.mailId);
      setMessage(action === "cancel" ? "예약을 취소하고 임시보관함으로 이동했습니다." : action === "retry" ? "외부 전달 재시도를 요청했습니다." : "예약 메일을 지금 발송했습니다.");
      await loadMailWorkspace(token, "sent", undefined, action === "cancel" ? "draft" : "sent", { ...mailListQuery, offset: 0 });
    } catch (error) { setMailError(normalizeClientError(error, "예약 메일 처리 실패")); }
    finally { setMailLoading(false); }
  }

  function editScheduledMail() {
    if (!selectedMailDetail || activeMailFolder !== "scheduled") return;
    const values = (kind: string) => selectedMailDetail.recipients.filter((item) => item.recipientKind === kind).map((item) => item.recipientEmail).join(", ");
    setEditingScheduledMailId(selectedMailDetail.mailId);
    setEditingDraftMailId("");
    setMailComposePersistedAttachments([]);
    setMailComposeForm(createMailComposeForm({
      to: values("to"), cc: values("cc"), bcc: values("bcc"), subject: selectedMailDetail.subject,
      bodyText: selectedMailDetail.bodyText, bodyHtml: selectedMailDetail.bodyHtml,
      scheduledAt: selectedMailDetail.scheduledAt ? new Date(selectedMailDetail.scheduledAt).toISOString().slice(0, 16) : "",
    }));
    void hydrateComposeInlineImages(selectedMailDetail.attachments);
    setMailComposeContext(selectedMailDetail.sourceAction ?? "new");
    setMailComposeSourceMailId(selectedMailDetail.sourceMailId ?? "");
    setMailComposeSourceDetail(null);
    setQuickComposeMode("mail");
  }

  function editDraftMail() {
    if (!selectedMailDetail || activeMailFolder !== "draft") return;
    const values = (kind: string) => selectedMailDetail.recipients.filter((item) => item.recipientKind === kind).map((item) => item.recipientEmail).join(", ");
    setEditingScheduledMailId("");
    setEditingDraftMailId(selectedMailDetail.mailId);
    setMailComposePersistedAttachments(selectedMailDetail.attachments);
    setMailComposeForm(createMailComposeForm({ to: values("to"), cc: values("cc"), bcc: values("bcc"), subject: selectedMailDetail.subject, bodyText: selectedMailDetail.bodyText, bodyHtml: selectedMailDetail.bodyHtml, scheduledAt: "" }));
    void hydrateComposeInlineImages(selectedMailDetail.attachments.filter((attachment) => selectedMailDetail.bodyHtml?.includes(`cid:${attachment.contentId ?? ""}`)));
    setMailComposeContext(selectedMailDetail.sourceAction ?? "new");
    setMailComposeSourceMailId(selectedMailDetail.sourceMailId ?? "");
    setMailComposeSourceDetail(null);
    setMailComposeFiles([]);
    setQuickComposeMode("mail");
  }

  function stopNotificationStream() {
    notificationStreamAbortRef.current?.abort();
    notificationStreamAbortRef.current = null;
    if (notificationStreamTimerRef.current) {
      clearTimeout(notificationStreamTimerRef.current);
      notificationStreamTimerRef.current = null;
    }
  }

  function appendNotification(notification: NotificationRecord) {
    setNotifications((current) => {
      const existed = current.some((item) => item.notificationId === notification.notificationId);
      const next = existed
        ? current.map((item) => (item.notificationId === notification.notificationId ? notification : item))
        : [notification, ...current];
      return next.sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime());
    });
  }

  async function refreshNotificationsFallback(targetToken: string) {
    await refreshNotifications(targetToken);
  }

  function applyStreamPolicyError(error: Error) {
    setNotificationError(error instanceof Error ? error.message : "알림 조회 실패");
    setNotificationMode("fallback");
    stopNotificationStream();
  }

  function connectNotificationStream(targetToken: string) {
    stopNotificationStream();
    const controller = new AbortController();
    notificationStreamAbortRef.current = controller;
    setNotificationMode("streaming");

    function scheduleReconnect() {
      if (notificationStreamAbortRef.current !== controller) {
        return;
      }
      notificationStreamAbortRef.current = null;
      if (streamRetryRef.current < NOTIFICATION_POLICY.streamRetryMax) {
        streamRetryRef.current += 1;
        notificationStreamTimerRef.current = setTimeout(() => {
          if (targetToken) {
            connectNotificationStream(targetToken);
          }
        }, NOTIFICATION_POLICY.streamReconnectDelayMs * streamRetryRef.current);
        return;
      }
      streamRetryRef.current = 0;
      void refreshNotificationsFallback(targetToken).catch(applyStreamPolicyError);
    }

    void fetchNotificationStream(targetToken, {
      cursor: streamCursorRef.current || undefined,
      signal: controller.signal,
    })
      .then((streamPayload) => {
        if (controller.signal.aborted) return;
        streamRetryRef.current = 0;
        void fetchNotificationSummary(targetToken)
          .then((summary) => setNotificationSummary(summary))
          .catch(() => setNotificationError("알림 요약 조회 실패"));

        let fallbackRequested = false;
        const eventBlocks = streamPayload.split(/\r?\n\r?\n/);
        for (const block of eventBlocks) {
          const lines = block.split(/\r?\n/);
          const eventName = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
          const data = lines
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
          if (!eventName || !data) continue;

          try {
            if (eventName === "notification") {
              const payload = JSON.parse(data) as NotificationRecord;
              appendNotification(payload);
              continue;
            }
            if (eventName === "streammeta") {
              const payload = JSON.parse(data) as { value?: string };
              if (payload.value) {
                streamCursorRef.current = payload.value;
              }
              continue;
            }
            if (eventName === "heartbeat") {
              const heartbeat = JSON.parse(data) as { type?: string };
              if (heartbeat.type === "fallback") {
                fallbackRequested = true;
                break;
              }
            }
          } catch {
            // ignore malformed stream payload
          }
        }

        if (fallbackRequested) {
          applyStreamPolicyError(new Error("stream fallback"));
          return;
        }
        scheduleReconnect();
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        scheduleReconnect();
      });
  }

  async function refreshNotifications(targetToken: string) {
    try {
      setNotificationError("");
      await retryWithBackoff(() => loadNotificationData(targetToken));
    } catch (error) {
      setNotificationError(error instanceof Error ? error.message : "알림 조회 실패");
      throw error;
    }
  }

  async function retryWithBackoff<T>(task: () => Promise<T>, maxAttempts = 3): Promise<T> {
    let attempt = 0;
    let lastError: Error | null = null;
    while (attempt < maxAttempts) {
      try {
        attempt += 1;
        return await task();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("요청 실패");
        if (attempt >= maxAttempts) break;
        await new Promise((resolve) => setTimeout(resolve, NOTIFICATION_POLICY.retryDelayMs * attempt));
      }
    }
    throw lastError ?? new Error("요청 실패");
  }

  async function reload() {
    if (!token) return;
    const response = await fetchApprovals(token);
    setDocuments(response.documents);
    const logs = await fetchApprovalLogs(token);
    setLogsCount(logs.logs.length);
    setMessage("");
    try {
      await retryWithBackoff(() => loadNotificationData(token));
    } catch (error) {
      setNotificationError(error instanceof Error ? error.message : "알림 조회 실패");
    }
  }

  async function loadMailDetail(targetToken: string, mailId: string, mailbox: MailboxType, options?: { markRead?: boolean; propagateError?: boolean; folder?: MailFolderType }) {
    const requestId = ++mailDetailRequestRef.current;
    setSelectedMailId(mailId);
    setSelectedMailDetail(null);
    setMailReadReceiptOpen(false);
    setMailDetailLoading(true);
    setMailDetailError("");
    try {
      if (mailbox === "inbox" && options?.markRead) {
        await markMailRead(targetToken, mailId);
      }
      const detail = await fetchMailDetail(targetToken, mailId, ui020Mailbox(options?.folder ?? activeMailFolder));
      if (requestId !== mailDetailRequestRef.current) return;
      setSelectedMailDetail(detail);
      if (mailbox === "inbox" && options?.markRead) {
        setInboxMails((current) => current.map((item) => (item.mailId === mailId ? { ...item, isRead: true } : item)));
      }
    } catch (error) {
      if (requestId !== mailDetailRequestRef.current) return;
      setMailDetailError(normalizeClientError(error, "메일 상세 조회 실패"));
      if (options?.propagateError) throw error;
    } finally {
      if (requestId === mailDetailRequestRef.current) setMailDetailLoading(false);
    }
  }

  async function selectMail(targetToken: string, mailId: string, mailbox: MailboxType, options?: { markRead?: boolean; propagateError?: boolean; folder?: MailFolderType }) {
    await loadMailDetail(targetToken, mailId, mailbox, options);
  }

  async function loadMailWorkspace(
    targetToken: string,
    preferredMailbox?: MailboxType,
    preferredMailId?: string,
    preferredFolder: MailFolderType = activeMailFolder,
    query: MailListQuery = mailListQuery,
  ): Promise<boolean> {
    const requestId = ++mailWorkspaceRequestRef.current;
    setMailLoading(true);
    setMailError("");
    try {
      const effectiveQuery: MailListQuery = {
        ...query,
        read: preferredFolder === "unread" ? "unread" : query.read,
        starred: preferredFolder === "starred" ? "starred" : query.starred,
        category: preferredFolder === "inbox" ? query.category : "all",
      };
      const defaultQuery: MailListQuery = { ...DEFAULT_MAIL_LIST_QUERY, category: "all" };
      const inboxQuery = ["inbox", "starred", "unread"].includes(preferredFolder) ? effectiveQuery : defaultQuery;
      const sentQuery = preferredFolder === "sent" ? effectiveQuery : defaultQuery;
      const draftQuery = preferredFolder === "draft" ? effectiveQuery : defaultQuery;
      const [inboxResponse, sentResponse, draftResponse, scheduledResponse, foldersResponse, tagsResponse] = await Promise.all([
        fetchInbox(targetToken, inboxQuery), fetchSentMail(targetToken, sentQuery), fetchDraftMail(targetToken, draftQuery), fetchScheduledMail(targetToken, preferredFolder === "scheduled" ? effectiveQuery : defaultQuery),
        fetchMailFolders(targetToken), fetchMailTags(targetToken),
      ]);
      let contextResponse = null;
      if (preferredFolder.startsWith("folder:")) contextResponse = await fetchMailFolderMessages(targetToken, preferredFolder.slice(7), effectiveQuery);
      else if (preferredFolder.startsWith("tag:")) contextResponse = await fetchMailTagMessages(targetToken, preferredFolder.slice(4), effectiveQuery);
      else if (preferredFolder === "spam") contextResponse = await fetchMailSpam(targetToken, effectiveQuery);
      else if (preferredFolder === "trash") contextResponse = await fetchMailTrash(targetToken, effectiveQuery);

      if (requestId !== mailWorkspaceRequestRef.current) return false;
      const nextInbox = inboxResponse.mails ?? [];
      const nextSent = sentResponse.mails ?? [];
      const nextDrafts = draftResponse.mails ?? [];
      const nextContext = contextResponse?.mails ?? [];
      setInboxMails(nextInbox);
      setSentMails(nextSent);
      setDraftMails(nextDrafts);
      const nextScheduled = scheduledResponse.mails ?? [];
      setScheduledMails(nextScheduled);
      setMailContextMails(nextContext);
      setMailFoldersData(foldersResponse.folders ?? []);
      setMailTagsData(tagsResponse.tags ?? []);
      const activeResponse = contextResponse ?? (preferredFolder === "sent" ? sentResponse : preferredFolder === "draft" ? draftResponse : preferredFolder === "scheduled" ? scheduledResponse : inboxResponse);
      setMailListMeta({ total: activeResponse.total, limit: activeResponse.limit, offset: activeResponse.offset, hasMore: activeResponse.hasMore });
      const mailbox = preferredMailbox ?? activeMailbox;
      const activeList = contextResponse ? nextContext : preferredFolder === "sent" ? nextSent : preferredFolder === "draft" ? nextDrafts : preferredFolder === "scheduled" ? nextScheduled : nextInbox;
      const resolvedMailbox = preferredFolder === "sent" ? "sent" : "inbox";
      const resolvedMailId = preferredMailId ?? selectedMailId;
      const targetMail = resolvedMailId ? activeList.find((item) => item.mailId === resolvedMailId) ?? null : activeList[0] ?? null;
      setActiveMailbox(resolvedMailbox);
      if (targetMail) {
        await loadMailDetail(targetToken, targetMail.mailId, resolvedMailbox, { folder: preferredFolder });
      } else {
        setSelectedMailId("");
        setMailReadReceiptOpen(false);
        setSelectedMailDetail(null);
        setMailDetailError("");
      }
      return true;
    } catch (error) {
      if (requestId !== mailWorkspaceRequestRef.current) return false;
      setMailError(normalizeClientError(error, "메일 목록 조회 실패"));
      setInboxMails([]);
      setSentMails([]);
      setDraftMails([]);
      setScheduledMails([]);
      setMailContextMails([]);
      setMailListMeta({ total: 0, limit: query.limit ?? 50, offset: query.offset ?? 0, hasMore: false });
      setSelectedMailId("");
      setMailReadReceiptOpen(false);
      setSelectedMailDetail(null);
      return false;
    } finally {
      if (requestId === mailWorkspaceRequestRef.current) setMailLoading(false);
    }
  }
  async function loadMailStorage(targetToken: string) {
    setMailStorageLoading(true);
    setMailStorageError("");
    try {
      setMailStorage(await fetchMailStorage(targetToken));
    } catch (error) {
      setMailStorageError(normalizeClientError(error, "메일 용량을 불러오지 못했습니다."));
    } finally {
      setMailStorageLoading(false);
    }
  }

  async function loadMailboxSettings(targetToken: string, showLoading = true) {
    if (showLoading) setMailboxSettingsLoading(true);
    setMailboxSettingsError("");
    try {
      const settings = await fetchMailboxSettings(targetToken);
      setMailboxSettings(settings);
      setMailStorage(settings.storage);
      setMailFoldersData(settings.mailboxes.filter((row) => row.mailboxType === "folder").map((row, index) => ({
        folderId: row.mailboxKey.slice("folder:".length),
        name: row.name,
        sortOrder: index,
        messageCount: row.totalCount,
      })));
      setMailTagsData(settings.tags);
    } catch (error) {
      setMailboxSettingsError(normalizeClientError(error, "메일함 설정을 불러오지 못했습니다."));
    } finally {
      if (showLoading) setMailboxSettingsLoading(false);
    }
  }

  async function refreshMailboxBackupJobs(targetToken: string) {
    try {
      const response = await fetchMailboxBackups(targetToken);
      setMailboxSettings((current) => current ? { ...current, backupJobs: response.jobs } : current);
    } catch (error) {
      setMailboxSettingsError(normalizeClientError(error, "백업 작업 상태를 확인하지 못했습니다."));
    }
  }

  async function loadSpamSettings(targetToken: string, showLoading = true) {
    if (showLoading) setSpamSettingsLoading(true);
    setSpamSettingsError("");
    try {
      setSpamSettings(await fetchSpamSettings(targetToken));
    } catch (error) {
      setSpamSettingsError(normalizeClientError(error, "스팸 설정을 불러오지 못했습니다."));
    } finally {
      if (showLoading) setSpamSettingsLoading(false);
    }
  }

  async function loadAutoClassificationSettings(targetToken: string, showLoading = true) {
    if (showLoading) setAutoClassificationLoading(true);
    setAutoClassificationError("");
    try { setAutoClassificationSettings(await fetchAutoClassificationSettings(targetToken)); }
    catch (error) { setAutoClassificationError(normalizeClientError(error, "자동분류 설정을 불러오지 못했습니다.")); }
    finally { if (showLoading) setAutoClassificationLoading(false); }
  }

  async function loadAutoForwardSettings(targetToken: string, showLoading = true) {
    if (showLoading) setAutoForwardLoading(true);
    setAutoForwardError("");
    try { setAutoForwardSettings(await fetchAutoForwardSettings(targetToken)); }
    catch (error) { setAutoForwardError(normalizeClientError(error, "자동전달 설정을 불러오지 못했습니다.")); }
    finally { if (showLoading) setAutoForwardLoading(false); }
  }

  async function loadOutOfOfficeSettings(targetToken: string, showLoading = true) {
    if (showLoading) setOutOfOfficeLoading(true);
    setOutOfOfficeError("");
    try {
      const latest = await fetchOutOfOfficeSettings(targetToken);
      setOutOfOfficeSettings(latest);
      setSavedOutOfOfficeSettings(latest);
    } catch (error) {
      setOutOfOfficeError(normalizeClientError(error, "부재중응답 설정을 불러오지 못했습니다."));
    } finally {
      if (showLoading) setOutOfOfficeLoading(false);
    }
  }

  async function loadExternalAccounts(targetToken: string, showLoading = true) {
    if (showLoading) setExternalAccountsLoading(true); setExternalAccountsError("");
    try { setExternalAccounts(await fetchExternalMailAccounts(targetToken)); }
    catch (error) { setExternalAccountsError(normalizeClientError(error, "외부메일 설정을 불러오지 못했습니다.")); }
    finally { if (showLoading) setExternalAccountsLoading(false); }
  }

  async function loadRecentRecipients(targetToken: string, showLoading = true) {
    if (showLoading) setRecentRecipientsLoading(true);
    setRecentRecipientsError("");
    try { setRecentRecipients(await fetchRecentMailRecipientSettings(targetToken)); }
    catch (error) { setRecentRecipientsError(normalizeClientError(error, "최근 보낸 메일주소를 불러오지 못했습니다.")); }
    finally { if (showLoading) setRecentRecipientsLoading(false); }
  }

  async function openMailSettings(tab: MailSettingsTab) {
    if (!token) return;
    const outOfOfficeNavigationDirty = Boolean(
      mailSettingsOpen
      && mailSettingsTab === "outOfOffice"
      && tab !== "outOfOffice"
      && outOfOfficeSettings
      && savedOutOfOfficeSettings
      && JSON.stringify(outOfOfficeSettings) !== JSON.stringify(savedOutOfOfficeSettings),
    );
    if (outOfOfficeNavigationDirty && !window.confirm("저장하지 않은 변경을 취소하고 다른 설정으로 이동할까요?")) return;
    if (outOfOfficeNavigationDirty) setOutOfOfficeSettings(savedOutOfOfficeSettings);
    setMailSettingsOpen(true);
    setMailSettingsTab(tab);
    if (tab === "mailbox") {
      await loadMailboxSettings(token);
      return;
    }
    if (tab === "spam") {
      await loadSpamSettings(token);
      return;
    }
    if (tab === "classification") {
      await loadAutoClassificationSettings(token);
      return;
    }
    if (tab === "forwarding") {
      await loadAutoForwardSettings(token);
      return;
    }
    if (tab === "outOfOffice") {
      await loadOutOfOfficeSettings(token);
      return;
    }
    if (tab === "external") {
      await loadExternalAccounts(token);
      return;
    }
    if (tab === "recent") {
      await loadRecentRecipients(token);
      return;
    }
    setMailPreferencesLoading(true);
    setMailSignaturesLoading(true);
    setMailPreferencesError("");
    setMailSignaturesError("");
    setMailPreferencesConflict(false);
    setMailSignaturesConflict(false);
    try {
      const [basic, signatures] = await Promise.all([fetchMailBasicPreferences(token), fetchMailSignatures(token)]);
      setMailPreferences(basic);
      setSavedMailPreferences(basic);
      setMailSignatures(signatures);
      setSavedMailSignatures(signatures);
    } catch (error) {
      setMailPreferencesError(normalizeClientError(error, "메일 기본환경을 불러오지 못했습니다."));
      setMailSignaturesError(normalizeClientError(error, "메일 서명을 불러오지 못했습니다."));
    } finally {
      setMailPreferencesLoading(false);
      setMailSignaturesLoading(false);
    }
  }

  useEffect(() => {
    const handler = () => { if (token) void openMailSettings("external"); };
    window.addEventListener("moaworks:open-external-mail", handler);
    return () => window.removeEventListener("moaworks:open-external-mail", handler);
  }, [token]);

  useEffect(() => {
    const handler = () => { if (token) void openMailSettings("recent"); };
    window.addEventListener("moaworks:open-recent-mail", handler);
    return () => window.removeEventListener("moaworks:open-recent-mail", handler);
  }, [token]);

  useEffect(() => {
    setOutgoingTranslationTargetLocale(
      normalizeOutgoingTranslationLocale(mailPreferences?.translationTargetLocale),
    );
  }, [mailPreferences?.translationTargetLocale]);

  async function saveExternalAccount(item: MailExternalAccount | null, form: MailExternalAccountPayload): Promise<string | null> {
    if (!token || externalAccountsBusy) return "처리 중입니다.";
    setExternalAccountsBusy(true); setExternalAccountsError("");
    try {
      if (item) await updateExternalMailAccount(token, item.id, { ...form, expectedVersion: item.version });
      else await createExternalMailAccount(token, form);
      await loadExternalAccounts(token, false); return null;
    } catch (error) { const message=normalizeClientError(error,"외부메일 계정을 저장하지 못했습니다.");setExternalAccountsError(message);return message; }
    finally { setExternalAccountsBusy(false); }
  }
  async function removeExternalAccount(id: string) { if(!token||externalAccountsBusy)return;if(!window.confirm("외부메일 계정을 삭제할까요? 수집된 메일은 유지됩니다."))return;setExternalAccountsBusy(true);try{await deleteExternalMailAccount(token,id);await loadExternalAccounts(token,false)}catch(error){setExternalAccountsError(normalizeClientError(error,"외부메일 계정을 삭제하지 못했습니다."))}finally{setExternalAccountsBusy(false)} }
  async function removeExternalAccounts(ids: string[]) { if(!token||externalAccountsBusy)return;if(!window.confirm(`${ids.length}개 외부메일 계정을 삭제할까요?`))return;setExternalAccountsBusy(true);try{await bulkDeleteExternalMailAccounts(token,ids);await loadExternalAccounts(token,false)}catch(error){setExternalAccountsError(normalizeClientError(error,"외부메일 계정을 삭제하지 못했습니다."))}finally{setExternalAccountsBusy(false)} }
  async function runExternalTest(id: string) { if(!token||externalAccountsBusy)return;setExternalAccountsBusy(true);try{await testExternalMailAccount(token,id);await loadExternalAccounts(token,false)}catch(error){setExternalAccountsError(normalizeClientError(error,"연결 테스트에 실패했습니다."))}finally{setExternalAccountsBusy(false)} }
  async function runExternalCollect(id: string) { if(!token||externalAccountsBusy)return;setExternalAccountsBusy(true);try{await collectExternalMailAccount(token,id);await loadExternalAccounts(token,false)}catch(error){setExternalAccountsError(normalizeClientError(error,"수집 작업을 시작하지 못했습니다."))}finally{setExternalAccountsBusy(false)} }

  async function removeRecentRecipients(payload: { recipientIds?: string[]; deleteAll?: boolean }): Promise<boolean> {
    if (!token || recentRecipientsBusy) return false;
    setRecentRecipientsBusy(true);
    setRecentRecipientsError("");
    try {
      if (payload.recipientIds?.length === 1) await deleteRecentMailRecipient(token, payload.recipientIds[0]);
      else await bulkDeleteRecentMailRecipients(token, payload);
      await loadRecentRecipients(token, false);
      return true;
    } catch (error) {
      setRecentRecipientsError(normalizeClientError(error, "최근 주소를 삭제하지 못했습니다."));
      return false;
    } finally {
      setRecentRecipientsBusy(false);
    }
  }

  async function openMailBasicSettings() {
    await openMailSettings("basic");
  }

  function onOpenWorkspaceSettings(target: "mail" | "approval" | "calendar") {
    if (target === "mail") {
      setActivePortalMenu("mail");
      void openMailBasicSettings();
      return;
    }
    if (target === "approval") {
      setApprovalShellMenu("settings");
      setApprovalSettingsTab("basic");
      setActivePortalMenu("approval");
      return;
    }
    setCalendarSettingsRequestKey(current => current + 1);
    setActivePortalMenu("schedule");
  }

  async function saveMailboxPolicy(mailbox: MailboxSettingsRow, retentionDays: MailboxSettingsRow["retentionDays"]): Promise<boolean> {
    if (!token || mailboxSettingsBusyKey) return false;
    setMailboxSettingsBusyKey(`policy:${mailbox.mailboxKey}`);
    setMailboxSettingsError("");
    try {
      await updateMailboxPolicy(token, mailbox, retentionDays);
      await loadMailboxSettings(token, false);
      pushFeedback({ id: `mailbox-policy-${mailbox.mailboxKey}-${Date.now()}`, source: "mail-settings", tone: "success", title: `${mailbox.name} 보관기간을 저장했습니다.` });
      return true;
    } catch (error) {
      setMailboxSettingsError(normalizeClientError(error, "메일함 보관기간 저장에 실패했습니다."));
      return false;
    } finally {
      setMailboxSettingsBusyKey("");
    }
  }

  async function saveSpamPolicy() {
    if (!token || !spamSettings || spamSettingsBusy) return;
    setSpamSettingsBusy(true);
    setSpamSettingsError("");
    try {
      await updateSpamSettings(token, spamSettings);
      await loadSpamSettings(token, false);
      pushFeedback({ id: `spam-policy-${Date.now()}`, source: "mail-settings", tone: "success", title: "스팸 필터 정책을 저장했습니다." });
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === "MAIL_SPAM_SETTINGS_CONFLICT") {
        await loadSpamSettings(token, false);
        setSpamSettingsError("다른 위치에서 정책이 변경되었습니다. 서버 최신값을 확인해 주세요.");
      } else {
        setSpamSettingsError(normalizeClientError(error, "스팸 필터 정책 저장에 실패했습니다."));
      }
    } finally {
      setSpamSettingsBusy(false);
    }
  }

  async function saveSpamRule(rule: MailSpamRule | null, payload: MailSpamRulePayload): Promise<string | null> {
    if (!token || spamSettingsBusy) return "처리 중입니다.";
    setSpamSettingsBusy(true);
    setSpamSettingsError("");
    try {
      if (rule) await updateSpamRule(token, rule.ruleId, payload);
      else await createSpamRule(token, payload);
      await loadSpamSettings(token, false);
      pushFeedback({ id: `spam-rule-${Date.now()}`, source: "mail-settings", tone: "success", title: rule ? "스팸 규칙을 수정했습니다." : "스팸 규칙을 추가했습니다." });
      return null;
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === "MAIL_SPAM_RULE_CONFLICT") return "같은 이메일 또는 도메인 규칙이 이미 등록되어 있습니다.";
      return normalizeClientError(error, "규칙 값을 확인해 주세요.");
    } finally {
      setSpamSettingsBusy(false);
    }
  }

  async function removeSpamRule(rule: MailSpamRule): Promise<boolean> {
    if (!token || spamSettingsBusy) return false;
    setSpamSettingsBusy(true);
    setSpamSettingsError("");
    try {
      await deleteSpamRule(token, rule.ruleId);
      await loadSpamSettings(token, false);
      pushFeedback({ id: `spam-rule-delete-${Date.now()}`, source: "mail-settings", tone: "success", title: "스팸 규칙을 삭제했습니다." });
      return true;
    } catch (error) {
      setSpamSettingsError(normalizeClientError(error, "스팸 규칙 삭제에 실패했습니다."));
      return false;
    } finally {
      setSpamSettingsBusy(false);
    }
  }

  async function saveAutoClassificationPolicy() {
    if (!token || !autoClassificationSettings || autoClassificationBusy) return;
    setAutoClassificationBusy(true); setAutoClassificationError("");
    try {
      setAutoClassificationSettings(await updateAutoClassificationSettings(token, autoClassificationSettings));
      pushFeedback({ id: `auto-policy-${Date.now()}`, source: "mail-settings", tone: "success", title: "자동분류 정책을 저장했습니다." });
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === "MAIL_AUTO_CLASSIFICATION_POLICY_CONFLICT") {
        await loadAutoClassificationSettings(token, false);
        setAutoClassificationError("다른 위치에서 정책이 변경되었습니다. 서버 최신값을 확인해 주세요.");
      } else setAutoClassificationError(normalizeClientError(error, "자동분류 정책 저장에 실패했습니다."));
    } finally { setAutoClassificationBusy(false); }
  }

  async function saveAutoClassificationRule(rule: MailAutoClassificationRule | null, payload: MailAutoClassificationRulePayload): Promise<string | null> {
    if (!token || autoClassificationBusy) return "처리 중입니다.";
    setAutoClassificationBusy(true); setAutoClassificationError("");
    try {
      if (rule) await updateAutoClassificationRule(token, rule, payload); else await createAutoClassificationRule(token, payload);
      await loadAutoClassificationSettings(token, false);
      pushFeedback({ id: `auto-rule-${Date.now()}`, source: "mail-settings", tone: "success", title: rule ? "자동분류 규칙을 수정했습니다." : "자동분류 규칙을 추가했습니다." });
      return null;
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === "MAIL_AUTO_CLASSIFICATION_RULE_CONFLICT") return "같은 이름의 규칙이 있거나 다른 위치에서 변경되었습니다.";
      return normalizeClientError(error, "자동분류 규칙을 저장하지 못했습니다.");
    } finally { setAutoClassificationBusy(false); }
  }

  async function removeAutoClassificationRules(ruleIds: string[]): Promise<boolean> {
    if (!token || autoClassificationBusy || !ruleIds.length) return false;
    setAutoClassificationBusy(true); setAutoClassificationError("");
    try {
      if (ruleIds.length === 1) await deleteAutoClassificationRule(token, ruleIds[0]); else await deleteAutoClassificationRules(token, ruleIds);
      await loadAutoClassificationSettings(token, false);
      pushFeedback({ id: `auto-delete-${Date.now()}`, source: "mail-settings", tone: "success", title: `${ruleIds.length}개 자동분류 규칙을 삭제했습니다.` });
      return true;
    } catch (error) { setAutoClassificationError(normalizeClientError(error, "자동분류 규칙 삭제에 실패했습니다.")); return false; }
    finally { setAutoClassificationBusy(false); }
  }

  async function reorderAutoRules(ruleIds: string[]) {
    if (!token || !autoClassificationSettings || autoClassificationBusy) return;
    setAutoClassificationBusy(true); setAutoClassificationError("");
    try { setAutoClassificationSettings(await reorderAutoClassificationRules(token, autoClassificationSettings, ruleIds)); }
    catch (error) { await loadAutoClassificationSettings(token, false); setAutoClassificationError(normalizeClientError(error, "규칙 순서를 저장하지 못했습니다.")); }
    finally { setAutoClassificationBusy(false); }
  }

  async function saveAutoForwardPolicy() {
    if (!token || !autoForwardSettings || autoForwardBusy) return;
    setAutoForwardBusy(true); setAutoForwardError("");
    try { setAutoForwardSettings(await updateAutoForwardSettings(token, autoForwardSettings)); pushFeedback({ id: `forward-policy-${Date.now()}`, source: "mail-settings", tone: "success", title: "자동전달 정책을 저장했습니다." }); }
    catch (error) { if (error instanceof ApiRequestError && error.code === "MAIL_AUTO_FORWARD_POLICY_CONFLICT") await loadAutoForwardSettings(token, false); setAutoForwardError(normalizeClientError(error, "자동전달 정책을 저장하지 못했습니다.")); }
    finally { setAutoForwardBusy(false); }
  }
  async function addAutoForwardTargets(emails: string[]): Promise<string | null> {
    if (!token || autoForwardBusy || !emails.length) return "주소를 하나 이상 입력해 주세요.";
    setAutoForwardBusy(true); setAutoForwardError("");
    try { await createAutoForwardTargets(token, emails); await loadAutoForwardSettings(token, false); return null; }
    catch (error) { return normalizeClientError(error, "자동전달 주소를 저장하지 못했습니다."); }
    finally { setAutoForwardBusy(false); }
  }
  async function removeAutoForwardTargets(ids: string[]): Promise<boolean> {
    if (!token || autoForwardBusy || !ids.length) return false;
    setAutoForwardBusy(true); setAutoForwardError("");
    try { await deleteAutoForwardTargets(token, ids); await loadAutoForwardSettings(token, false); return true; }
    catch (error) { setAutoForwardError(normalizeClientError(error, "자동전달 주소를 삭제하지 못했습니다.")); return false; }
    finally { setAutoForwardBusy(false); }
  }
  async function saveAutoForwardException(item: MailAutoForwardException | null, payload: MailAutoForwardExceptionPayload): Promise<string | null> {
    if (!token || autoForwardBusy) return "처리 중입니다.";
    setAutoForwardBusy(true); setAutoForwardError("");
    try { if (item) await updateAutoForwardException(token, item, payload); else await createAutoForwardException(token, payload); await loadAutoForwardSettings(token, false); return null; }
    catch (error) { return normalizeClientError(error, "예외 자동전달 규칙을 저장하지 못했습니다."); }
    finally { setAutoForwardBusy(false); }
  }
  async function removeAutoForwardExceptions(ids: string[]): Promise<boolean> {
    if (!token || autoForwardBusy || !ids.length) return false;
    setAutoForwardBusy(true); setAutoForwardError("");
    try { await deleteAutoForwardExceptions(token, ids); await loadAutoForwardSettings(token, false); return true; }
    catch (error) { setAutoForwardError(normalizeClientError(error, "예외 자동전달 규칙을 삭제하지 못했습니다.")); return false; }
    finally { setAutoForwardBusy(false); }
  }

  async function saveOutOfOfficePolicy() {
    if (!token || !outOfOfficeSettings || outOfOfficeBusy) return;
    setOutOfOfficeBusy(true);
    setOutOfOfficeError("");
    try {
      await updateOutOfOfficeSettings(token, outOfOfficeSettings);
      const confirmed = await fetchOutOfOfficeSettings(token);
      setOutOfOfficeSettings(confirmed);
      setSavedOutOfOfficeSettings(confirmed);
      pushFeedback({ id: `out-of-office-${confirmed.version}`, source: "mail-settings", tone: "success", title: "부재중응답 정책을 저장했습니다." });
    } catch (error) {
      setOutOfOfficeError(normalizeClientError(error, "부재중응답 정책을 저장하지 못했습니다."));
    } finally {
      setOutOfOfficeBusy(false);
    }
  }

  async function runEmptyMailbox(mailbox: MailboxSettingsRow, confirmPermanent: boolean): Promise<boolean> {
    if (!token || mailboxSettingsBusyKey) return false;
    setMailboxSettingsBusyKey(`empty:${mailbox.mailboxKey}`);
    setMailboxSettingsError("");
    try {
      const result = await emptyMailbox(token, mailbox, confirmPermanent);
      await Promise.all([
        loadMailboxSettings(token, false),
        loadMailWorkspace(token, activeMailbox, undefined, activeMailFolder, mailListQuery),
        loadMailStorage(token),
      ]);
      pushFeedback({ id: `mailbox-empty-${mailbox.mailboxKey}-${Date.now()}`, source: "mail-settings", tone: "success", title: `${mailbox.name}에서 ${result.changedCount}개 보기를 제거했습니다.` });
      return true;
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409 && error.currentCount !== null) {
        await loadMailboxSettings(token, false);
        setMailboxSettingsError(`메일함 내용이 변경되었습니다. 현재 ${error.currentCount}개입니다. 최신 건수로 다시 확인해 주세요.`);
      } else {
        setMailboxSettingsError(normalizeClientError(error, "메일함 비우기에 실패했습니다. 최신 건수를 확인해 다시 시도하세요."));
      }
      return false;
    } finally {
      setMailboxSettingsBusyKey("");
    }
  }

  async function startMailboxBackup(mailbox: MailboxSettingsRow) {
    if (!token || mailboxSettingsBusyKey) return;
    setMailboxSettingsBusyKey(`backup:${mailbox.mailboxKey}`);
    setMailboxSettingsError("");
    try {
      await createMailboxBackup(token, mailbox.mailboxKey);
      await refreshMailboxBackupJobs(token);
      pushFeedback({ id: `mailbox-backup-${mailbox.mailboxKey}-${Date.now()}`, source: "mail-settings", tone: "success", title: `${mailbox.name} 백업을 요청했습니다.` });
    } catch (error) {
      setMailboxSettingsError(normalizeClientError(error, "메일함 백업 요청에 실패했습니다."));
    } finally {
      setMailboxSettingsBusyKey("");
    }
  }

  async function rerunMailboxBackup(job: MailBackupJob) {
    if (!token || mailboxSettingsBusyKey) return;
    setMailboxSettingsBusyKey(`retry:${job.jobId}`);
    setMailboxSettingsError("");
    try {
      await retryMailboxBackup(token, job.jobId);
      await refreshMailboxBackupJobs(token);
    } catch (error) {
      setMailboxSettingsError(normalizeClientError(error, "메일함 백업 재시도에 실패했습니다."));
    } finally {
      setMailboxSettingsBusyKey("");
    }
  }

  async function saveMailboxBackupFile(job: MailBackupJob) {
    if (!token || mailboxSettingsBusyKey) return;
    setMailboxSettingsBusyKey(`download:${job.jobId}`);
    setMailboxSettingsError("");
    try {
      await downloadMailboxBackup(token, job);
    } catch (error) {
      setMailboxSettingsError(normalizeClientError(error, "백업 파일 다운로드에 실패했습니다."));
    } finally {
      setMailboxSettingsBusyKey("");
    }
  }

  async function saveMailBasicSettings() {
    if (!token || !mailPreferences) return;
    setMailPreferencesLoading(true);
    setMailPreferencesError("");
    setMailPreferencesConflict(false);
    try {
      await updateMailBasicPreferences(token, mailPreferences);
      const confirmed = await fetchMailBasicPreferences(token);
      setMailPreferences(confirmed);
      setSavedMailPreferences(confirmed);
      pushFeedback({ id: `mail-basic-save-${confirmed.version}`, source: "mail-settings", tone: "success", title: "메일 기본환경을 저장했습니다." });
    } catch (error) {
      setMailPreferencesConflict(error instanceof ApiRequestError && error.status === 409);
      setMailPreferencesError(normalizeClientError(error, "메일 기본환경 저장에 실패했습니다."));
    } finally {
      setMailPreferencesLoading(false);
    }
  }

  async function resetMailBasicSettings() {
    if (!token || !window.confirm("메일 기본환경을 서버 기본값으로 되돌릴까요?")) return;
    setMailPreferencesLoading(true);
    setMailPreferencesError("");
    try {
      await resetMailBasicPreferences(token);
      const confirmed = await fetchMailBasicPreferences(token);
      setMailPreferences(confirmed);
      setSavedMailPreferences(confirmed);
      pushFeedback({ id: `mail-basic-reset-${confirmed.updatedAt}`, source: "mail-settings", tone: "success", title: "기본값을 적용했습니다." });
    } catch (error) {
      setMailPreferencesError(normalizeClientError(error, "기본값 적용에 실패했습니다."));
    } finally {
      setMailPreferencesLoading(false);
    }
  }

  async function reloadMailBasicSettings() {
    if (!token) return;
    setMailPreferencesLoading(true);
    try {
      const latest = await fetchMailBasicPreferences(token);
      setMailPreferences(latest);
      setSavedMailPreferences(latest);
      setMailPreferencesConflict(false);
      setMailPreferencesError("");
    } catch (error) {
      setMailPreferencesError(normalizeClientError(error, "서버 최신 설정을 불러오지 못했습니다."));
    } finally {
      setMailPreferencesLoading(false);
    }
  }

  async function reloadMailSignatures() {
    if (!token) return;
    setMailSignaturesLoading(true);
    try {
      const latest = await fetchMailSignatures(token);
      setMailSignatures(latest);
      setSavedMailSignatures(latest);
      setMailSignaturesConflict(false);
      setMailSignaturesError("");
    } catch (error) {
      setMailSignaturesError(normalizeClientError(error, "서버 최신 서명을 불러오지 못했습니다."));
    } finally {
      setMailSignaturesLoading(false);
    }
  }

  async function saveMailSignaturePreferences() {
    if (!token || !mailSignatures) return;
    setMailSignaturesLoading(true);
    setMailSignaturesError("");
    setMailSignaturesConflict(false);
    try {
      await updateMailSignaturePreferences(token, mailSignatures);
      const confirmed = await fetchMailSignatures(token);
      setMailSignatures(confirmed);
      setSavedMailSignatures(confirmed);
      pushFeedback({ id: `mail-signature-preferences-${confirmed.version}`, source: "mail-settings", tone: "success", title: "서명 설정을 저장했습니다." });
    } catch (error) {
      setMailSignaturesConflict(error instanceof ApiRequestError && error.status === 409);
      setMailSignaturesError(normalizeClientError(error, "서명 설정 저장에 실패했습니다."));
    } finally {
      setMailSignaturesLoading(false);
    }
  }

  async function saveMailSignature(signature: MailSignature | null, form: { name: string; contentText: string; makeDefault: boolean }): Promise<boolean> {
    if (!token) return false;
    setMailSignaturesLoading(true);
    setMailSignaturesError("");
    setMailSignaturesConflict(false);
    try {
      if (signature) {
        await updateMailSignature(token, signature, { name: form.name, contentText: form.contentText });
      } else {
        await createMailSignature(token, form);
      }
      let confirmed = await fetchMailSignatures(token);
      if (signature && form.makeDefault && confirmed.defaultSignatureId !== signature.signatureId) {
        await updateMailSignaturePreferences(token, {
          ...confirmed,
          defaultSignatureId: signature.signatureId,
        });
        confirmed = await fetchMailSignatures(token);
      }
      setMailSignatures(confirmed);
      setSavedMailSignatures(confirmed);
      pushFeedback({ id: `mail-signature-save-${Date.now()}`, source: "mail-settings", tone: "success", title: signature ? "서명을 수정했습니다." : "서명을 추가했습니다." });
      return true;
    } catch (error) {
      setMailSignaturesConflict(error instanceof ApiRequestError && error.status === 409);
      setMailSignaturesError(normalizeClientError(error, "서명 저장에 실패했습니다."));
      return false;
    } finally {
      setMailSignaturesLoading(false);
    }
  }

  async function removeMailSignatures(signatures: MailSignature[]): Promise<boolean> {
    if (!token || !signatures.length) return false;
    setMailSignaturesLoading(true);
    setMailSignaturesError("");
    setMailSignaturesConflict(false);
    try {
      if (signatures.length === 1) await deleteMailSignature(token, signatures[0]);
      else await bulkDeleteMailSignatures(token, signatures);
      const confirmed = await fetchMailSignatures(token);
      setMailSignatures(confirmed);
      setSavedMailSignatures(confirmed);
      pushFeedback({ id: `mail-signature-delete-${Date.now()}`, source: "mail-settings", tone: "success", title: `${signatures.length}개 서명을 삭제했습니다.` });
      return true;
    } catch (error) {
      setMailSignaturesConflict(error instanceof ApiRequestError && error.status === 409);
      setMailSignaturesError(normalizeClientError(error, "서명 삭제에 실패했습니다."));
      return false;
    } finally {
      setMailSignaturesLoading(false);
    }
  }

  function closeMailBasicSettings() {
    const basicDirty = Boolean(mailPreferences && savedMailPreferences && JSON.stringify(mailPreferences) !== JSON.stringify(savedMailPreferences));
    const signatureDirty = Boolean(mailSignatures && savedMailSignatures && JSON.stringify(mailSignatures) !== JSON.stringify(savedMailSignatures));
    const outOfOfficeDirty = Boolean(outOfOfficeSettings && savedOutOfOfficeSettings && JSON.stringify(outOfOfficeSettings) !== JSON.stringify(savedOutOfOfficeSettings));
    const dirty = basicDirty || signatureDirty || outOfOfficeDirty;
    if (dirty && !window.confirm("저장하지 않은 변경을 취소하고 메일함으로 돌아갈까요?")) return;
    setMailPreferences(savedMailPreferences);
    setMailSignatures(savedMailSignatures);
    setOutOfOfficeSettings(savedOutOfOfficeSettings);
    setMailSettingsOpen(false);
  }

  function openMailQuickSearch() {
    setSearchFilter("mail");
    setSearchOpen(Boolean(searchText.trim()));
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }

  function formatStorageBytes(value: number) {
    if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
    if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`;
    if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${value} B`;
  }

  async function toggleSelectedMailStar() {
    if (!token || !selectedMailId) return;
    setMailLoading(true);
    setMailError("");
    try {
      const response = await toggleMailStar(token, selectedMailId);
      setInboxMails((current) =>
        current.map((item) => (item.mailId === selectedMailId ? { ...item, isStarred: Boolean(response.isStarred) } : item)),
      );
      setSentMails((current) =>
        current.map((item) => (item.mailId === selectedMailId ? { ...item, isStarred: Boolean(response.isStarred) } : item)),
      );
      setDraftMails((current) =>
        current.map((item) => (item.mailId === selectedMailId ? { ...item, isStarred: Boolean(response.isStarred) } : item)),
      );
      setSelectedMailDetail((current) => (current ? { ...current } : current));
      await selectMail(token, selectedMailId, activeMailbox, { markRead: false });
      setMessage(response.isStarred ? "메일을 중요 표시했습니다." : "메일 중요 표시를 해제했습니다.");
    } catch (error) {
      setMailError(normalizeClientError(error, "중요 표시 변경 실패"));
    } finally {
      setMailLoading(false);
    }
  }

  async function handleSelectedMailReadAction() {
    if (!token || !selectedMailId) return;
    setMailLoading(true);
    setMailError("");
    try {
      const mailbox = inferMailboxFromMailId(selectedMailId);
      const shouldMarkRead = mailbox === "inbox" && !selectedMailSummary?.isRead;
      if (shouldMarkRead) {
        await markMailRead(token, selectedMailId);
        setInboxMails((current) => current.map((item) => (item.mailId === selectedMailId ? { ...item, isRead: true } : item)));
      }
      const detail = await fetchMailDetail(token, selectedMailId);
      setSelectedMailDetail(detail);
      setMessage(shouldMarkRead ? "메일을 읽음 처리했습니다." : "메일 읽음 상태를 확인했습니다.");
    } catch (error) {
      setMailError(normalizeClientError(error, "읽음 상태 확인 실패"));
    } finally {
      setMailLoading(false);
    }
  }

  async function loadRecipientSuggestions(): Promise<RecipientSuggestion[]> {
    if (!token) return [];
    setRecipientPickerLoading(true);
    setMailError("");
    try {
      const [recent, directory, contacts] = await Promise.allSettled([
        fetchRecentMailRecipients(token),
        fetchWorkspaceDirectory(token),
        fetchContacts(token),
      ]);
      const merged = new Map<string, RecipientSuggestion>();
      const add = (email: string, name: string, detail: string, source: RecipientSuggestion["source"]) => {
        const normalized = email.trim().toLowerCase();
        if (!normalized) return;
        const key = `${source}:${normalized}`;
        if (!merged.has(key)) merged.set(key, { email: normalized, name, detail, source });
      };
      if (contacts.status === "fulfilled") {
        contacts.value.items.forEach((item: WorkspaceContact) => add(item.email, item.name, item.company_name || "개인 연락처", "contact"));
      }
      if (directory.status === "fulfilled") {
        directory.value.users.forEach((item: WorkspaceDirectory["users"][number]) => add(item.email, item.name, `${item.department_name} · ${item.role_name}`, "directory"));
      }
      if (recent.status === "fulfilled") {
        recent.value.recipients.forEach((item: MailRecentRecipient) => add(item.email, item.name || item.email, item.departmentName || "최근 수신자", "recent"));
      }
      const failedSourceCount = [recent, directory, contacts].filter((result) => result.status === "rejected").length;
      if (failedSourceCount === 3) {
        throw new Error("수신자 원본을 불러오지 못했습니다.");
      }
      if (failedSourceCount > 0) {
        setMessage("일부 수신자 원본을 불러오지 못해 확인 가능한 목록만 표시합니다.");
      }
      const suggestions = [...merged.values()];
      setRecipientSuggestions(suggestions);
      return suggestions;
    } catch (error) {
      setMailError(normalizeClientError(error, "수신자 목록 조회 실패"));
      return [];
    } finally {
      setRecipientPickerLoading(false);
    }
  }

  async function openRecipientPicker(target: RecipientPickerTarget, query = "", source: RecipientPickerSource = "contact") {
    setRecipientPickerTarget(target);
    setRecipientPickerSource(source);
    setRecipientPickerQuery(query);
    if (!recipientSuggestions.length) await loadRecipientSuggestions();
  }

  async function resolveRecipientInput(target: RecipientPickerTarget, rawValue = mailComposeForm[target]): Promise<{ ok: true; value: string } | { ok: false }> {
    const raw = rawValue.trim();
    if (!raw) return { ok: true, value: "" };
    const suggestions = recipientSuggestions.length ? recipientSuggestions : await loadRecipientSuggestions();
    const resolved: string[] = [];
    for (const token of raw.split(/[;,\n]/u).map((item) => item.trim()).filter(Boolean)) {
      if (/^[^\s@]+@[^\s@]+$/u.test(token) || /<\s*[^<>\s]+@[^<>\s]+\s*>$/u.test(token)) {
        resolved.push(token);
        continue;
      }
      const matches = suggestions.filter((item) => item.name.trim().localeCompare(token, undefined, { sensitivity: "base" }) === 0 && item.email.trim());
      const uniqueByEmail = new Map(matches.map((item) => [item.email.trim().toLowerCase(), item]));
      if (uniqueByEmail.size === 1) {
        resolved.push(formatConfirmedRecipient([...uniqueByEmail.values()][0]));
        continue;
      }
      const preferredSource: RecipientPickerSource = matches.some((item) => item.source === "contact")
        ? "contact"
        : matches.some((item) => item.source === "directory")
          ? "directory"
          : matches.some((item) => item.source === "recent")
            ? "recent"
            : "contact";
      await openRecipientPicker(target, token, preferredSource);
      setMailError(uniqueByEmail.size > 1
        ? `동일한 이름 '${token}'에 여러 이메일이 있습니다. 정확한 주소를 선택해 주세요.`
        : `주소록에서 이메일이 등록된 이름 '${token}'을 찾지 못했습니다.`);
      return { ok: false };
    }
    return { ok: true, value: resolved.join(", ") };
  }

  async function confirmRecipientInput(target: RecipientPickerTarget) {
    const result = await resolveRecipientInput(target);
    if (!result.ok) return;
    setMailComposeForm((current) => ({ ...current, [target]: result.value }));
    setMailError("");
  }

  function addRecipientSuggestion(suggestion: RecipientSuggestion) {
    if (!recipientPickerTarget) return;
    setMailComposeForm((current) => {
      const existingTokens = current[recipientPickerTarget].split(/[;,\n]/u).map((item) => item.trim()).filter(Boolean);
      const existingEmails = normalizeMailRecipients(current[recipientPickerTarget], uiContract.company.domain);
      const next = existingEmails.includes(suggestion.email) ? existingTokens : [...existingTokens, formatConfirmedRecipient(suggestion)];
      return { ...current, [recipientPickerTarget]: next.join(", ") };
    });
    setRecipientPickerTarget(null);
    setRecipientPickerQuery("");
  }

  function addMailComposeFiles(files: FileList | null) {
    if (!files?.length) return;
    const additions = Array.from(files);
    const nextCount = mailComposeAttachmentCount + additions.length;
    if (nextCount > MAIL_ATTACHMENT_LIMITS.maxFiles) {
      setMailError(`첨부는 최대 ${MAIL_ATTACHMENT_LIMITS.maxFiles}개까지 가능합니다.`);
      return;
    }
    if (additions.some((file) => file.size === 0 || file.size > MAIL_ATTACHMENT_LIMITS.maxFileBytes)) {
      setMailError("빈 파일 또는 10 MB를 초과한 파일은 첨부할 수 없습니다.");
      return;
    }
    const totalBytes = mailComposeAttachmentBytes + additions.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > MAIL_ATTACHMENT_LIMITS.maxTotalBytes) {
      setMailError("첨부 파일 합계는 25 MB를 초과할 수 없습니다.");
      return;
    }
    setMailError("");
    setMailComposeFiles((current) => [
      ...current,
      ...additions.map((file) => ({ id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`, file })),
    ]);
  }

  function removeMailComposeAttachment(id: string) {
    setMailComposeFiles((current) => current.filter((item) => item.id !== id));
  }

  function replaceMailComposeInlineImages(next: MailComposeInlineImage[]) {
    const nextUrls = new Set(next.map((item) => item.objectUrl));
    for (const url of new Set(mailComposeInlineImagesRef.current.map((item) => item.objectUrl))) {
      if (!nextUrls.has(url)) URL.revokeObjectURL(url);
    }
    mailComposeInlineImagesRef.current = next;
    setMailComposeInlineImages(next);
  }

  function clearMailComposeInlineImages() {
    mailComposeInlineImageRequestRef.current += 1;
    replaceMailComposeInlineImages([]);
  }

  function handleMailDocumentChange(document: JSONContent) {
    try {
      const projection = projectMailDocument(document);
      const referencedContentIds = new Set(projection.contentIds);
      replaceMailComposeInlineImages(mailComposeInlineImagesRef.current.filter((item) => referencedContentIds.has(item.contentId)));
      setMailComposeForm((current) => ({
        ...current,
        bodyDocument: document,
        bodyHtml: projection.bodyHtml,
        bodyText: projection.bodyText,
      }));
      setMailError("");
    } catch {
      setMailError("메일 본문을 저장 형식으로 변환하지 못했습니다.");
    }
  }

  async function uploadComposeInlineImage(file: File): Promise<InlineImageDraft> {
    if (!token) throw new Error("로그인 후 본문 이미지를 올릴 수 있습니다.");
    if (mailComposeAttachmentCount >= MAIL_ATTACHMENT_LIMITS.maxFiles || mailComposeAttachmentBytes + file.size > MAIL_ATTACHMENT_LIMITS.maxTotalBytes) {
      throw new Error("본문 이미지를 포함한 첨부 제한을 초과했습니다.");
    }
    const targetToken = token;
    const requestId = mailComposeInlineImageRequestRef.current;
    const uploaded = await uploadMailAttachment(targetToken, file, "inline");
    if (uploaded.disposition !== "inline" || !uploaded.contentId || !uploaded.previewPath) {
      throw new Error("본문 이미지 업로드 응답이 올바르지 않습니다.");
    }
    const blob = await fetchMailInlinePreview(targetToken, uploaded.previewPath);
    const objectUrl = URL.createObjectURL(blob);
    const editorObjectUrl = URL.createObjectURL(blob);
    if (requestId !== mailComposeInlineImageRequestRef.current) {
      URL.revokeObjectURL(objectUrl);
      URL.revokeObjectURL(editorObjectUrl);
      throw new Error("본문 이미지 작성창이 바뀌어 업로드를 취소했습니다.");
    }
    const draft: MailComposeInlineImage = {
      origin: "staged",
      uploadId: uploaded.uploadId,
      contentId: uploaded.contentId,
      fileName: uploaded.fileName,
      contentType: uploaded.contentType,
      sizeBytes: uploaded.sizeBytes,
      previewPath: uploaded.previewPath,
      objectUrl,
      alt: uploaded.fileName,
    };
    replaceMailComposeInlineImages([...mailComposeInlineImagesRef.current.filter((item) => item.contentId !== draft.contentId), draft]);
    return { ...draft, uploadId: draft.uploadId!, objectUrl: editorObjectUrl };
  }

  async function hydrateComposeInlineImages(attachments: MailDetail["attachments"]) {
    if (!token) return;
    const requestId = mailComposeInlineImageRequestRef.current + 1;
    mailComposeInlineImageRequestRef.current = requestId;
    replaceMailComposeInlineImages([]);
    const drafts = await Promise.all(attachments.filter((attachment) => (
      attachment.disposition === "inline" && attachment.contentId && attachment.previewPath
    )).map(async (attachment) => {
      try {
        const blob = await fetchMailInlinePreview(token, attachment.previewPath!);
        return {
          origin: "persisted" as const,
          contentId: attachment.contentId!,
          fileName: attachment.fileName,
          contentType: attachment.contentType,
          sizeBytes: attachment.sizeBytes,
          previewPath: attachment.previewPath!,
          objectUrl: URL.createObjectURL(blob),
          alt: attachment.fileName,
        } as MailComposeInlineImage;
      } catch {
        return null;
      }
    }));
    const resolved = drafts.filter((draft): draft is NonNullable<typeof draft> => draft !== null);
    if (requestId !== mailComposeInlineImageRequestRef.current) {
      for (const draft of resolved) URL.revokeObjectURL(draft.objectUrl);
      return;
    }
    replaceMailComposeInlineImages(resolved);
  }

  const resolveComposeInlineImageUrl = useCallback(
    (contentId: string) => mailComposeInlineImages.find((item) => item.contentId === contentId)?.objectUrl,
    [mailComposeInlineImages],
  );

  useEffect(() => () => {
    for (const url of new Set(mailComposeInlineImagesRef.current.map((item) => item.objectUrl))) URL.revokeObjectURL(url);
    mailComposeInlineImagesRef.current = [];
  }, []);

  async function uploadComposeAttachments(targetToken: string): Promise<MailAttachment[]> {
    const uploaded: MailAttachment[] = [];
    for (const item of mailComposeFiles) {
      uploaded.push(await uploadMailAttachment(targetToken, item.file));
    }
    return uploaded;
  }

  async function handleMailAttachmentDownload(attachmentId: string, fileName: string) {
    if (!token || !selectedMailDetail) return;
    try {
      await downloadMailAttachment(token, selectedMailDetail.mailId, attachmentId, fileName);
    } catch (error) {
      setMailDetailError(normalizeClientError(error, "첨부 다운로드 실패"));
    }
  }


  async function submitMailCompose(action: "draft" | "send" | "schedule") {
    if (!token) return;
    let resolvedForm = mailComposeForm;
    if (action !== "draft") {
      const resolvedTo = await resolveRecipientInput("to", mailComposeForm.to);
      if (!resolvedTo.ok) return;
      const resolvedCc = await resolveRecipientInput("cc", mailComposeForm.cc);
      if (!resolvedCc.ok) return;
      const resolvedBcc = await resolveRecipientInput("bcc", mailComposeForm.bcc);
      if (!resolvedBcc.ok) return;
      resolvedForm = { ...mailComposeForm, to: resolvedTo.value, cc: resolvedCc.value, bcc: resolvedBcc.value };
      setMailComposeForm(resolvedForm);
      setMailError("");
    }
    const to = normalizeMailRecipients(resolvedForm.to, uiContract.company.domain);
    const cc = normalizeMailRecipients(resolvedForm.cc, uiContract.company.domain);
    const bcc = normalizeMailRecipients(resolvedForm.bcc, uiContract.company.domain);
    const recipients = [...new Set([...to, ...cc, ...bcc])];
    const subject = mailComposeForm.subject.trim();
    const bodyText = mailComposeForm.bodyText.trim();
    const hasDraftContent = Boolean(recipients.length || subject || bodyText || mailComposeAttachmentCount);
    if (mailComposeAttachmentCount > MAIL_ATTACHMENT_LIMITS.maxFiles) {
      setMailError(`첨부는 최대 ${MAIL_ATTACHMENT_LIMITS.maxFiles}개까지 가능합니다.`);
      return;
    }
    if (mailComposeAttachmentBytes > MAIL_ATTACHMENT_LIMITS.maxTotalBytes) {
      setMailError("첨부 파일 합계는 25 MB를 초과할 수 없습니다.");
      return;
    }
    if (action === "draft" && !hasDraftContent) {
      setMailError("저장할 초안 내용을 입력해 주세요.");
      return;
    }
    if (action !== "draft" && !recipients.length) {
      setMailError("받는 사람을 입력해 주세요.");
      return;
    }
    if (action !== "draft" && !subject) {
      setMailError("제목을 입력해 주세요.");
      return;
    }
    if (action !== "draft" && !bodyText) {
      setMailError("본문을 입력해 주세요.");
      return;
    }
    if (action === "schedule" && !mailComposeForm.scheduledAt) {
      setMailError("예약 발송 시각을 입력해 주세요.");
      return;
    }
    let scheduledAt: string | undefined;
    if (action === "schedule") {
      const scheduledDate = new Date(mailComposeForm.scheduledAt);
      if (Number.isNaN(scheduledDate.getTime())) {
        setMailError("예약 발송 시각이 올바르지 않습니다.");
        return;
      }
      scheduledAt = scheduledDate.toISOString();
    }
    const hasExternal = hasExternalRecipients(recipients, uiContract.company.domain);
    if (action !== "draft" && hasExternal && !mailDeliveryStatus?.provider.enabled) {
      setMailError("자체 SMTP 엔진이 비활성화되어 외부 수신자에게 발송할 수 없습니다.");
      return;
    }
    if (action !== "draft" && hasExternal && !mailDeliveryStatus) {
      setMailError("외부 발송 상태를 아직 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }
    let confirmed = false;
    if (action !== "draft") {
      try {
        const currentPreferences = await fetchMailBasicPreferences(token);
        setMailPreferences(currentPreferences);
        setSavedMailPreferences(currentPreferences);
        if (currentPreferences.confirmBeforeSend && !window.confirm(action === "schedule" ? "이 메일을 예약 발송할까요?" : "이 메일을 발송할까요?")) return;
        confirmed = true;
      } catch (error) {
        setMailError(normalizeClientError(error, "발송 설정을 확인하지 못했습니다."));
        return;
      }
    }
    setMailLoading(true);
    setMailError("");
    try {
      const attachments = [
        ...await uploadComposeAttachments(token),
        ...buildComposeInlineAttachments(mailComposeForm.bodyDocument, mailComposeInlineImages),
      ];
      const payload = {
        to, cc, bcc, subject,
        bodyHtml: mailComposeForm.bodyHtml,
        bodyText: mailComposeForm.bodyText,
        attachments, scheduledAt, confirmed,
        composeAction: mailComposeContext,
        sourceMailId: mailComposeSourceMailId || undefined,
        copiedAttachmentIds: mailComposeContext === "forward"
          ? selectedForwardAttachmentIds
          : [],
      };
      const response = editingScheduledMailId && action === "schedule"
        ? await updateScheduledMail(token, editingScheduledMailId, payload)
        : editingDraftMailId && action === "draft"
          ? await updateMailDraft(token, editingDraftMailId, { ...payload, retainedAttachmentIds: mailComposeRetainedAttachments.map((attachment) => attachment.attachmentId) })
          : action === "draft" ? await saveMailDraft(token, payload) : await sendMail(token, payload);
      if (action === "draft") {
        setMessage(editingDraftMailId ? "임시저장 메일을 수정했습니다." : "메일을 임시저장했습니다.");
      } else if (action === "schedule") {
        setMessage(editingScheduledMailId ? "예약 메일을 수정했습니다." : "메일을 예약했습니다.");
      } else if (action === "send" && "externalCount" in response && response.externalCount) {
        setMessage(`메일을 발송했습니다. 외부 ${response.externalCount}건 / 대기 ${response.queuedCount} / 운영 설정 필요 ${response.blockedCount}`);
      } else {
        setMessage("메일을 발송했습니다.");
      }
      setMailComposeForm(createEmptyMailComposeForm());
      setMailComposeFiles([]);
      clearMailComposeInlineImages();
      setMailComposeSourceDetail(null);
      setMailComposeSourceMailId("");
      setEditingScheduledMailId("");
      setEditingDraftMailId("");
      setMailComposePersistedAttachments([]);
      setSelectedForwardAttachmentIds([]);
      setOutgoingTranslationOpen(false);
      setMailTranslationPreview(null);
      setQuickComposeMode("none");
      const nextMailbox: MailboxType = action === "draft" ? "inbox" : "sent";
      setMailFolder(action === "draft" ? "draft" : action === "schedule" ? "scheduled" : "sent");
      await refreshMailDeliveryState(token);
      await loadMailWorkspace(
        token,
        nextMailbox,
        response.mailId,
        action === "draft" ? "draft" : action === "schedule" ? "scheduled" : "sent",
        { ...mailListQuery, offset: 0 },
      );
    } catch (error) {
      const fallback = action === "draft" ? "메일 임시저장 실패" : action === "schedule" ? "메일 예약 실패" : "메일 발송 실패";
      setMailError(normalizeClientError(error, fallback));
    } finally {
      setMailLoading(false);
    }
  }

  function openMailComposeFromDetail(mode: "reply" | "reply_all" | "forward") {
    if (!selectedMailDetail) return;
    void refreshMailSignaturesForCompose();
    const replyRecipients = mode === "forward"
      ? { to: [], cc: [] }
      : buildMailReplyRecipients(selectedMailDetail, me?.userEmail || "", mode);
    setMailComposeForm(createMailComposeForm({
      to: replyRecipients.to.join(", "),
      cc: replyRecipients.cc.join(", "),
      bcc: "",
      subject: withMailSubjectPrefix(selectedMailDetail.subject, mode),
      bodyText: buildMailQuotedBody(selectedMailDetail),
      bodyHtml: mode === "forward" ? selectedMailDetail.bodyHtml : null,
      scheduledAt: "",
    }));
    setMailComposeContext(mode);
    setMailComposeSourceDetail(selectedMailDetail);
    setMailComposeSourceMailId(selectedMailDetail.mailId);
    setSelectedForwardAttachmentIds(
      mode === "forward"
        ? selectedMailDetail.attachments.map((item) => item.attachmentId).filter(Boolean)
        : [],
    );
    setMailComposeFiles([]);
    if (mode === "forward") void hydrateComposeInlineImages(selectedMailDetail.attachments.filter((attachment) => selectedMailDetail.bodyHtml?.includes(`cid:${attachment.contentId ?? ""}`)));
    setMailComposePosition(null);
    setComposeWindow("normal");
    setMailError("");
    setQuickComposeMode("mail");
  }

  function resetMailCompose() {
    setMailComposeForm(createEmptyMailComposeForm());
    setMailComposeContext("new");
    setMailComposePosition(null);
    setMailComposeFiles([]);
    clearMailComposeInlineImages();
    setMailComposeSourceDetail(null);
    setMailComposeSourceMailId("");
    setEditingScheduledMailId("");
    setEditingDraftMailId("");
    setMailComposePersistedAttachments([]);
    setSelectedForwardAttachmentIds([]);
    setRecipientPickerTarget(null);
    setRecipientPickerQuery("");
    setComposeWindow("normal");
    setOutgoingTranslationOpen(false);
    setMailTranslationPreview(null);
    setTranslationError("");
    setQuickComposeMode("none");
    setMailComposeCloseConfirmOpen(false);
  }

  function closeMailCompose() {
    const hasDraft = isMailComposeDirty(mailComposeForm, mailComposeInlineImages.length + mailComposeAttachmentCount);
    if (hasDraft) {
      setMailComposeCloseConfirmOpen(true);
      return;
    }
    resetMailCompose();
  }

  async function loadMessengerWorkspace(targetToken: string, preferredRoomId?: string) {
    setMessengerLoading(true);
    setMessengerError("");
    try {
      const roomsResponse = await fetchMessengerRooms(targetToken);
      const rooms = roomsResponse.rooms ?? [];
      setMessengerRoomsData(rooms);
      const requestedRoomId = preferredRoomId || selectedRoomId;
      const targetRoomId = rooms.some((room) => room.roomId === requestedRoomId)
        ? requestedRoomId
        : rooms[0]?.roomId || "";
      if (targetRoomId) {
        const [roomDetail, messagesResponse] = await Promise.all([
          fetchMessengerRoom(targetToken, targetRoomId),
          fetchMessengerMessages(targetToken, targetRoomId),
        ]);
        setSelectedRoomId(targetRoomId);
        setSelectedRoomDetail(roomDetail);
        setRoomMessages(messagesResponse.messages ?? []);
      } else {
        setSelectedRoomId("");
        setSelectedRoomDetail(null);
        setRoomMessages([]);
      }
    } catch (error) {
      setMessengerError(normalizeClientError(error, "메신저 조회 실패"));
      setMessengerRoomsData([]);
      setHomeSchedules([]);
      setSelectedRoomId("");
      setSelectedRoomDetail(null);
      setRoomMessages([]);
    } finally {
      setMessengerLoading(false);
    }
  }

  async function selectMessengerRoom(targetToken: string, roomId: string, options?: { markRead?: boolean }) {
    setMessengerLoading(true);
    setMessengerError("");
    try {
      if (options?.markRead) {
        await readMessengerRoom(targetToken, roomId);
      }
      const [roomDetail, messagesResponse] = await Promise.all([
        fetchMessengerRoom(targetToken, roomId),
        fetchMessengerMessages(targetToken, roomId),
      ]);
      setSelectedRoomId(roomId);
      setSelectedRoomDetail(roomDetail);
      setRoomMessages(messagesResponse.messages ?? []);
      if (options?.markRead) {
        setMessengerRoomsData((current) => current.map((item) => (item.roomId === roomId ? { ...item, unreadCount: 0 } : item)));
      }
    } catch (error) {
      setMessengerError(normalizeClientError(error, "대화방 조회 실패"));
    } finally {
      setMessengerLoading(false);
    }
  }

  async function handleMessengerSend() {
    if (!token || !selectedRoomId || !messengerDraft.trim()) return;
    setMessengerLoading(true);
    setMessengerError("");
    try {
      await sendMessengerMessage(token, selectedRoomId, { body: messengerDraft.trim() });
      setMessengerDraft("");
      await selectMessengerRoom(token, selectedRoomId, { markRead: true });
    } catch (error) {
      setMessengerError(normalizeClientError(error, "메시지 전송 실패"));
    } finally {
      setMessengerLoading(false);
    }
  }

  async function handleMessengerOwnerTransfer() {
    if (!token || !selectedRoomId || !selectedRoomDetail || !messengerNewOwnerId) return;
    setMessengerLoading(true);
    setMessengerError("");
    try {
      await transferMessengerRoomOwner(token, selectedRoomId, messengerNewOwnerId, selectedRoomDetail.updatedAt);
      setMessengerLifecycleAction("none");
      setMessengerNewOwnerId("");
      await selectMessengerRoom(token, selectedRoomId, { markRead: false });
    } catch (error) {
      setMessengerError(normalizeClientError(error, "방장 이전 실패"));
    } finally {
      setMessengerLoading(false);
    }
  }

  async function handleMessengerLeave() {
    if (!token || !selectedRoomId) return;
    setMessengerLoading(true);
    setMessengerError("");
    try {
      await leaveMessengerRoom(token, selectedRoomId);
      setMessengerLifecycleAction("none");
      setSelectedRoomId("");
      setSelectedRoomDetail(null);
      setRoomMessages([]);
      await loadMessengerWorkspace(token);
    } catch (error) {
      setMessengerError(normalizeClientError(error, "대화방 나가기 실패"));
    } finally {
      setMessengerLoading(false);
    }
  }

  async function handleMessengerDelete() {
    if (!token || !selectedRoomId) return;
    setMessengerLoading(true);
    setMessengerError("");
    try {
      await deleteMessengerRoom(token, selectedRoomId);
      setMessengerLifecycleAction("none");
      setSelectedRoomId("");
      setSelectedRoomDetail(null);
      setRoomMessages([]);
      await loadMessengerWorkspace(token);
    } catch (error) {
      setMessengerError(normalizeClientError(error, "대화방 삭제 실패"));
    } finally {
      setMessengerLoading(false);
    }
  }

  async function loadHomeSchedules(targetToken: string) {
    const response = await fetchSchedules(targetToken);
    setHomeSchedules(response.items ?? []);
  }

  async function loadHomeNotices(targetToken: string) {
    const response = await fetchWorkspaceNotices(targetToken);
    setHomeNotices(response.items ?? []);
  }

  async function openHomeItem(target: "mail" | "approval" | "schedule" | "messenger" | "notices", itemId: string) {
    if (target === "mail") {
      setPortalMenu("mail");
      await selectMail(token, itemId, "inbox", { markRead: true });
      return;
    }
    if (target === "approval") {
      setPortalMenu("approval");
      await selectApprovalDocument(itemId);
      return;
    }
    if (target === "schedule") {
      setHomeScheduleSelectionId(itemId);
      setPortalMenu("schedule");
      return;
    }
    if (target === "messenger") {
      setPortalMenu("messenger");
      await selectMessengerRoom(token, itemId, { markRead: true });
      return;
    }
    setPortalMenu("notices");
    const detail = await fetchWorkspaceNotice(token, itemId);
    setSelectedNotice(detail);
    if (!detail.is_read) {
      const read = await readWorkspaceNotice(token, itemId);
      setSelectedNotice(read);
      await loadHomeNotices(token);
    }
  }

  function closeUnifiedSearch() {
    setSearchText("");
    setSearchOpen(false);
    setSearchFilter("all");
    setSearchResults([]);
    setSearchError("");
  }

  function openSearchResult(result: UnifiedSearchResult) {
    if (result.type === "mail") {
      void selectMail(token, result.id, result.mailbox ?? "inbox", { markRead: false });
    } else if (result.type === "approval") {
      void selectApprovalDocument(result.id);
    } else if (result.type === "messenger") {
      void selectMessengerRoom(token, result.id, { markRead: false });
    } else {
      setSearchWorkspaceSelection({ menu: result.menu as "schedule" | "contacts" | "org" | "files", id: result.id });
      if (result.type === "schedule") setHomeScheduleSelectionId(result.id);
    }
    setPortalMenu(result.menu);
    closeUnifiedSearch();
  }

  useEffect(() => {
    const query = searchText.trim().toLowerCase();
    if (!token || !me || me.mustChangePassword || !query) {
      setSearchOpen(false);
      setSearchResults([]);
      setSearchError("");
      setSearchLoading(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearchOpen(true);
      setSearchLoading(true);
      setSearchError("");

      void Promise.all([fetchSchedules(token), fetchContacts(token), fetchWorkspaceDirectory(token), fetchWorkspaceFiles(token)])
        .then(([schedules, contacts, directory, files]) => {
          if (cancelled) return;
          const includes = (value: string) => value.toLowerCase().includes(query);
          const rows: UnifiedSearchResult[] = [
            ...[
              ...inboxMails.map((item) => ({ item, mailbox: "inbox" as const })),
              ...sentMails.map((item) => ({ item, mailbox: "sent" as const })),
              ...draftMails.map((item) => ({ item, mailbox: "inbox" as const })),
            ].filter(({ item }) => includes(`${item.subject} ${item.senderEmail} ${item.accountId}`)).slice(0, 5).map(({ item, mailbox }) => ({ id: item.mailId, type: "mail" as const, title: item.subject || "(제목 없음)", detail: item.senderEmail, menu: "mail" as const, mailbox })),
            ...documents.filter((item) => includes(`${item.title} ${item.creatorUserName} ${item.status}`)).slice(0, 5).map((item) => ({ id: item.id, type: "approval" as const, title: item.title, detail: item.status, menu: "approval" as const })),
            ...messengerRoomsData.filter((item) => includes(`${item.roomName} ${item.lastMessage ?? ""}`)).slice(0, 5).map((item) => ({ id: item.roomId, type: "messenger" as const, title: item.roomName, detail: item.lastMessage ?? "최근 메시지 없음", menu: "messenger" as const })),
            ...(schedules.items ?? []).filter((item) => includes(`${item.title} ${item.description}`)).slice(0, 5).map((item) => ({ id: item.id, type: "schedule" as const, title: item.title, detail: formatDateLabel(item.starts_at), menu: "schedule" as const })),
            ...(contacts.items ?? []).filter((item) => includes(`${item.name} ${item.email} ${item.company_name}`)).slice(0, 5).map((item) => ({ id: item.id, type: "contacts" as const, title: item.name, detail: item.email || item.company_name, menu: "contacts" as const })),
            ...[
              ...directory.departments.filter((item) => includes(`${item.name} ${item.department_code ?? ""}`)).map((item) => ({ id: item.id, type: "org" as const, title: item.name, detail: "부서", menu: "org" as const })),
              ...directory.users.filter((item) => includes(`${item.name} ${item.email} ${item.department_name}`)).map((item) => ({ id: item.id, type: "org" as const, title: item.name, detail: item.department_name || item.role_name, menu: "org" as const })),
            ].slice(0, 5),
            ...(files.items ?? []).filter((item) => includes(`${item.file_name} ${item.content_type}`)).slice(0, 5).map((item) => ({ id: item.id, type: "files" as const, title: item.file_name, detail: item.content_type || "파일", menu: "files" as const })),
          ];
          setSearchResults(rows);
        })
        .catch((error) => {
          if (!cancelled) {
            setSearchResults([]);
            setSearchError(normalizeClientError(error, "통합 검색 결과를 불러오지 못했습니다."));
          }
        })
        .finally(() => {
          if (!cancelled) setSearchLoading(false);
        });
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchText, token, me?.userId, me?.mustChangePassword, inboxMails, sentMails, draftMails, documents, messengerRoomsData]);

  useEffect(() => {
    if (!mailReadReceiptOpen) return;
    function handleMailReadReceiptKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMailReadReceiptOpen(false);
    }
    window.addEventListener("keydown", handleMailReadReceiptKeyDown);
    return () => window.removeEventListener("keydown", handleMailReadReceiptKeyDown);
  }, [mailReadReceiptOpen]);

  useEffect(() => {
    const hasActiveBackup = mailboxSettings?.backupJobs.some((job) => job.status === "queued" || job.status === "running") ?? false;
    if (!token || !mailSettingsOpen || mailSettingsTab !== "mailbox" || !hasActiveBackup) return;
    const pollMailboxBackups = () => void refreshMailboxBackupJobs(token);
    const intervalId = window.setInterval(pollMailboxBackups, 3_000);
    return () => window.clearInterval(intervalId);
  }, [token, mailSettingsOpen, mailSettingsTab, mailboxSettings?.backupJobs]);

  useEffect(() => {
    const current = getUserToken();
    if (current) {
      setToken(current);
    }
    void refreshUiContract().catch(() => setUiContract(defaultUiContract));
  }, []);

  useEffect(() => {
    if (!token || !me || me.mustChangePassword) {
      stopNotificationStream();
      return;
    }
    void reload().catch((error) => setApprovalError(error instanceof Error ? error.message : "조회 실패"));
    void loadMailWorkspace(token).catch((error) => setMailError(normalizeClientError(error, "메일 조회 실패")));
    void loadMailStorage(token);
    void loadMessengerWorkspace(token).catch((error) => setMessengerError(normalizeClientError(error, "메신저 조회 실패")));
    setHomeLoading(true);
    setHomeError("");
    void Promise.all([loadHomeSchedules(token), loadHomeNotices(token)])
      .catch((error) => setHomeError(normalizeClientError(error, "홈 업무 현황 조회 실패")))
      .finally(() => setHomeLoading(false));
    void loadTranslationState().catch(() => undefined);
    void refreshMailDeliveryState(token).catch(() => undefined);
    connectNotificationStream(token);
    return () => {
      stopNotificationStream();
    };
  }, [token, me?.mustChangePassword, me?.userId]);

  useEffect(() => {
    if (!token) {
      appliedPreferenceTokenRef.current = "";
      setMe(null);
      setHeaderProfile(null);
      if (headerProfilePhotoUrlRef.current) URL.revokeObjectURL(headerProfilePhotoUrlRef.current);
      headerProfilePhotoUrlRef.current = ""; setHeaderProfilePhotoUrl("");
      setTranslationStatus(null);
      setTranslationResult([]);
      setTranslationError("");
      setInboxMails([]);
      setSentMails([]);
      setDraftMails([]);
      setScheduledMails([]);
      setSelectedMailId("");
      setMailReadReceiptOpen(false);
      setSelectedMailDetail(null);
      setMailDeliveryStatus(null);
      setMailComposeForm(createEmptyMailComposeForm());
      setQuickComposeMode("none");
      setMessengerRoomsData([]);
      setSelectedRoomId("");
      setMailComposeFiles([]);
      setMailComposeSourceDetail(null);
      setMailComposeSourceMailId("");
      setSelectedForwardAttachmentIds([]);
      setRecipientPickerTarget(null);
      setSelectedRoomDetail(null);
      setRoomMessages([]);
      setMailError("");
      setMessengerError("");
      return;
    }
    void fetchMe(token)
      .then((response) => setMe(response.user))
      .catch(() => {
        clearUserToken();
        setToken("");
        setMe(null);
        setTranslationStatus(null);
        setApprovalError("세션이 만료되었거나 접근이 제한되었습니다. 다시 로그인해 주세요.");
      });
  }, [token]);

  useEffect(() => {
    if (!token || !me || me.mustChangePassword || appliedPreferenceTokenRef.current === token) return;
    appliedPreferenceTokenRef.current = token;
    void fetchWorkspacePreferences(token)
      .then((preference) => {
        saveLocale(resolveLocale(preference.locale));
        saveTimezone(preference.timezone);
        setActivePortalMenu(preference.startPage);
      })
      .catch(() => { appliedPreferenceTokenRef.current = ""; });
  }, [token, me?.userId, me?.mustChangePassword]);

  useEffect(() => {
    if (!token || !me || me.mustChangePassword) return;
    void refreshHeaderProfile().catch(() => {
      setHeaderProfile(null);
      if (headerProfilePhotoUrlRef.current) URL.revokeObjectURL(headerProfilePhotoUrlRef.current);
      headerProfilePhotoUrlRef.current = ""; setHeaderProfilePhotoUrl("");
    });
  }, [token, me?.userId, me?.mustChangePassword]);

  useEffect(() => () => {
    if (headerProfilePhotoUrlRef.current) URL.revokeObjectURL(headerProfilePhotoUrlRef.current);
  }, []);

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setApprovalError("");
    setMessage("");
    try {
      if (loginForm.loginId.includes("@")) {
        setApprovalError("아이디만 입력하세요. 회사 도메인은 자동으로 적용됩니다.");
        return;
      }
      const response = (await login({
        email: buildCompanyLoginEmail(loginForm.loginId, uiContract.company.domain),
        password: loginForm.password,
      })) as LoginResponse;
      storeUserToken(response.accessToken);
      setToken(response.accessToken);
      setMe(response.user);
      if (response.user.mustChangePassword) {
        setPasswordChangeForm({
          currentPassword: loginForm.password,
          newPassword: "",
          confirmPassword: "",
        });
        setMessage("최초 로그인입니다. 비밀번호를 변경한 뒤 업무 화면으로 이동합니다.");
        return;
      }
      setMessage(`${response.user.userName}님, 업무 포털에 접속했습니다.`);
      await loadTranslationState(response.accessToken);
      await refreshMailDeliveryState(response.accessToken);
      await reload();
    } catch (error) {
      setApprovalError(error instanceof Error ? error.message : "로그인 실패");
    } finally {
      setLoading(false);
    }
  }

  async function handleForcedPasswordChange(event: FormEvent) {
    event.preventDefault();
    if (!token || !me) return;
    if (passwordChangeForm.newPassword !== passwordChangeForm.confirmPassword) {
      setApprovalError("새 비밀번호와 확인 비밀번호가 일치하지 않습니다.");
      return;
    }
    setLoading(true);
    setApprovalError("");
    try {
      const response = await changePassword(token, {
        currentPassword: passwordChangeForm.currentPassword,
        newPassword: passwordChangeForm.newPassword,
      });
      setMe(response.user);
      setLoginForm({ loginId: loginForm.loginId, password: passwordChangeForm.newPassword });
      setPasswordChangeForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setMessage("비밀번호 변경이 완료되어 업무 화면으로 이동합니다.");
      await loadTranslationState();
      await refreshMailDeliveryState(token);
      await reload();
    } catch (error) {
      setApprovalError(error instanceof Error ? error.message : "비밀번호 변경 실패");
    } finally {
      setLoading(false);
    }
  }

  function releaseApprovalDetailImages() {
    approvalDetailObjectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    approvalDetailObjectUrls.current = [];
    setApprovalLineSignatureUrls({});
    setApprovalAttachmentPreviewUrls({});
  }

  async function loadApprovalDetailImages(
    targetToken: string,
    detail: ApprovalDocumentDetail,
    display: ApprovalAttachmentImageDisplay,
    sequence: number,
  ) {
    releaseApprovalDetailImages();
    const lineEntries = await Promise.all(detail.lines.filter((line) => line.hasSignature && line.signatureUrl).map(async (line) => {
      try { return [line.id, await fetchApprovalInlineImage(targetToken, line.signatureUrl!)] as const; }
      catch { return null; }
    }));
    const attachmentEntries = await Promise.all(detail.attachments.filter((item) => (
      item.previewUrl && shouldPreviewApprovalAttachment(item.contentType, display)
    )).map(async (item) => {
      try { return [item.attachmentId, await fetchApprovalInlineImage(targetToken, item.previewUrl!)] as const; }
      catch { return null; }
    }));
    const entries = [...lineEntries, ...attachmentEntries].filter((item): item is readonly [string, string] => Boolean(item));
    if (sequence !== approvalRequestSequence.current) {
      entries.forEach(([, url]) => URL.revokeObjectURL(url));
      return;
    }
    approvalDetailObjectUrls.current = entries.map(([, url]) => url);
    setApprovalLineSignatureUrls(Object.fromEntries(lineEntries.filter((item): item is readonly [string, string] => Boolean(item))));
    setApprovalAttachmentPreviewUrls(Object.fromEntries(attachmentEntries.filter((item): item is readonly [string, string] => Boolean(item))));
  }

  async function applyApprovalPreferences(value: ApprovalBasicPreferences, loadPreview = true) {
    if (approvalSettingsObjectUrl.current) URL.revokeObjectURL(approvalSettingsObjectUrl.current);
    approvalSettingsObjectUrl.current = "";
    setApprovalPreferences(value);
    const draft: ApprovalPreferenceDraft = {
      writingMethod: value.writingMethod,
      attachmentImageDisplay: value.attachmentImageDisplay,
      signatureName: value.signatureFileName ?? "",
      removeSignature: false,
    };
    setApprovalPreferencesDraft(draft);
    setApprovalPreferencesBaseline(buildApprovalPreferenceSnapshot(draft));
    setApprovalSignatureFile(null);
    setApprovalSignaturePreviewUrl("");
    if (loadPreview && token && value.hasSignature && value.signatureUrl) {
      try {
        const objectUrl = await fetchApprovalInlineImage(token, value.signatureUrl);
        approvalSettingsObjectUrl.current = objectUrl;
        setApprovalSignaturePreviewUrl(objectUrl);
      } catch (error) {
        setApprovalPreferencesError(normalizeClientError(error, "등록된 서명 미리보기 조회 실패"));
      }
    }
  }

  async function loadApprovalPreferences(targetToken: string) {
    setApprovalPreferencesLoading(true);
    setApprovalPreferencesError("");
    try {
      await applyApprovalPreferences(await fetchApprovalBasicPreferences(targetToken));
    } catch (error) {
      setApprovalPreferencesError(normalizeClientError(error, "결재 기본 설정 조회 실패"));
    } finally {
      setApprovalPreferencesLoading(false);
    }
  }

  function selectApprovalSignature(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = "";
    if (!file) return;
    const allowed = ["image/png", "image/jpeg", "image/webp"];
    if (!allowed.includes(file.type) || file.size > 512 * 1024) {
      setApprovalPreferencesError("서명은 512KB 이하 PNG/JPEG/WEBP 파일만 사용할 수 있습니다.");
      return;
    }
    if (approvalSettingsObjectUrl.current) URL.revokeObjectURL(approvalSettingsObjectUrl.current);
    const objectUrl = URL.createObjectURL(file);
    approvalSettingsObjectUrl.current = objectUrl;
    setApprovalSignaturePreviewUrl(objectUrl);
    setApprovalSignatureFile(file);
    setApprovalPreferencesError("");
    setApprovalPreferencesDraft((current) => ({ ...current, signatureName: file.name, removeSignature: false }));
  }

  function removeApprovalSignature() {
    if (approvalSettingsObjectUrl.current) URL.revokeObjectURL(approvalSettingsObjectUrl.current);
    approvalSettingsObjectUrl.current = "";
    setApprovalSignaturePreviewUrl("");
    setApprovalSignatureFile(null);
    setApprovalPreferencesDraft((current) => ({ ...current, signatureName: "", removeSignature: true }));
  }

  function cancelApprovalPreferences() {
    if (approvalPreferences) void applyApprovalPreferences(approvalPreferences);
  }

  async function saveApprovalPreferences() {
    if (!token) return;
    setApprovalPreferencesSaving(true);
    setApprovalPreferencesError("");
    try {
      const confirmed = await updateApprovalBasicPreferences(
        token,
        {
          writingMethod: approvalPreferencesDraft.writingMethod,
          attachmentImageDisplay: approvalPreferencesDraft.attachmentImageDisplay,
          version: approvalPreferences?.version ?? 0,
        },
        approvalPreferencesDraft.removeSignature,
        approvalSignatureFile ?? undefined,
      );
      await applyApprovalPreferences(confirmed);
      pushFeedback({ id: `approval-settings-${confirmed.version}`, source: "approval", tone: "success", title: "결재 기본 설정을 저장했습니다." });
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409) {
        setApprovalPreferencesError("다른 화면에서 설정이 변경되었습니다. 입력 내용은 유지됩니다. 서버 값을 다시 조회한 뒤 저장해 주세요.");
      } else {
        setApprovalPreferencesError(normalizeClientError(error, "결재 기본 설정 저장 실패"));
      }
    } finally {
      setApprovalPreferencesSaving(false);
    }
  }

  async function loadApprovalDelegationCandidates(targetToken: string, force = false) {
    if (!force && approvalDelegationCandidatesLoadedTokenRef.current === targetToken) return;
    if (approvalDelegationCandidatesRequestRef.current?.token === targetToken) return;

    const request = fetchApprovalApprovers(targetToken);
    approvalDelegationCandidatesRequestRef.current = { token: targetToken, request };
    setApprovalDelegationCandidatesLoading(true);
    setApprovalDelegationCandidatesError("");
    try {
      const response = await request;
      if (approvalDelegationCandidatesRequestRef.current?.request !== request) return;
      setApprovalApprovers(response.users);
      approvalDelegationCandidatesLoadedTokenRef.current = targetToken;
    } catch (error) {
      if (approvalDelegationCandidatesRequestRef.current?.request !== request) return;
      setApprovalDelegationCandidatesError(normalizeClientError(error, "대결자 후보 조회 실패"));
    } finally {
      if (approvalDelegationCandidatesRequestRef.current?.request === request) {
        approvalDelegationCandidatesRequestRef.current = null;
        setApprovalDelegationCandidatesLoading(false);
      }
    }
  }

  async function loadApprovalDelegations(targetToken: string, page = approvalDelegationsPage) {
    setApprovalDelegationsLoading(true);
    setApprovalDelegationsError("");
    try {
      const response = await fetchApprovalDelegations(targetToken, page, 20);
      setApprovalDelegations(response.items);
      setApprovalDelegationsTotal(response.total);
      setApprovalDelegationsPage(response.page);
      setSelectedApprovalDelegationId((current) => (
        response.items.some((item) => item.delegationId === current) ? current : ""
      ));
    } catch (error) {
      setApprovalDelegationsError(normalizeClientError(error, "부재/위임 설정 조회 실패"));
    } finally {
      setApprovalDelegationsLoading(false);
    }
  }

  function selectApprovalSettingsTab(tab: "basic" | "delegation") {
    setApprovalSettingsTab(tab);
    if (!token) return;
    if (tab === "basic") {
      if (!approvalPreferences) void loadApprovalPreferences(token);
      return;
    }
    void loadApprovalDelegations(token, 1);
    void loadApprovalDelegationCandidates(token);
  }

  function openApprovalDelegationCreate() {
    const draft = emptyApprovalDelegationDraft();
    setApprovalDelegationDraft(draft);
    setApprovalDelegationBaseline(buildApprovalDelegationSnapshot(draft));
    setApprovalDelegationSearch("");
    setApprovalDelegationError("");
    setApprovalDelegationPopupMode("create");
    if (token) void loadApprovalDelegationCandidates(token);
  }

  function openApprovalDelegationEdit(item?: ApprovalDelegation) {
    const target = item ?? approvalDelegations.find((value) => value.delegationId === selectedApprovalDelegationId);
    if (!target) return;
    const draft: ApprovalDelegationDraft = {
      delegateUserId: target.delegateUserId,
      startDate: target.startDate,
      endDate: target.endDate,
      reason: target.reason,
      enabled: target.enabled,
    };
    setSelectedApprovalDelegationId(target.delegationId);
    setApprovalDelegationDraft(draft);
    setApprovalDelegationBaseline(buildApprovalDelegationSnapshot(draft));
    setApprovalDelegationSearch("");
    setApprovalDelegationError("");
    setApprovalDelegationPopupMode("edit");
    if (token) void loadApprovalDelegationCandidates(token);
  }

  async function saveApprovalDelegation(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    const validation = validateApprovalDelegation(approvalDelegationDraft);
    if (validation) {
      setApprovalDelegationError(validation);
      return;
    }
    setApprovalDelegationSaving(true);
    setApprovalDelegationError("");
    try {
      if (approvalDelegationPopupMode === "create") {
        await createApprovalDelegation(token, { ...approvalDelegationDraft, reason: approvalDelegationDraft.reason.trim() });
      } else {
        const current = approvalDelegations.find((item) => item.delegationId === selectedApprovalDelegationId);
        if (!current) throw new Error("수정할 위임 설정을 다시 선택하세요.");
        await updateApprovalDelegation(token, current.delegationId, {
          ...approvalDelegationDraft,
          reason: approvalDelegationDraft.reason.trim(),
          expectedVersion: current.version,
        });
      }
      setApprovalDelegationPopupMode("none");
      await loadApprovalDelegations(token, approvalDelegationsPage);
      pushFeedback({ id: `approval-delegation-${Date.now()}`, source: "approval", tone: "success", title: "부재/위임 설정을 저장했습니다." });
    } catch (error) {
      const stale = error instanceof ApiRequestError && error.status === 409;
      setApprovalDelegationError(stale
        ? "다른 화면에서 위임 설정이 변경되었거나 기간이 겹칩니다. 목록을 다시 조회해 주세요."
        : normalizeClientError(error, "부재/위임 설정 저장 실패"));
    } finally {
      setApprovalDelegationSaving(false);
    }
  }

  async function confirmDeleteApprovalDelegation() {
    if (!token || !approvalDelegationDeleteTarget) return;
    setApprovalDelegationSaving(true);
    setApprovalDelegationsError("");
    try {
      await deleteApprovalDelegation(
        token, approvalDelegationDeleteTarget.delegationId, approvalDelegationDeleteTarget.version,
      );
      setApprovalDelegationDeleteTarget(null);
      const nextPage = approvalDelegations.length === 1 && approvalDelegationsPage > 1
        ? approvalDelegationsPage - 1 : approvalDelegationsPage;
      await loadApprovalDelegations(token, nextPage);
      pushFeedback({ id: `approval-delegation-delete-${Date.now()}`, source: "approval", tone: "success", title: "부재/위임 설정을 삭제했습니다." });
    } catch (error) {
      setApprovalDelegationsError(normalizeClientError(error, "부재/위임 설정 삭제 실패"));
      setApprovalDelegationDeleteTarget(null);
    } finally {
      setApprovalDelegationSaving(false);
    }
  }

  async function selectApprovalDocument(documentId: string, options?: { preserveMenu?: boolean }) {
    const targetDocument = documents.find((document) => document.id === documentId);
    if (targetDocument && me && !options?.preserveMenu) {
      const targetGroups = classifyApprovalDocuments([targetDocument], me.userId);
      const belongsToCurrentMenu = isApprovalActualMenuKey(approvalShellMenu)
        && targetGroups[approvalShellMenu].length > 0;
      const targetMenu = belongsToCurrentMenu ? null : findApprovalDocumentMenu(targetDocument, me.userId);
      if (targetMenu) setApprovalShellMenu(targetMenu);
    }
    setSelectedApprovalId(documentId);
    setSelectedApprovalDetail(null);
    setApprovalAttachmentError("");
    releaseApprovalDetailImages();
    if (!token || !documentId) return;
    const sequence = ++approvalRequestSequence.current;
    setApprovalDetailLoading(true);
    setApprovalLogsLoading(true);
    setApprovalDetailError("");
    setApprovalLogsError("");
    void Promise.all([
      fetchApprovalDetail(token, documentId),
      fetchApprovalBasicPreferences(token).catch(() => null),
    ])
      .then(([detail, preferences]) => {
        if (sequence !== approvalRequestSequence.current) return;
        setSelectedApprovalDetail(detail);
        if (detail.currentUserAudienceType && !detail.currentUserReadAt) {
          void markApprovalRead(token, documentId).then((readDetail) => {
            if (sequence === approvalRequestSequence.current) {
              setSelectedApprovalDetail(readDetail);
              setDocuments((current) => current.map((item) => item.id === readDetail.id ? readDetail : item));
            }
          }).catch(() => undefined);
        }
        const display = preferences?.attachmentImageDisplay ?? "filename";
        if (preferences) setApprovalPreferences(preferences);
        void loadApprovalDetailImages(token, detail, display, sequence);
      })
      .catch((error) => {
        if (sequence !== approvalRequestSequence.current) return;
        setApprovalDetailError(normalizeClientError(error, "결재 상세 조회 실패"));
      })
      .finally(() => {
        if (sequence === approvalRequestSequence.current) setApprovalDetailLoading(false);
      });
    void fetchApprovalLogs(token, documentId)
      .then((response) => {
        if (sequence !== approvalRequestSequence.current) return;
        setApprovalLogs(response.logs);
      })
      .catch((error) => {
        if (sequence !== approvalRequestSequence.current) return;
        setApprovalLogsError(normalizeClientError(error, "결재 이력 조회 실패"));
        setApprovalLogs([]);
      })
      .finally(() => {
        if (sequence === approvalRequestSequence.current) setApprovalLogsLoading(false);
      });
  }

  function retryApprovalDetail() {
    if (selectedApprovalId) void selectApprovalDocument(selectedApprovalId, { preserveMenu: true });
  }

  function retryApprovalLogs() {
    if (!token || !selectedApprovalId) return;
    const sequence = approvalRequestSequence.current;
    setApprovalLogsLoading(true);
    setApprovalLogsError("");
    void fetchApprovalLogs(token, selectedApprovalId)
      .then((response) => { if (sequence === approvalRequestSequence.current) setApprovalLogs(response.logs); })
      .catch((error) => { if (sequence === approvalRequestSequence.current) setApprovalLogsError(normalizeClientError(error, "결재 이력 조회 실패")); })
      .finally(() => { if (sequence === approvalRequestSequence.current) setApprovalLogsLoading(false); });
  }

  async function handleApprovalAttachmentDownload(attachmentId: string, fileName: string) {
    if (!token || !selectedApprovalDetail) return;
    setApprovalAttachmentError("");
    try {
      await downloadApprovalAttachment(token, selectedApprovalDetail.id, attachmentId, fileName);
    } catch (error) {
      setApprovalAttachmentError(normalizeClientError(error, "결재 첨부 다운로드 실패"));
    }
  }

  async function keepApprovalPostAction(
    action: ApprovalPostAction,
    documentId: string,
    postActionDocument: ApprovalDocument | null,
  ) {
    const target = resolveApprovalPostActionTarget(action, documentId, postActionDocument, me?.userId ?? "");
    if (!target.menu) {
      await reload();
      setSelectedApprovalId("");
      setApprovalLogs([]);
      return;
    }

    setApprovalShellMenu(target.menu);
    await reload();
    await selectApprovalDocument(target.documentId, { preserveMenu: true });
  }

  async function openApprovalEditor(mode: "create" | "edit", document?: ApprovalDocument) {
    if (!token) return;
    setApprovalError("");
    setLoading(true);
    try {
      const [response, detail] = await Promise.all([
        fetchApprovalApprovers(token),
        document ? fetchApprovalDetail(token, document.id) : Promise.resolve(null),
      ]);
      const form = detail
        ? { title: detail.title, content: detail.content, approverUserIds: detail.lines.map((line) => line.approverUserId), referenceUserIds: detail.referenceUserIds, viewerUserIds: detail.viewerUserIds, urgent: detail.urgent, shareWithDepartment: detail.sharedWithDepartment }
        : { title: "", content: "", approverUserIds: [], referenceUserIds: [], viewerUserIds: [], urgent: false, shareWithDepartment: false };
      const retained = detail?.attachments ?? [];
      setApprovalApprovers(response.users);
      setApproverSearch("");
      setCreateForm(form);
      setApprovalEditorDocumentId(detail?.id ?? "");
      setApprovalRetainedAttachments(retained);
      setApprovalPendingFiles([]);
      setApprovalComposeTab("document");
      setApprovalComposeBaseline(buildApprovalComposeSnapshot(form, retained.map((item) => item.attachmentId), []));
      setApprovalModal(mode);
    } catch (error) {
      setApprovalError(normalizeClientError(error, "결재 작성 정보를 불러오지 못했습니다."));
    } finally {
      setLoading(false);
    }
  }

  function closeApprovalModal() {
    setApprovalModal("none");
    setApprovalEditorDocumentId("");
    setApprovalRetainedAttachments([]);
    setApprovalPendingFiles([]);
    setApprovalComposeBaseline("");
    setApprovalActionTarget(null);
    setReasonAction({ documentId: "", reason: "" });
  }

  function selectApprovalApprover(userId: string) {
    setCreateForm((current) => current.approverUserIds.includes(userId) ? current : { ...current, approverUserIds: [...current.approverUserIds, userId] });
  }

  function moveApprovalApprover(userId: string, direction: -1 | 1) {
    setCreateForm((current) => ({ ...current, approverUserIds: moveApprovalApproverOrder(current.approverUserIds, userId, direction) }));
  }

  function addApprovalFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (!files.length) return;
    const retainedBytes = approvalRetainedAttachments.reduce((sum, item) => sum + item.sizeBytes, 0);
    const pendingBytes = approvalPendingFiles.reduce((sum, item) => sum + item.file.size, 0);
    const validation = validateApprovalFiles(
      files,
      approvalRetainedAttachments.length + approvalPendingFiles.length,
      retainedBytes + pendingBytes,
    );
    if (!validation.ok) {
      setApprovalError(validation.message);
      return;
    }
    setApprovalError("");
    setApprovalPendingFiles((current) => [
      ...current,
      ...files.map((file) => ({ id: `${file.name}:${file.size}:${file.lastModified}:${crypto.randomUUID()}`, file })),
    ]);
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    const retainedBytes = approvalRetainedAttachments.reduce((sum, item) => sum + item.sizeBytes, 0);
    const pendingBytes = approvalPendingFiles.reduce((sum, item) => sum + item.file.size, 0);
    const validationErrors = validateApprovalDraft({
      title: createForm.title,
      content: createForm.content,
      attachmentCount: approvalRetainedAttachments.length + approvalPendingFiles.length,
      attachmentBytes: retainedBytes + pendingBytes,
    });
    if (validationErrors.length) {
      setApprovalError(validationErrors[0]);
      return;
    }
    setLoading(true);
    setApprovalError("");
    try {
      const isEdit = approvalModal === "edit";
      const documentId = approvalEditorDocumentId;
      const attachments = [];
      for (const item of approvalPendingFiles) {
        attachments.push(await uploadApprovalAttachment(token, item.file));
      }
      const payload = {
        title: createForm.title.trim(),
        content: createForm.content.trim(),
        approverUserIds: createForm.approverUserIds,
        referenceUserIds: createForm.referenceUserIds,
        viewerUserIds: createForm.viewerUserIds,
        urgent: createForm.urgent,
        shareWithDepartment: createForm.shareWithDepartment,
        attachments,
      };
      if (isEdit && documentId) {
        const postActionDocument = await updateApproval(token, documentId, {
          ...payload,
          retainedAttachmentIds: approvalRetainedAttachments.map((item) => item.attachmentId),
        });
        setMessage("결재 초안이 수정되었습니다.");
        await keepApprovalPostAction("edit", documentId, postActionDocument);
      } else {
        const response = await createApproval(token, payload);
        setSelectedApprovalId(response.documentId);
        setMessage("결재 초안이 저장되었습니다.");
        await keepApprovalPostAction("create", response.documentId, null);
      }
      closeApprovalModal();
      setCreateForm({ title: "", content: "", approverUserIds: [], referenceUserIds: [], viewerUserIds: [], urgent: false, shareWithDepartment: false });
    } catch (error) {
      setApprovalError(normalizeClientError(error, "결재 초안 저장 실패"));
    } finally {
      setLoading(false);
    }
  }

  async function handleApprovalTrashAction(action: "delete" | "restore" | "permanent") {
    if (!token || !selectedDocumentForAction()) return;
    const document = selectedDocumentForAction()!;
    if (action === "permanent" && !window.confirm("휴지통에서 영구 삭제합니다. 결재 감사 이력은 보존됩니다.")) return;
    setLoading(true);
    setApprovalError("");
    try {
      if (action === "delete") await deleteApprovalDocument(token, document.id);
      else if (action === "restore") await restoreApprovalDocument(token, document.id);
      else await permanentlyDeleteApprovalDocument(token, document.id);
      setSelectedApprovalId("");
      setSelectedApprovalDetail(null);
      await reload();
      setMessage(action === "delete" ? "결재 문서를 휴지통으로 이동했습니다." : action === "restore" ? "결재 문서를 복원했습니다." : "결재 문서를 영구 삭제했습니다.");
    } catch (error) { setApprovalError(normalizeClientError(error, "결재 문서 삭제 처리 실패")); }
    finally { setLoading(false); }
  }

  function selectedDocumentForAction(): ApprovalDocumentDetail | null {
    return selectedApprovalDetail;
  }

  async function executeApprovalAction(action: ApprovalActionType) {
    if (!token || !approvalActionTarget) return;
    const opinionError = validateApprovalActionOpinion(action, reasonAction.reason);
    if (opinionError) {
      setApprovalError(opinionError);
      return;
    }
    const documentId = approvalActionTarget.documentId;
    setLoading(true);
    setApprovalError("");
    try {
      const postActionDocument = action === "approve"
        ? await approveApproval(token, documentId, reasonAction.reason.trim())
        : action === "reject"
          ? await rejectApproval(token, documentId, reasonAction.reason.trim())
          : await (action === "submit" ? submitApproval : action === "withdraw" ? withdrawApproval : redraftApproval)(token, documentId);
      setReasonAction({ documentId: "", reason: "" });
      setApprovalActionTarget(null);
      setApprovalModal("none");
      await keepApprovalPostAction(action, documentId, postActionDocument);
    } catch (error) {
      setApprovalError(normalizeClientError(error, action === "approve" || action === "reject" ? "결재 처리 실패" : "결재 상태 변경 실패"));
    } finally {
      setLoading(false);
    }
  }

  function openApprovalAction(mode: ApprovalActionType, document: ApprovalDocument) {
    setReasonAction({ documentId: document.id, reason: "" });
    setApprovalActionTarget(buildApprovalActionTarget(document));
    setApprovalError("");
    setApprovalModal(mode);
  }

  function renderApprovalActionPopup() {
    const action = approvalModal !== "none" && approvalModal !== "create" && approvalModal !== "edit"
      ? approvalModal as ApprovalActionType
      : null;
    const config = action ? APPROVAL_ACTION_CONFIG[action] : null;
    return <CommonPopup
      title={config?.title ?? "결재 처리"}
      open={Boolean(action && approvalActionTarget)}
      onClose={closeApprovalModal}
      saving={loading}
      error={approvalError}
      className="ui034-action-popup"
      kind="alertdialog"
    >
      {action && config && approvalActionTarget ? <div className="ui034-action-popup__content">
        <dl className="ui034-action-popup__summary">
          <div><dt>문서</dt><dd>{approvalActionTarget.title}</dd></div>
          <div><dt>현재 상태</dt><dd>{approvalStatusLabel(approvalActionTarget.status)}</dd></div>
          <div><dt>현재 결재자</dt><dd>{approvalActionTarget.currentApproverName}{approvalActionTarget.currentLineIndex == null ? "" : ` · ${approvalActionTarget.currentLineIndex}/${approvalActionTarget.lineCount}`}</dd></div>
          <div><dt>예상 결과</dt><dd>{config.expectedState}</dd></div>
          <div><dt>영향</dt><dd>{config.impact}</dd></div>
        </dl>
        {config.requiresOpinion ? <label className="ui034-action-popup__opinion">처리 의견
          <textarea aria-label="처리 의견" required maxLength={500} value={reasonAction.reason} onChange={(event) => { setReasonAction((current) => ({ ...current, reason: event.target.value })); if (approvalError) setApprovalError(""); }} placeholder={`${config.confirmLabel} 의견을 입력하세요.`} />
          <span>{reasonAction.reason.length} / 500자</span>
        </label> : null}
        <footer className="ui034-action-popup__footer"><button type="button" disabled={loading} onClick={closeApprovalModal}>취소</button><button type="button" disabled={loading} className={`is-${config.tone}`} onClick={() => void executeApprovalAction(action)}>{config.confirmLabel}</button></footer>
      </div> : null}
    </CommonPopup>;
  }

  async function executeAck(notificationId: string) {
    if (!token) return;
    setLoading(true);
    setNotificationError("");
    try {
      await ackNotification(token, notificationId);
      await refreshNotifications(token);
    } catch (error) {
      setNotificationError(error instanceof Error ? error.message : "읽음 처리 실패");
    } finally {
      setLoading(false);
    }
  }

  async function executeReadAll() {
    if (!token) return;
    setLoading(true);
    setNotificationError("");
    try {
      await readAllNotifications(token);
      await refreshNotifications(token);
    } catch (error) {
      setNotificationError(error instanceof Error ? error.message : "전체 읽음 처리 실패");
    } finally {
      setLoading(false);
    }
  }

  function closeNotificationPanel() {
    setShowNotificationPanel(false);
    requestAnimationFrame(() => notificationButtonRef.current?.focus());
  }

  function toggleNotificationPanel() {
    if (showNotificationPanel) {
      closeNotificationPanel();
      return;
    }
    setShowNotificationPanel(true);
  }

  async function openNotificationTarget(menu: "mail" | "approval" | "messenger" | "schedule" | "files" | "notices" | "alerts", item: NotificationRecord) {
    if (!token) return;
    if (item.status === "unread") {
      await executeAck(item.notificationId);
    }
    closeNotificationPanel();
    setPortalMenu(menu);
    try {
      if (menu === "mail") {
        await selectMail(token, item.resourceId, "inbox", { markRead: true, propagateError: true });
      } else if (menu === "approval") {
        await selectApprovalDocument(item.resourceId);
      } else if (menu === "messenger") {
        await selectMessengerRoom(token, item.resourceId, { markRead: true });
      } else if (menu === "schedule") {
        setSearchWorkspaceSelection({ menu: "schedule", id: item.resourceId });
      } else if (menu === "files") {
        setSearchWorkspaceSelection({ menu: "files", id: item.resourceId });
      } else if (menu === "notices") {
        const detail = await fetchWorkspaceNotice(token, item.resourceId);
        setSelectedNotice(detail);
      }
    } catch {
      const originError = "원본 항목이 삭제되었거나 접근 권한이 없습니다.";
      if (menu === "mail") setMailError(originError);
      else if (menu === "approval") setApprovalError(originError);
      else if (menu === "messenger") setMessengerError(originError);
      else setNotificationError(originError);
    }
  }

  const canAct = useMemo(() => {
    const actionSet = new Set(me?.permissions ?? []);
    return {
      read: actionSet.has("approval:read"),
      create: actionSet.has("approval:create"),
      submit: actionSet.has("approval:submit"),
      act: actionSet.has("approval:act"),
      withdraw: actionSet.has("approval:withdraw"),
      rework: actionSet.has("approval:rework"),
    };
  }, [me]);

  const approvalDocumentsByMenu = useMemo(
    () => classifyApprovalDocuments(documents, me?.userId ?? ""),
    [documents, me?.userId],
  );

  useEffect(() => {
    if (activePortalMenu !== "approval" || !isApprovalActualMenuKey(approvalShellMenu)) return;
    const visible = filterApprovalDocuments(approvalDocumentsByMenu[approvalShellMenu], approvalStatusFilter, approvalSearch);
    const nextId = resolveApprovalSelection(selectedApprovalId, visible);
    if (nextId !== selectedApprovalId) {
      if (nextId) void selectApprovalDocument(nextId, { preserveMenu: true });
      else {
        approvalRequestSequence.current += 1;
        setSelectedApprovalId("");
        setSelectedApprovalDetail(null);
        setApprovalLogs([]);
      }
    }
  }, [activePortalMenu, approvalDocumentsByMenu, approvalSearch, approvalShellMenu, approvalStatusFilter, selectedApprovalId]);

  function activateApprovalShellMenu(nextMenu: ApprovalShellMenuKey) {
    setApprovalShellMenu(nextMenu);
    if (nextMenu === "settings") {
      if (token) {
        if (approvalSettingsTab === "basic") void loadApprovalPreferences(token);
        else {
          void loadApprovalDelegations(token, approvalDelegationsPage);
          void loadApprovalDelegationCandidates(token);
        }
      }
      setSelectedApprovalId("");
      setApprovalLogs([]);
      return;
    }
    if (!isApprovalActualMenuKey(nextMenu)) {
      setSelectedApprovalId("");
      setApprovalLogs([]);
      return;
    }

    const menuDocuments = approvalDocumentsByMenu[nextMenu];
    const nextDocument = menuDocuments.find((document) => document.id === selectedApprovalId) ?? menuDocuments[0];
    if (!nextDocument) {
      setSelectedApprovalId("");
      setApprovalLogs([]);
      return;
    }
    if (nextDocument.id !== selectedApprovalId) void selectApprovalDocument(nextDocument.id, { preserveMenu: true });
  }

  function openApprovalShellMenu(nextMenu: ApprovalShellMenuKey) {
    if (approvalShellMenu === "settings" && nextMenu !== "settings" && approvalPreferencesDirty) {
      setApprovalPendingMenu(nextMenu);
      return;
    }
    activateApprovalShellMenu(nextMenu);
  }

  function discardApprovalPreferencesAndNavigate() {
    const nextMenu = approvalPendingMenu;
    const nextPortalMenu = approvalPendingPortalMenu;
    setApprovalPendingMenu(null);
    setApprovalPendingPortalMenu(null);
    if (approvalPreferences) void applyApprovalPreferences(approvalPreferences, false);
    if (nextMenu) activateApprovalShellMenu(nextMenu);
    if (nextPortalMenu) {
      resetQuickComposeMode();
      setShowNotificationPanel(false);
      clearTransientFeedback();
      setApprovalError("");
      setMailError("");
      setMessengerError("");
      setSearchError("");
      setActivePortalMenu(nextPortalMenu);
    }
  }

  const dashboardStats = useMemo(() => {
    const unreadCount = notificationSummary?.unreadCount ?? 0;
    const pendingApprovals = documents.filter((doc) => doc.status === "submitted").length;
    const urgentCount = notificationSummary?.severityCount?.CRITICAL ?? 0;
    const todayApprovals = documents.filter((doc) => doc.status === "draft" || doc.status === "submitted").length;
    return {
      unreadCount,
      pendingApprovals,
      urgentCount,
      todayApprovals,
    };
  }, [documents, notificationSummary]);

  const approvalDelegationCandidates = useMemo(() => {
    const keyword = approvalDelegationSearch.trim().toLowerCase();
    return approvalApprovers.filter((user) => user.userId !== me?.userId).filter((user) => (
      !keyword || `${user.userName} ${user.userEmail} ${user.departmentName}`.toLowerCase().includes(keyword)
    ));
  }, [approvalApprovers, approvalDelegationSearch, me?.userId]);

  function isCurrentApprovalActor(doc: ApprovalDocument): boolean {
    if (!me) return false;
    const currentLine = doc.currentLineIndex == null
      ? undefined
      : doc.lines.find((line) => line.sequence === doc.currentLineIndex);
    return Boolean(doc.canCurrentUserAct || currentLine?.approverUserId === me.userId);
  }

  const navItems = [
    { label: "메일", desc: "받은편지함 우선 확인" },
    { label: "결재", desc: `${dashboardStats.pendingApprovals}건 대기` },
    { label: "메신저", desc: "최근 대화 확인" },
    { label: "일정", desc: "오늘 일정" },
    { label: "주소록", desc: "조직도·연락처 연계" },
    { label: "조직도", desc: "부서 및 권한 구조" },
    { label: "파일", desc: "업무 파일 허브" },
    { label: "설정", desc: "언어, 시간대, 화면" },
  ];

  const orderedNavItems = [...navItems].sort((left, right) => {
    const leftIndex = uiContract.menuOrder.indexOf(left.label);
    const rightIndex = uiContract.menuOrder.indexOf(right.label);
    const safeLeft = leftIndex === -1 ? 999 : leftIndex;
    const safeRight = rightIndex === -1 ? 999 : rightIndex;
    return safeLeft - safeRight;
  });

  const homeSurfaceCards = [
    {
      id: "mail",
      title: "안 읽은 메일",
      value: "준비 중",
      subtext: "안 읽은 메일/중요 메일을 업무 탭에서 바로 진입할 수 있습니다.",
      tone: "ink" as const,
    },
    {
      id: "approval",
      title: "대기 결재",
      value: `${dashboardStats.pendingApprovals}건`,
      subtext: "대기 결재와 상태 변경을 동일 화면에서 바로 시작합니다.",
      tone: "teal" as const,
    },
    {
      id: "messenger",
      title: "최근 대화",
      value: "준비 중",
      subtext: "최근 대화를 중심으로 실시간 협업 상태를 확인합니다.",
      tone: "sand" as const,
    },
    {
      id: "alerts",
      title: "오늘 알림",
      value: `${dashboardStats.unreadCount}건`,
      subtext: `미확인 ${dashboardStats.unreadCount}건, 긴급 ${dashboardStats.urgentCount}건`,
      tone: "rose" as const,
    },
  ].sort((left, right) => {
    const leftIndex = uiContract.homeCardOrder.indexOf(left.id);
    const rightIndex = uiContract.homeCardOrder.indexOf(right.id);
    const safeLeft = leftIndex === -1 ? 999 : leftIndex;
    const safeRight = rightIndex === -1 ? 999 : rightIndex;
    return safeLeft - safeRight;
  });

  const visibleMailList = getMailListByFolder(activeMailFolder);
  const allPageSelected = visibleMailList.length > 0 && visibleMailList.every((item) => selectedMailIds.includes(mailSelectionKey(item, activeMailFolder)));
  const inboxBulkEnabled = activeMailFolder === "inbox" || activeMailFolder === "starred" || activeMailFolder === "unread";
  const localMailArchiveHint = activeMailFolder === "localArchive" ? "로컬 아카이브에서 확인" : "";
  const starredMailCount = [...inboxMails, ...sentMails].filter((item) => item.isStarred).length;
  const draftMailCount = draftMails.length;
  const unreadInboxCount = inboxMails.filter((item) => !item.isRead).length;
  const selectedMailSummary =
    visibleMailList.find((item) => item.mailId === selectedMailId) ??
    inboxMails.find((item) => item.mailId === selectedMailId) ??
    sentMails.find((item) => item.mailId === selectedMailId) ??
    draftMails.find((item) => item.mailId === selectedMailId) ??
    scheduledMails.find((item) => item.mailId === selectedMailId) ??
    null;
  const mailToRecipients = selectedMailDetail?.recipients.filter((item) => item.recipientKind === "to") ?? [];
  const mailCcRecipients = selectedMailDetail?.recipients.filter((item) => item.recipientKind === "cc") ?? [];
  const isInboxDetail = ["inbox", "starred", "unread"].includes(activeMailFolder);
  const canReplyToSelectedMail = Boolean(selectedMailDetail && isInboxDetail);
  const canForwardSelectedMail = Boolean(selectedMailDetail && (isInboxDetail || activeMailFolder === "sent"));
  const canUpdateSelectedMailStatus = Boolean(selectedMailDetail && isInboxDetail);
  const canViewSelectedMailReadReceipts = Boolean(
    selectedMailDetail && activeMailFolder === "sent" && selectedMailDetail.canViewReadReceipts,
  );
  const selectedMailReadReceiptSummary = selectedMailDetail ? summarizeMailReadReceipts(selectedMailDetail) : "확인 불가";
  const hasRemoteMailImages = Boolean(selectedMailDetail?.bodyHtml && /<img\b[^>]*\bsrc\s*=\s*["']https?:/i.test(selectedMailDetail.bodyHtml));
  const safeMailHtml = useMemo(
    () => selectedMailDetail?.bodyHtml ? sanitizeMailHtml(
      replaceMailInlineCids(selectedMailDetail.bodyHtml, selectedMailDetail.attachments, mailDetailInlinePreviewUrls),
      showRemoteMailImages || mailPreferences?.blockRemoteImages === false,
      new Set(Object.values(mailDetailInlinePreviewUrls)),
    ) : "",
    [selectedMailDetail?.attachments, selectedMailDetail?.bodyHtml, showRemoteMailImages, mailDetailInlinePreviewUrls, mailPreferences?.blockRemoteImages],
  );
  const downloadableMailAttachments = selectedMailDetail?.attachments.filter((attachment) => attachment.disposition !== "inline") ?? [];
  useEffect(() => {
    setMailDetailInlinePreviewUrls({});
    const inlineAttachments = selectedMailDetail?.attachments.filter((attachment) => (
      attachment.disposition === "inline" && attachment.contentId && attachment.previewPath
    )) ?? [];
    if (!token || inlineAttachments.length === 0) return () => undefined;
    const loader = loadMailDetailInlinePreviews({ token, attachments: inlineAttachments, fetchPreview: fetchMailInlinePreview, createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL });
    let active = true;
    void loader.ready.then((urls) => {
      if (active) setMailDetailInlinePreviewUrls(urls);
    });
    return () => {
      active = false;
      loader.dispose();
    };
  }, [selectedMailDetail?.attachments, selectedMailDetail?.mailId, token]);
  useEffect(() => {
    setShowRemoteMailImages(false);
  }, [selectedMailDetail?.mailId]);
  useEffect(() => {
    setShowTranslatedMail(false);
    setTranslationError("");
    setMailTranslationPreview((current) => current?.mailId ? null : current);
    setMailTranslationKind((current) => current === "incoming" ? null : current);
  }, [selectedMailDetail?.mailId]);

  function handleHomeSurfaceCardClick(surfaceCardId: string) {
    if (surfaceCardId === "mail") {
      setPortalMenu("mail");
      return;
    }
    if (surfaceCardId === "approval") {
      setPortalMenu("approval");
      return;
    }
    if (surfaceCardId === "messenger") {
      setPortalMenu("messenger");
      return;
    }
    if (surfaceCardId === "alerts") {
      setPortalMenu("alerts");
    }
  }

  const mailBuckets = [
    { title: "안 읽은 메일", count: `${unreadInboxCount}건`, note: "받은편지함 기준 읽지 않은 메일 우선 확인" },
    { title: "중요 메일", count: `${starredMailCount}건`, note: "별표 처리된 메일을 공통 우선순위로 유지" },
    { title: "임시보관", count: `${draftMailCount}건`, note: "작성 중 메일과 임시저장 메일 현황" },
    { title: "로컬 아카이브", count: "설치형 연결", note: "장기 보관 메일은 설치형 아카이브로 이동" },
  ];

  const mailFolders = [
    { title: "받은편지함", count: `${inboxMails.length}`, tone: "#0f766e", folder: "inbox" as MailFolderType },
    { title: "보낸편지함", count: `${sentMails.length}`, tone: "#334155", folder: "sent" as MailFolderType },
    { title: "중요 메일", count: `${starredMailCount}`, tone: "#b45309", folder: "starred" as MailFolderType },
    { title: "안 읽은 메일", count: `${unreadInboxCount}`, tone: "#1d4ed8", folder: "unread" as MailFolderType },
    { title: "임시보관함", count: `${draftMailCount}`, tone: "#7c3aed", folder: "draft" as MailFolderType },
    { title: "예약메일함", count: `${scheduledMails.length}`, tone: "#0369a1", folder: "scheduled" as MailFolderType },
    { title: "설치형 로컬 아카이브", count: "연결", tone: "#14532d", folder: "localArchive" as MailFolderType },
  ];

  const recipientInputMode = mailPreferences?.recipientInputMode ?? "autocomplete";
  const recipientInputLocked = recipientInputMode === "search";
  useEffect(() => {
    if (quickComposeMode !== "mail" || recipientInputLocked) return;
    mailComposeToRef.current?.focus();
  }, [quickComposeMode, recipientInputLocked]);
  const recipientInputHint = recipientInputMode === "search"
    ? "검색 모드: 조직·연락처 선택으로만 수신자를 추가합니다."
    : recipientInputMode === "name_only"
      ? `이름 또는 계정만 입력하면 @${uiContract.company.domain} 주소로 완성됩니다.`
      : "이메일을 직접 입력하거나 최근 수신자·조직·연락처에서 선택할 수 있습니다.";

  const mailListSamples = visibleMailList.map((item) => ({
    mailId: item.mailId,
    sourceMailbox: item.sourceMailbox ?? "inbox",
    selectionKey: mailSelectionKey(item, activeMailFolder),
    sender: mailPreferences?.senderDisplayMode === "name" && item.senderDisplayName ? item.senderDisplayName : item.senderDisplayName ? `${item.senderDisplayName} <${item.senderEmail}>` : item.senderEmail,
    subject: item.subject,
    time: formatDateLabel(item.receivedAt || item.sentAt),
    unread: !item.isRead,
    important: item.isStarred,
    attachment: item.attachmentCount > 0,
  }));

  const mailStatusMessages = [
    { title: "빈 상태", body: uiContract.messages.empty, tone: "#475569" },
    { title: "오류 상태", body: mailError || uiContract.messages.error, tone: "#b91c1c" },
    { title: "권한 없음", body: uiContract.messages.permissionDenied, tone: "#9f1239" },
    { title: "세션 만료", body: uiContract.messages.sessionExpired, tone: "#92400e" },
    { title: "보관 경로", body: "장기 보관 메일은 설치형 로컬 아카이브에서 확인합니다.", tone: "#14532d" },
  ];

  const approvalBuckets = [
    { title: "초안", count: documents.filter((doc) => doc.status === "draft").length, tone: "#475569" },
    { title: "상신", count: documents.filter((doc) => doc.status === "submitted").length, tone: "#0f766e" },
    { title: "반려", count: documents.filter((doc) => doc.status === "rejected").length, tone: "#9f1239" },
    { title: "완료", count: documents.filter((doc) => doc.status === "approved").length, tone: "#14532d" },
  ];

  const messengerBuckets = [
    { title: "최근 대화", note: `${messengerRoomsData.length}개 대화방과 읽지 않음 메시지 우선` },
    { title: "즐겨찾기 채널", note: `${messengerRoomsData.filter((item) => item.unreadCount > 0).length}개 채널이 읽지 않음 상태` },
    { title: "첨부 / 링크", note: "파일, 링크, 회의록을 대화와 같은 흐름에서 확인" },
    { title: "로컬 파일 보관", note: "상세 보관은 설치형 클라이언트의 대화 파일 흐름으로 연결" },
  ];

  const messengerRooms = [
    {
      title: "최근 대화",
      entries: messengerRoomsData.slice(0, 5).map((item) => `${item.roomName}${item.unreadCount ? ` (${item.unreadCount})` : ""}`),
    },
    {
      title: "읽지 않음 우선",
      entries: messengerRoomsData.filter((item) => item.unreadCount > 0).slice(0, 5).map((item) => `${item.roomName} (${item.unreadCount})`),
    },
    {
      title: "전체 대화방",
      entries: messengerRoomsData.slice(0, 6).map((item) => item.roomName),
    },
  ].filter((group) => group.entries.length > 0);

  const messengerTimeline = roomMessages.map((item) => ({
    sender: item.senderUserName,
    time: formatDateLabel(item.createdAt),
    body: item.body,
    meta: `읽음 ${item.readBy.length} · ${item.readState}`,
  }));

  const collaborationPanels = [
    {
      title: "참여자 목록",
      body: selectedRoomDetail?.participants.map((item) => item.userName).join(", ") || uiContract.messages.empty,
    },
    {
      title: "최근 메시지 상태",
      body: roomMessages[roomMessages.length - 1]?.readState || "메시지 없음",
    },
    {
      title: "협업 안내",
      body: "정책 경로: Help / 정책",
    },
    {
      title: "대화방 ID",
      body: selectedRoomDetail?.roomId || "-",
    },
  ];

  const messageScopes = [
    { title: "빈 상태", sample: uiContract.messages.empty, tone: "#475569" },
    { title: "오류 메시지", sample: notificationError || approvalError || uiContract.messages.error, tone: "#b91c1c" },
    { title: "차단 메시지", sample: uiContract.messages.blocked, tone: "#9f1239" },
    { title: "경고 메시지", sample: uiContract.messages.warning, tone: "#9a3412" },
    { title: "성공 메시지", sample: feedbackItems[feedbackItems.length - 1]?.title || uiContract.messages.success, tone: "#166534" },
  ];

  const contactDirectory = useMemo(() => {
    const rows: Array<{ name: string; email: string; department: string; role: string; state: "온라인" | "오프라인" }> = [];
    if (me) {
      rows.push({
        name: me.userName,
        email: me.userEmail,
        department: "현재 조직",
        role: me.roleName || "역할 미지정",
        state: "온라인",
      });
    }
    messengerRoomsData.forEach((room) => {
      rows.push({
        name: room.roomName,
        email: "",
        department: "공유 대화방",
        role: `참여자 ${room.participantIds.length}명`,
        state: "오프라인",
      });
    });
    return rows.slice(0, 12);
  }, [me, messengerRoomsData]);

  const organizationTree = useMemo(() => {
    const root = {
      department: "조직도",
      users: contactDirectory.filter((item) => item.department === "현재 조직").map((item) => item.name),
    };
    if (root.users.length === 0) {
      return [{ department: "조직도", users: ["현재 조직 데이터를 불러오는 중입니다."] }];
    }
    return [root];
  }, [contactDirectory]);

  const fileHubItems = useMemo(
    () =>
      [
        ...inboxMails
          .filter((item) => item.attachmentCount > 0)
          .slice(0, 4)
          .map((item) => ({
            type: "메일 첨부",
            title: item.subject || item.mailId,
            source: item.senderEmail,
            count: `${item.attachmentCount}개`,
            key: `mail-${item.mailId}`,
          })),
        ...sentMails
          .filter((item) => item.attachmentCount > 0)
          .slice(0, 4)
          .map((item) => ({
            type: "결재 첨부",
            title: item.subject || item.mailId,
            source: item.senderEmail,
            count: `${item.attachmentCount}개`,
            key: `approval-${item.mailId}`,
          })),
        ...roomMessages
          .filter((item) => item.attachmentMeta.length > 0)
          .slice(0, 4)
          .map((item) => ({
            type: "메신저 공유",
            title: item.body.slice(0, 28) || "미리보기 없음",
            source: item.senderUserName,
            count: `첨부 ${item.attachmentMeta.length}개`,
            key: `message-${item.senderUserId}-${item.createdAt}-${item.messageId}`,
          })),
      ]
        .filter((item) => item.count !== "0개")
      .slice(0, 12),
    [inboxMails, sentMails, roomMessages],
  );

  useEffect(() => {
    if (!token) {
      setSelectedContactEmail("");
      setSelectedOrgMember("");
      setSelectedFileId("");
      return;
    }
    if (contactDirectory.length > 0) {
      const hasSelectedContact = contactDirectory.some((item) =>
        (item.email ? item.email === selectedContactEmail : `${item.name}-${item.department}` === selectedContactEmail),
      );
      if (!hasSelectedContact) {
        const first = contactDirectory[0];
        setSelectedContactEmail(first.email || `${first.name}-${first.department}`);
      }
    } else {
      setSelectedContactEmail("");
    }
    const hasOrgMember = organizationTree.some((department) => department.users.includes(selectedOrgMember));
    if (!hasOrgMember) {
      setSelectedOrgMember(organizationTree[0]?.users[0] || "");
    }
    if (fileHubItems.length > 0) {
      const hasFile = fileHubItems.some((item) => item.key === selectedFileId);
      if (!hasFile) {
        setSelectedFileId(fileHubItems[0]?.key || "");
      }
    } else {
      setSelectedFileId("");
    }
  }, [token, contactDirectory, organizationTree, fileHubItems, selectedContactEmail, selectedOrgMember, selectedFileId]);

  const selectedContact =
    contactDirectory.find((item) => item.email === selectedContactEmail) ?? contactDirectory[0] ?? null;

  const selectedOrganizationMember = selectedOrgMember || organizationTree[0]?.users[0] || "";

  const selectedFileItem = fileHubItems.find((item) => item.key === selectedFileId) ?? fileHubItems[0] ?? null;

  const brandPalette = [
    { title: "대표 색상", value: "#0f766e", usage: "상단 바, 주요 버튼, 핵심 배지" },
    { title: "보조 색상", value: "#1f2937", usage: "사이드바, 문서 헤더, 기본 업무 톤" },
    { title: "강조 색상", value: "#9a6b2f", usage: "메일/메신저 보조 포인트, 고정 영역" },
    { title: "차단 색상", value: "#9f1239", usage: "차단, 긴급, 강한 주의 상태" },
  ];

  const componentRules = [
    { title: "카드", body: "둥근 모서리 + 얕은 그림자 + 상단 킥커 조합으로 제품군 공통 카드 톤을 유지" },
    { title: "버튼", body: "주요 액션은 청록 계열, 보조 액션은 흰 배경 + 회색 경계선으로 통일" },
    { title: "배지", body: "상태/카테고리 배지는 pill 형태와 12~13px 굵은 텍스트로 통일" },
    { title: "탭", body: "활성 탭은 대표 색상 채움, 비활성 탭은 흰 바탕 + 연한 경계선으로 통일" },
  ];

  const statusVisualRules = [
    { title: "성공", body: "처리 완료, 저장 완료, 읽음 처리 완료", bg: "#ecfeff", border: "#99f6e4", color: "#0f766e" },
    { title: "정보", body: "안내, 정책 경로, 기본 참고 메시지", bg: "#eff6ff", border: "#bfdbfe", color: "#1d4ed8" },
    { title: "경고", body: "재검토 필요, 설정 확인, 누락 점검", bg: "#fff7ed", border: "#fed7aa", color: "#b45309" },
    { title: "오류", body: "요청 실패, 불러오기 실패, 네트워크 문제", bg: "#fff1f2", border: "#fecdd3", color: "#b91c1c" },
    { title: "차단", body: "세션 만료, 권한 없음, 접근 제한", bg: "#fdf2f8", border: "#fbcfe8", color: "#9f1239" },
    { title: "비활성", body: "아직 데이터 없음, 대기, 사용 불가", bg: "#f8fafc", border: "#cbd5e1", color: "#64748b" },
  ];
  const settingsContractCards = [
    { title: "브랜드 설정 반영", body: "상단 바, 좌측 메뉴, 주요 버튼, 상태 박스가 관리자 브랜드 값 기준으로 움직입니다." },
    { title: "메뉴 순서 반영", body: "메일, 결재, 메신저, 설정 메뉴 순서와 홈 카드 우선순위가 운영 설정 계약을 공유합니다." },
    { title: "메시지 묶음 반영", body: "오류, 경고, 차단, 빈 상태, 성공, 세션 만료 메시지가 같은 운영 메시지 계약을 따릅니다." },
    { title: "정책 안내 반영", body: "정책 본문은 직접 노출하지 않고 Help / 정책 안내 / 설정 > 보관 정책 경로만 공통 유지합니다." },
  ];

  if (token && !me) {
    return (
      <main
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "linear-gradient(180deg, #f7f5ef 0%, #eef4f3 100%)",
          color: "#0f172a",
          fontFamily: `"Pretendard Variable", "SUIT", "Noto Sans KR", "Segoe UI", sans-serif`,
        }}
      >
        <section style={{ width: "min(480px, calc(100% - 40px))", background: "#fff", borderRadius: 28, padding: 28, border: "1px solid #dbe4ec", boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)" }}>
          <h2 style={{ marginTop: 0 }}>세션 확인 중</h2>
          <p style={{ marginBottom: 0, color: "#475569" }}>저장된 사용자 세션을 확인하고 있습니다.</p>
        </section>
      </main>
    );
  }

  if (token && me?.mustChangePassword) {
    return (
      <main
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "linear-gradient(180deg, #f7f5ef 0%, #eef4f3 100%)",
          color: "#0f172a",
          fontFamily: `"Pretendard Variable", "SUIT", "Noto Sans KR", "Segoe UI", sans-serif`,
          padding: 24,
        }}
      >
        <section style={{ width: "min(560px, 100%)", background: "#fff", borderRadius: 32, padding: 30, border: "1px solid #dbe4ec", boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)", display: "grid", gap: 18 }}>
          <div>
            <div style={{ display: "inline-flex", padding: "8px 14px", borderRadius: 999, background: "#ecfeff", color: "#0f766e", fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>First Login Policy</div>
            <h1 style={{ margin: "18px 0 10px", fontSize: 34, lineHeight: 1.15, letterSpacing: "-0.04em" }}>최초 로그인 비밀번호 변경</h1>
            <p style={{ margin: 0, color: "#475569", lineHeight: 1.7 }}>초기 비밀번호는 아이디와 동일하게 설정되었습니다. 업무 화면에 진입하기 전에 새 비밀번호로 변경해야 합니다.</p>
          </div>
          <article style={{ padding: 18, borderRadius: 22, background: "#f8fafc", border: "1px solid #dbe4ec" }}>
            <strong>{me.userName}</strong>
            <div style={{ marginTop: 6, color: "#475569" }}>{me.userEmail}</div>
            <div style={{ marginTop: 6, color: "#475569" }}>권한 역할: {me.roleName}</div>
          </article>
          <form onSubmit={handleForcedPasswordChange} style={{ display: "grid", gap: 14 }}>
            <label style={{ display: "grid", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#334155" }}>현재 비밀번호</span>
              <input type="password" value={passwordChangeForm.currentPassword} onChange={(event) => setPasswordChangeForm((current) => ({ ...current, currentPassword: event.target.value }))} style={{ height: 48, borderRadius: 14, border: "1px solid #cbd5e1", padding: "0 14px", font: "inherit" }} />
            </label>
            <label style={{ display: "grid", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#334155" }}>새 비밀번호</span>
              <input type="password" value={passwordChangeForm.newPassword} onChange={(event) => setPasswordChangeForm((current) => ({ ...current, newPassword: event.target.value }))} style={{ height: 48, borderRadius: 14, border: "1px solid #cbd5e1", padding: "0 14px", font: "inherit" }} />
            </label>
            <label style={{ display: "grid", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#334155" }}>새 비밀번호 확인</span>
              <input type="password" value={passwordChangeForm.confirmPassword} onChange={(event) => setPasswordChangeForm((current) => ({ ...current, confirmPassword: event.target.value }))} style={{ height: 48, borderRadius: 14, border: "1px solid #cbd5e1", padding: "0 14px", font: "inherit" }} />
            </label>
            {approvalError ? <FeedbackState state="error" title="비밀번호를 변경하지 못했습니다." message={approvalError} /> : null}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button type="submit" disabled={loading} style={{ height: 50, borderRadius: 16, border: 0, background: "linear-gradient(135deg, #0f766e 0%, #0f172a 100%)", color: "#fff", padding: "0 18px", fontWeight: 800, cursor: "pointer" }}>
                {loading ? "변경 중..." : "비밀번호 변경 후 계속"}
              </button>
              <button type="button" onClick={() => { clearUserToken(); setToken(""); setMe(null); setPasswordChangeForm({ currentPassword: "", newPassword: "", confirmPassword: "" }); }} style={{ height: 50, borderRadius: 16, border: "1px solid #cbd5e1", background: "#fff", padding: "0 18px", fontWeight: 700, cursor: "pointer" }}>로그아웃</button>
            </div>
          </form>
        </section>
      </main>
    );
  }

  if (token && me) {
    const portalMenus: Array<{ key: UserPortalMenu; label: string; desc: string }> = [
      { key: "home", label: "홈", desc: "오늘 업무 우선순위" },
      { key: "mail", label: "메일", desc: `${notificationSummary?.unreadCount ?? 0}건 확인` },
      { key: "approval", label: "결재", desc: `${dashboardStats.pendingApprovals}건 대기` },
      { key: "messenger", label: "메신저", desc: "최근 대화" },
      { key: "schedule", label: "일정", desc: "오늘 일정" },
      { key: "contacts", label: "주소록", desc: "연락처" },
      { key: "org", label: "조직도", desc: "부서/역할" },
      { key: "files", label: "파일", desc: "업무 파일" },
      { key: "settings", label: "설정", desc: "언어/화면" },
      { key: "help", label: "Help / 정책", desc: "정책 경로" },
    ];

    const translationTool = null;


    const renderWorkPanel = () => {
      if (["messenger"].includes(activePortalMenu as string)) {
        return <MessengerPanel token={token} />;
      }
      if (["schedule", "contacts", "org", "files", "settings", "help"].includes(activePortalMenu)) {
        return (
          <WorkspacePanels
            menu={activePortalMenu as "schedule" | "contacts" | "org" | "files" | "settings" | "help"}
            token={token}
            locale={locale}
            timezone={timezone}
            ownerUserId={me?.userId ?? ""}
            initialSelectionId={searchWorkspaceSelection?.menu === activePortalMenu ? searchWorkspaceSelection.id : activePortalMenu === "schedule" ? homeScheduleSelectionId : undefined}
            onPreferencesSaved={(nextLocale, nextTimezone) => {
              saveLocale(resolveLocale(nextLocale));
              saveTimezone(nextTimezone);
            }}
            onProfileSaved={() => void refreshHeaderProfile()}
            onComposeMail={openAddressBookMailCompose}
            onOpenWorkspaceSettings={onOpenWorkspaceSettings}
            calendarSettingsRequestKey={calendarSettingsRequestKey}
            translationTool={translationTool}
          />
        );
      }
      if (activePortalMenu === "notices") {
        const currentNotice = selectedNotice ?? homeNotices[0] ?? null;
        return <section className="ui008-notice-workspace" aria-label="공지 목록과 상세">
          <article className="ui008-notice-list">
            <header><h2>공지</h2><span>{homeNotices.filter((item) => !item.is_read).length}건 미확인</span></header>
            <div>{homeNotices.map((item) => <button key={item.id} type="button" className={currentNotice?.id === item.id ? "is-active" : ""} onClick={() => void openHomeItem("notices", item.id)}><strong>{item.title}</strong><span>{item.author_name} · {formatDateLabel(item.published_at)}</span></button>)}</div>
            {!homeNotices.length ? <FeedbackState state="empty" title="게시된 공지가 없습니다." /> : null}
          </article>
          <article className="ui008-notice-detail">
            {currentNotice ? <><header><span>{currentNotice.is_read ? "읽음" : "미확인"}</span><h2>{currentNotice.title}</h2><p>{currentNotice.author_name} · {formatDateLabel(currentNotice.published_at)}</p></header><div>{currentNotice.content}</div></> : <FeedbackState state="empty" title="공지 선택" message="목록에서 공지를 선택하세요." />}
          </article>
        </section>;
      }
      if (activePortalMenu === "mail") {
        return (
          <section className={`user-mail-workbench${mailDetailExpanded ? " is-detail-expanded" : ""}`}>
            <aside className="user-mail-shell" aria-label="메일함 메뉴">
              <button type="button" className="user-mail-compose-action" onClick={openNewMailCompose}>메일쓰기</button>
              <div className="user-mail-shell-group" aria-label="즐겨찾기">
                <strong>즐겨찾기</strong>
                <button type="button" aria-pressed={activeMailFolder === "starred"} onClick={() => openMailFolder("starred")}>중요 <span>{starredMailCount}</span></button>
                <button type="button" aria-pressed={activeMailFolder === "unread"} onClick={() => openMailFolder("unread")}>안 읽은 메일 <span>{unreadInboxCount}</span></button>
              </div>
              <div className="user-mail-shell-group" aria-label="기본 메일함">
                <strong>메일함</strong>
                <button type="button" aria-pressed={activeMailFolder === "inbox"} onClick={() => openMailFolder("inbox")}>받은편지함 <span>{inboxMails.length}</span></button>
                <button type="button" aria-pressed={activeMailFolder === "sent"} onClick={() => openMailFolder("sent")}>보낸편지함 <span>{sentMails.length}</span></button>
                <button type="button" aria-pressed={activeMailFolder === "draft"} onClick={() => openMailFolder("draft")}>임시보관함 <span>{draftMailCount}</span></button>
                <button type="button" aria-pressed={activeMailFolder === "scheduled"} onClick={() => openMailFolder("scheduled")}>예약메일함 <span>{scheduledMails.length}</span></button>
                <button type="button" aria-label="스팸메일함" aria-pressed={activeMailFolder === "spam"} onClick={() => openMailFolder("spam")}>스팸함</button>
                <button type="button" aria-pressed={activeMailFolder === "trash"} onClick={() => openMailFolder("trash")}>휴지통</button>
              </div>
              <div className="user-mail-shell-group user-mail-resource-group" aria-label="사용자 메일함">
                <div><strong>사용자 메일함</strong><button type="button" title="사용자 메일함 추가" onClick={() => openMailResourceModal("folder")}>+</button></div>
                {mailFoldersData.map((folder) => <div className="user-mail-resource-row" key={folder.folderId}>
                  <button type="button" aria-label={"메일함 " + folder.name + " 열기"} aria-pressed={activeMailFolder === "folder:" + folder.folderId} onClick={() => openMailFolder("folder:" + folder.folderId)}>{folder.name} <span>{folder.messageCount}</span></button>
                  <button type="button" aria-label={"메일함 " + folder.name + " 관리"} title="메일함 이름 변경" onClick={(event) => { event.stopPropagation(); openMailResourceModal("folder", folder); }}>수정</button>
                  <button type="button" aria-label={"메일함 " + folder.name + " 삭제"} title="메일함 삭제" onClick={(event) => { event.stopPropagation(); setMailResourceDelete({ kind: "folder", id: folder.folderId, name: folder.name }); }}>삭제</button>
                </div>)}
              </div>
              <div className="user-mail-shell-group user-mail-resource-group" aria-label="태그">
                <div><strong>태그</strong><button type="button" title="태그 추가" onClick={() => openMailResourceModal("tag")}>+</button></div>
                {mailTagsData.map((tag) => <div className="user-mail-resource-row" key={tag.tagId}>
                  <button type="button" aria-pressed={activeMailFolder === "tag:" + tag.tagId} onClick={() => openMailFolder("tag:" + tag.tagId)}><i data-color={tag.color} />{tag.name} <span>{tag.messageCount}</span></button>
                  <button type="button" title="태그 수정" onClick={() => openMailResourceModal("tag", tag)}>수정</button>
                  <button type="button" title="태그 삭제" onClick={() => setMailResourceDelete({ kind: "tag", id: tag.tagId, name: tag.name })}>삭제</button>
                </div>)}
              </div>
              <div className="user-mail-shell-group" aria-label="메일 도구">
                <strong>도구</strong>
                <button type="button" onClick={openMailQuickSearch}>빠른 검색</button>
                <button type="button" aria-pressed={mailSettingsOpen} onClick={() => void openMailBasicSettings()}>환경설정</button>
              </div>
              <div className="user-mail-storage" aria-live="polite">
                <div><strong>메일 용량</strong>{mailStorage ? <span>{Math.round(mailStorage.usagePercent)}%</span> : null}</div>
                <progress max="100" value={Math.min(100, mailStorage?.usagePercent ?? 0)} />
                {mailStorageLoading ? <small>용량 확인 중</small> : null}
                {!mailStorageLoading && mailStorage && mailStorage.quotaBytes > 0 ? <small>{formatStorageBytes(mailStorage.usedBytes)} / {formatStorageBytes(mailStorage.quotaBytes)}</small> : null}
                {!mailStorageLoading && mailStorage && mailStorage.quotaBytes === 0 ? <small>할당량 미설정 · 사용량 {formatStorageBytes(mailStorage.usedBytes)}</small> : null}
                {!mailStorageLoading && mailStorageError ? <><small role="alert">{mailStorageError}</small><button type="button" onClick={() => void loadMailStorage(token)}>용량 다시 시도</button></> : null}
              </div>
            </aside>
            {mailSettingsOpen && mailSettingsTab === "basic" ? (
              <MailBasicSettingsPanel
                value={mailPreferences}
                saved={savedMailPreferences}
                loading={mailPreferencesLoading}
                error={mailPreferencesError}
                conflict={mailPreferencesConflict}
                translationEnabled={translationUiVisible}
                onChange={(patch) => setMailPreferences((current) => current ? { ...current, ...patch } : current)}
                onSave={() => void saveMailBasicSettings()}
                onCancel={closeMailBasicSettings}
                onReset={() => void resetMailBasicSettings()}
                onReload={() => void reloadMailBasicSettings()}
                onOpenSignature={() => setMailSettingsTab("signature")}
                onOpenMailbox={() => void openMailSettings("mailbox")}
                onOpenSpam={() => void openMailSettings("spam")}
                onOpenForwarding={() => void openMailSettings("forwarding")}
                onOpenClassification={() => void openMailSettings("classification")}
                onOpenOutOfOffice={() => void openMailSettings("outOfOffice")}
              />
            ) : mailSettingsOpen && mailSettingsTab === "signature" ? (
              <MailSignatureSettingsPanel
                value={mailSignatures}
                saved={savedMailSignatures}
                loading={mailSignaturesLoading}
                error={mailSignaturesError}
                conflict={mailSignaturesConflict}
                onChange={(patch) => setMailSignatures((current) => current ? { ...current, ...patch } : current)}
                onSavePreferences={saveMailSignaturePreferences}
                onCancel={closeMailBasicSettings}
                onReload={reloadMailSignatures}
                onSaveSignature={saveMailSignature}
                onDeleteSignatures={removeMailSignatures}
                onOpenBasic={() => setMailSettingsTab("basic")}
                onOpenMailbox={() => void openMailSettings("mailbox")}
                onOpenSpam={() => void openMailSettings("spam")}
                onOpenClassification={() => void openMailSettings("classification")}
                onOpenForwarding={() => void openMailSettings("forwarding")}
                onOpenOutOfOffice={() => void openMailSettings("outOfOffice")}
              />
            ) : mailSettingsOpen && mailSettingsTab === "mailbox" ? (
              <MailboxSettingsPanel
                value={mailboxSettings}
                loading={mailboxSettingsLoading}
                error={mailboxSettingsError}
                busyKey={mailboxSettingsBusyKey}
                onReload={() => void loadMailboxSettings(token)}
                onClose={closeMailBasicSettings}
                onOpenBasic={() => void openMailSettings("basic")}
                onOpenSignature={() => void openMailSettings("signature")}
                onOpenSpam={() => void openMailSettings("spam")}
                onOpenClassification={() => void openMailSettings("classification")}
                onOpenForwarding={() => void openMailSettings("forwarding")}
                onOpenOutOfOffice={() => void openMailSettings("outOfOffice")}
                onSavePolicy={saveMailboxPolicy}
                onEmpty={runEmptyMailbox}
                onBackup={startMailboxBackup}
                onRetry={rerunMailboxBackup}
                onDownload={saveMailboxBackupFile}
                onAddFolder={() => openMailResourceModal("folder")}
                onEditFolder={(folder) => openMailResourceModal("folder", folder)}
                onDeleteFolder={(folder) => setMailResourceDelete({ kind: "folder", id: folder.folderId, name: folder.name })}
                onAddTag={() => openMailResourceModal("tag")}
                onEditTag={(tag) => openMailResourceModal("tag", tag)}
                onDeleteTag={(tag) => setMailResourceDelete({ kind: "tag", id: tag.tagId, name: tag.name })}
              />
            ) : mailSettingsOpen && mailSettingsTab === "spam" ? (
              <MailSpamSettingsPanel
                value={spamSettings}
                loading={spamSettingsLoading}
                error={spamSettingsError}
                busy={spamSettingsBusy}
                onReload={() => void loadSpamSettings(token)}
                onClose={closeMailBasicSettings}
                onOpenBasic={() => void openMailSettings("basic")}
                onOpenSignature={() => void openMailSettings("signature")}
                onOpenMailbox={() => void openMailSettings("mailbox")}
                onOpenClassification={() => void openMailSettings("classification")}
                onOpenForwarding={() => void openMailSettings("forwarding")}
                onOpenOutOfOffice={() => void openMailSettings("outOfOffice")}
                onChangePolicy={(enabled) => setSpamSettings((current) => current ? { ...current, filterEnabled: enabled } : current)}
                onSavePolicy={saveSpamPolicy}
                onSaveRule={saveSpamRule}
                onDeleteRule={removeSpamRule}
              />
            ) : mailSettingsOpen && mailSettingsTab === "classification" ? (
              <MailAutoClassificationPanel
                value={autoClassificationSettings}
                loading={autoClassificationLoading}
                error={autoClassificationError}
                busy={autoClassificationBusy}
                onReload={() => void loadAutoClassificationSettings(token)}
                onClose={closeMailBasicSettings}
                onOpenBasic={() => void openMailSettings("basic")}
                onOpenSignature={() => void openMailSettings("signature")}
                onOpenMailbox={() => void openMailSettings("mailbox")}
                onOpenSpam={() => void openMailSettings("spam")}
                onOpenForwarding={() => void openMailSettings("forwarding")}
                onOpenOutOfOffice={() => void openMailSettings("outOfOffice")}
                onChangePolicy={(enabled) => setAutoClassificationSettings((current) => current ? { ...current, enabled } : current)}
                onSavePolicy={saveAutoClassificationPolicy}
                onSaveRule={saveAutoClassificationRule}
                onDelete={removeAutoClassificationRules}
                onReorder={reorderAutoRules}
              />
            ) : mailSettingsOpen && mailSettingsTab === "forwarding" ? (
              <MailAutoForwardingPanel
                value={autoForwardSettings}
                loading={autoForwardLoading}
                error={autoForwardError}
                busy={autoForwardBusy}
                onReload={() => void loadAutoForwardSettings(token)}
                onClose={closeMailBasicSettings}
                onOpenTab={(tab) => void openMailSettings(tab)}
                onChange={(patch) => setAutoForwardSettings((current) => current ? { ...current, ...patch } : current)}
                onSavePolicy={saveAutoForwardPolicy}
                onAddTargets={addAutoForwardTargets}
                onDeleteTargets={removeAutoForwardTargets}
                onSaveException={saveAutoForwardException}
                onDeleteExceptions={removeAutoForwardExceptions}
              />
            ) : mailSettingsOpen && mailSettingsTab === "outOfOffice" ? (
              <MailOutOfOfficePanel
                value={outOfOfficeSettings}
                saved={savedOutOfOfficeSettings}
                loading={outOfOfficeLoading}
                error={outOfOfficeError}
                busy={outOfOfficeBusy}
                onReload={() => void loadOutOfOfficeSettings(token)}
                onClose={closeMailBasicSettings}
                onOpenTab={(tab) => void openMailSettings(tab)}
                onChange={(patch) => setOutOfOfficeSettings((current) => current ? { ...current, ...patch } : current)}
                onSave={saveOutOfOfficePolicy}
                onCancel={() => { setOutOfOfficeSettings(savedOutOfOfficeSettings); setOutOfOfficeError(""); }}
              />
            ) : mailSettingsOpen && mailSettingsTab === "external" ? (
              <MailExternalPanel value={externalAccounts} folders={mailFoldersData} loading={externalAccountsLoading} error={externalAccountsError} busy={externalAccountsBusy}
                onReload={()=>void loadExternalAccounts(token)} onClose={closeMailBasicSettings} onOpenTab={(tab)=>void openMailSettings(tab)}
                onSave={saveExternalAccount} onDelete={removeExternalAccount} onBulkDelete={removeExternalAccounts} onTest={runExternalTest} onCollect={runExternalCollect} />
            ) : mailSettingsOpen && mailSettingsTab === "recent" ? (
              <MailRecentRecipientsPanel value={recentRecipients} loading={recentRecipientsLoading} error={recentRecipientsError} busy={recentRecipientsBusy}
                onReload={() => void loadRecentRecipients(token)} onClose={closeMailBasicSettings} onOpenTab={(tab) => void openMailSettings(tab)}
                onDelete={removeRecentRecipients} />
            ) : (
            <SplitView
              ariaLabel="메일 목록과 상세 영역 너비 조절"
              storageKey="moaworks.user.mail.split-ratio.v1"
              secondaryMaximized={mailDetailExpanded}
              primary={(
            <section className="user-mail-list-panel">
              {activeMailFolder !== "localArchive" ? (
                <form className="user-mail-toolbar" onSubmit={(event) => { event.preventDefault(); updateMailListQuery({ q: mailSearchDraft }); }}>
                  <input aria-label="메일 검색" maxLength={200} value={mailSearchDraft} onChange={(event) => setMailSearchDraft(event.target.value)} placeholder="제목·보낸 사람·본문 검색" />
                  <button type="submit" disabled={mailLoading}>검색</button>
                  <select aria-label="읽음 필터" title={activeMailFolder === "unread" ? "안 읽은 메일함의 고정 조건" : "읽음 상태 필터"} disabled={activeMailFolder === "unread"} value={activeMailFolder === "unread" ? "unread" : mailListQuery.read} onChange={(event) => updateMailListQuery({ read: event.target.value as MailListQuery["read"] })}><option value="all">전체 읽음</option><option value="read">읽음</option><option value="unread">안 읽음</option></select>
                  <select aria-label="중요 필터" title={activeMailFolder === "starred" ? "중요 메일함의 고정 조건" : "중요 상태 필터"} disabled={activeMailFolder === "starred"} value={activeMailFolder === "starred" ? "starred" : mailListQuery.starred} onChange={(event) => updateMailListQuery({ starred: event.target.value as MailListQuery["starred"] })}><option value="all">전체 중요</option><option value="starred">중요</option><option value="unstarred">일반</option></select>
                  <select aria-label="첨부 필터" value={mailListQuery.attachment} onChange={(event) => updateMailListQuery({ attachment: event.target.value as MailListQuery["attachment"] })}><option value="all">전체 첨부</option><option value="with">첨부 있음</option><option value="without">첨부 없음</option></select>
                  {activeMailFolder === "inbox" ? <select aria-label="분류 필터" value={mailListQuery.category} onChange={(event) => updateMailListQuery({ category: event.target.value as MailListQuery["category"] })}><option value="all">전체 분류</option>{MAIL_CATEGORIES.map(([category, label]) => <option key={category} value={category}>{label}</option>)}</select> : null}
                  <select aria-label="정렬" value={mailListQuery.sort} onChange={(event) => updateMailListQuery({ sort: event.target.value as MailListQuery["sort"] })}><option value="date_desc">최신순</option><option value="date_asc">오래된순</option><option value="sender_asc">보낸 사람순</option><option value="subject_asc">제목순</option></select>
                  <button type="button" title="현재 조건으로 다시 조회" onClick={() => void loadMailWorkspace(token, activeMailbox, undefined, activeMailFolder, mailListQuery)}>새로고침</button>
                  <label title="현재 결과 페이지의 메일만 선택"><input type="checkbox" aria-label="현재 페이지 전체 선택" checked={allPageSelected} onChange={(event) => setSelectedMailIds(event.target.checked ? visibleMailList.map((item) => mailSelectionKey(item, activeMailFolder)) : [])} />전체</label>
                  <span aria-live="polite">선택 {selectedMailIds.length} / 전체 {mailListMeta.total}</span>
                  {inboxBulkEnabled ? <><button type="button" title="선택 메일 읽음" disabled={!selectedMailIds.length || mailBulkBusy} onClick={() => void runBulkMailAction("read")}>읽음</button><button type="button" title="선택 메일 안 읽음" disabled={!selectedMailIds.length || mailBulkBusy} onClick={() => void runBulkMailAction("unread")}>안 읽음</button><button type="button" title="선택 메일 중요" disabled={!selectedMailIds.length || mailBulkBusy} onClick={() => void runBulkMailAction("star")}>중요</button><button type="button" title="선택 메일 중요 해제" disabled={!selectedMailIds.length || mailBulkBusy} onClick={() => void runBulkMailAction("unstar")}>중요 해제</button><select aria-label="분류 이동 대상" value={mailMoveCategory} onChange={(event) => setMailMoveCategory(event.target.value)}>{MAIL_CATEGORIES.map(([category, label]) => <option key={category} value={category}>{label}</option>)}</select><button type="button" title="선택 메일 분류 이동" disabled={!selectedMailIds.length || mailBulkBusy} onClick={() => void runBulkMailAction("move", mailMoveCategory)}>분류 이동</button></> : null}
                  {["inbox", "starred", "unread"].includes(activeMailFolder) || activeMailFolder.startsWith("folder:") || activeMailFolder.startsWith("tag:") ? <>
                    <select aria-label="메일함 이동 대상" value={mailMoveFolderId} onChange={(event) => setMailMoveFolderId(event.target.value)}><option value="">메일함 이동</option>{mailFoldersData.map((folder) => <option key={folder.folderId} value={folder.folderId}>{folder.name}</option>)}</select>
                    <button type="button" disabled={!selectedMailIds.length || !mailMoveFolderId || mailBulkBusy} onClick={() => void runUi020BulkAction("move_folder", mailMoveFolderId)}>메일함 이동</button>
                    <select aria-label="태그 대상" value={mailTargetTagId} onChange={(event) => setMailTargetTagId(event.target.value)}><option value="">태그 선택</option>{mailTagsData.map((tag) => <option key={tag.tagId} value={tag.tagId}>{tag.name}</option>)}</select>
                    <button type="button" disabled={!selectedMailIds.length || !mailTargetTagId || mailBulkBusy} onClick={() => void runUi020BulkAction("add_tag", mailTargetTagId)}>태그 추가</button>
                    {activeMailFolder.startsWith("tag:") ? <button type="button" disabled={!selectedMailIds.length || mailBulkBusy} onClick={() => void runUi020BulkAction("remove_tag", activeMailFolder.slice(4))}>현재 태그 제거</button> : null}
                    <button type="button" disabled={!selectedMailIds.length || mailBulkBusy} onClick={() => void runUi020BulkAction("spam")}>스팸 지정</button>
                  </> : null}
                  {activeMailFolder === "spam" ? <button type="button" disabled={!selectedMailIds.length || mailBulkBusy} onClick={() => void runUi020BulkAction("not_spam")}>스팸 해제</button> : null}
                  {activeMailFolder === "trash" ? <>
                    <button type="button" disabled={!selectedMailIds.length || mailBulkBusy} onClick={() => void runUi020BulkAction("restore")}>복원</button>
                    <button type="button" disabled={!selectedMailIds.length || mailBulkBusy} onClick={() => setMailPurgeConfirmOpen(true)}>영구 삭제</button>
                  </> : <button type="button" title="선택 메일 삭제" onClick={() => setMailDeleteConfirmOpen(true)} disabled={!selectedMailIds.length || mailBulkBusy}>삭제</button>}
                  <button type="button" title="이전 페이지" disabled={mailListMeta.offset === 0 || mailLoading} onClick={() => updateMailListQuery({ offset: Math.max(0, mailListMeta.offset - mailListMeta.limit) })}>이전</button>
                  <button type="button" title="다음 페이지" disabled={!mailListMeta.hasMore || mailLoading} onClick={() => updateMailListQuery({ offset: mailListMeta.offset + mailListMeta.limit })}>다음</button>
                  {inboxBulkEnabled && selectedMailId && selectedMailSummary && inboxMails.some((item) => item.mailId === selectedMailId) ? <select aria-label="선택 메일 분류" value={selectedMailSummary.category || "primary"} disabled={mailCategoryBusy} onChange={(event) => void changeSelectedMailCategory(event.target.value)}>{MAIL_CATEGORIES.map(([category, label]) => <option key={category} value={category}>{label}</option>)}</select> : null}
                  {mailBulkBusy || mailCategoryBusy ? <small aria-live="polite">메일 저장 중</small> : null}
                </form>
              ) : null}
              {mailBulkReloadError ? <div className="user-mail-reload-error" role="alert"><span>{mailBulkReloadError}</span><button type="button" onClick={() => void loadMailWorkspace(token, activeMailbox, undefined, activeMailFolder, mailListQuery)}>목록 다시 불러오기</button></div> : null}
              {activeMailFolder === "localArchive" ? (
                <article style={{ borderRadius: 20, padding: 18, border: "1px solid #dbe4ec", background: "#fff", color: "#334155", lineHeight: 1.7 }}>
                  {mailLoading
                    ? "로컬 아카이브를 동기화하고 있습니다."
                    : "로컬 아카이브는 설치형에서 확인합니다."}
                </article>
              ) : (
                <>
                  {mailListSamples.map((item) => (
                    <article
                      key={item.selectionKey}
                      className="user-mail-row"
                      data-selected={selectedMailId === item.mailId}
                      data-unread={item.unread}
                    >
                      <input type="checkbox" aria-label={`메일 선택: ${item.subject}`} checked={selectedMailIds.includes(item.selectionKey)} onClick={(event) => event.stopPropagation()} onChange={(event) => setSelectedMailIds((current) => event.target.checked ? [...current, item.selectionKey] : current.filter((selectionKey) => selectionKey !== item.selectionKey))} />
                      <button className="user-mail-row__main" type="button" onClick={() => { setMailDetailExpanded(false); const mailbox = inferMailboxFromMailId(item.mailId); void selectMail(token, item.mailId, mailbox, { markRead: mailbox === "inbox" && activeMailFolder !== "trash", folder: activeMailFolder }); }}>
                        <span className="user-mail-row__status" aria-label={[item.unread ? "안 읽음" : "읽음", item.important ? "중요" : "", item.attachment ? "첨부 있음" : ""].filter(Boolean).join(", ")}>{item.unread ? "●" : "○"}{item.important ? "★" : ""}{item.attachment ? "📎" : ""}</span>
                        <strong className="user-mail-row__sender" title={item.sender}>{item.sender}</strong>
                        <span className="user-mail-row__content"><strong className="user-mail-row__subject">{item.subject}</strong></span>
                        <time className="user-mail-row__date">{item.time}</time>
                      </button>
                    </article>
                  ))}
                  {mailListSamples.length === 0 && !selectedMailId ? (
                    <FeedbackState
                      state={mailLoading ? "loading" : mailError ? "error" : "empty"}
                      title={mailLoading ? "메일을 불러오는 중입니다." : mailError ? "메일을 불러오지 못했습니다." : "표시할 메일이 없습니다."}
                      message={mailError || undefined}
                      action={mailError ? { label: "다시 시도", onAction: () => void loadMailWorkspace(token, activeMailbox, undefined, activeMailFolder, mailListQuery) } : undefined}
                    />
                  ) : null}
                </>
              )}
            </section>
              )}
              secondary={(
            <article className="user-mail-detail-panel">
              {quickComposeMode === "mail" ? (
                <form className={`user-mail-compose-popup is-${composeWindow}`} onSubmit={(event) => event.preventDefault()} style={composeWindow === "normal" && mailComposePosition ? { left: mailComposePosition.left, top: mailComposePosition.top, transform: "none" } : undefined}>
                  <div className="user-mail-compose-titlebar" onMouseDown={startMailComposeDrag}>
                    <div>
                      <div className="user-mail-compose-eyebrow">메일 작성</div>
                      <h2>{mailComposeContext === "reply" ? "답장" : mailComposeContext === "reply_all" ? "전체답장" : mailComposeContext === "forward" ? "전달" : "새 메일"}</h2>
                    </div>
                    <div className="user-mail-compose-window-actions"><button type="button" aria-label="메일 작성창 최소화" onClick={() => setComposeWindow((current) => current === "minimized" ? "normal" : "minimized")}>— <span>최소화</span></button><button type="button" aria-label={composeWindow === "maximized" ? "메일 작성창 원래 크기" : "메일 작성창 확대"} onClick={() => setComposeWindow((current) => current === "maximized" ? "normal" : "maximized")}>{composeWindow === "maximized" ? "↙" : "↗"} <span>{composeWindow === "maximized" ? "원래 크기" : "확대"}</span></button><button type="button" aria-label="메일 작성창 닫기" onClick={closeMailCompose}>× <span>닫기</span></button></div>
                  </div>
                  <div className="user-mail-compose-body">
                  <div className="user-mail-compose-recipients">
                    <label>
                      <span>받는 사람</span>
                      <div><input ref={mailComposeToRef} aria-label="mail-compose-to" disabled={recipientInputLocked} value={mailComposeForm.to} onChange={(event) => setMailComposeForm((current) => ({ ...current, to: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void confirmRecipientInput("to"); } }} placeholder={recipientInputMode === "name_only" ? "이름 또는 계정" : `admin@${uiContract.company.domain}`} /><button type="button" title="주소록에서 받는 사람 선택" onClick={() => void openRecipientPicker("to")}>선택</button></div>
                    </label>
                    <label>
                      <span>참조</span>
                      <div><input aria-label="mail-compose-cc" disabled={recipientInputLocked} value={mailComposeForm.cc} onChange={(event) => setMailComposeForm((current) => ({ ...current, cc: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void confirmRecipientInput("cc"); } }} placeholder={recipientInputMode === "name_only" ? "이름 또는 계정" : "참조 이메일"} /><button type="button" title="주소록에서 참조 선택" onClick={() => void openRecipientPicker("cc")}>선택</button></div>
                    </label>
                    <label>
                      <span>숨은참조</span>
                      <div><input aria-label="mail-compose-bcc" disabled={recipientInputLocked} value={mailComposeForm.bcc} onChange={(event) => setMailComposeForm((current) => ({ ...current, bcc: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void confirmRecipientInput("bcc"); } }} placeholder={recipientInputMode === "name_only" ? "이름 또는 계정" : "숨은참조 이메일"} /><button type="button" title="주소록에서 숨은참조 선택" onClick={() => void openRecipientPicker("bcc")}>선택</button></div>
                    </label>
                    <small className="user-mail-compose-recipient-hint" aria-live="polite">{recipientInputHint}</small>
                  </div>
                  <label className="user-mail-compose-field">
                    <span>제목</span>
                    <input aria-label="mail-compose-subject" value={mailComposeForm.subject} onChange={(event) => setMailComposeForm((current) => ({ ...current, subject: event.target.value }))} placeholder="제목 입력" />
                  </label>
                  <label className="user-mail-compose-field is-body">
                    <span>본문</span>
                    <MailRichTextEditor
                      value={mailComposeForm.bodyDocument}
                      onChange={handleMailDocumentChange}
                      onUploadImage={uploadComposeInlineImage}
                      onError={setMailError}
                      resolveInlineImageUrl={resolveComposeInlineImageUrl}
                      disabled={mailLoading}
                    />
                  </label>
                  {translationUiVisible ? <section className="user-mail-compose-translation-toolbar" aria-label="발신 메일 번역">
                    <div><strong>발신 메일 번역</strong><small>Provider {translationStatus?.provider}</small></div>
                    <label><span>번역 언어</span><select aria-label="발신 메일 번역 언어" value={outgoingTranslationTargetLocale} onChange={(event) => { setOutgoingTranslationTargetLocale(event.target.value); setMailTranslationPreview(null); setTranslationError(""); }}>{OUTGOING_TRANSLATION_LOCALES.map((locale) => <option key={locale.value} value={locale.value}>{locale.label}</option>)}</select></label>
                    <button className="is-primary" type="button" disabled={translationLoading} onClick={() => void translateOutgoingMail()}>번역 미리보기</button>
                  </section> : null}
                  <CommonPopup title="메일 번역 미리보기" open={outgoingTranslationOpen} onClose={closeOutgoingTranslation} maximizable className="user-mail-translation-popup" error={mailTranslationKind === "outgoing" ? translationError : ""}>
                    <section className="user-mail-translation-workspace" aria-label="원문과 번역문 비교">
                      <header>
                        <div><strong>{OUTGOING_TRANSLATION_LOCALES.find((locale) => locale.value === outgoingTranslationTargetLocale)?.label ?? "영어"} 번역</strong><small>원문은 적용 버튼을 누르기 전까지 변경되지 않습니다.</small></div>
                        <label><span>번역 언어</span><select aria-label="번역 미리보기 언어" value={outgoingTranslationTargetLocale} onChange={(event) => { setOutgoingTranslationTargetLocale(event.target.value); setMailTranslationPreview(null); setTranslationError(""); }}>{OUTGOING_TRANSLATION_LOCALES.map((locale) => <option key={locale.value} value={locale.value}>{locale.label}</option>)}</select></label>
                      </header>
                      <div className="user-mail-translation-comparison">
                        <article><h3>원문</h3><strong>{mailComposeForm.subject || "제목 없음"}</strong><pre>{mailComposeForm.bodyText || "본문 없음"}</pre></article>
                        <article><h3>번역 결과</h3>{translationLoading ? <div role="status" className="user-mail-translation-loading">번역 결과를 준비하고 있습니다.</div> : mailTranslationPreview && mailTranslationKind === "outgoing" ? <><strong>{mailTranslationPreview.subject || "제목 없음"}</strong><pre>{mailTranslationPreview.body || "본문 없음"}</pre></> : <div className="user-mail-translation-empty">목표 언어를 확인한 뒤 번역을 실행하세요.</div>}</article>
                      </div>
                      <footer><button type="button" onClick={closeOutgoingTranslation}>원문 유지</button><button type="button" disabled={translationLoading} onClick={() => void translateOutgoingMail()}>다시 번역</button><button className="is-primary" type="button" disabled={translationLoading || !mailTranslationPreview || mailTranslationKind !== "outgoing"} onClick={applyOutgoingTranslation}>번역 적용</button></footer>
                    </section>
                  </CommonPopup>
                  {activeMailSignature ? <section className="user-mail-compose-signature-preview" aria-label="기본 서명 미리보기">
                    <div><strong>기본 서명 · {activeMailSignature.name}</strong><small>{mailSignatures?.position === "body_top" ? "본문 상단" : "본문 하단"}에 서버가 저장 시 적용</small></div>
                    <pre>{activeMailSignature.contentText}</pre>
                  </section> : null}
                  {mailComposeContext === "forward" && mailComposeSourceDetail?.attachments.length ? (
                    <section className="user-mail-compose-attachments user-mail-compose-source-attachments" aria-label="원문 첨부" title="선택한 원문 첨부는 권한 확인 후 새 파일로 복제됩니다.">
                      <div><strong>원문 첨부</strong><small>{selectedForwardAttachments.length}/{mailComposeSourceDetail.attachments.filter((item) => item.disposition !== "inline").length}개 선택</small></div>
                      {mailComposeSourceDetail.attachments.filter((item) => item.disposition !== "inline").map((item) => (
                        <label key={item.attachmentId}>
                          <input
                            type="checkbox"
                            checked={selectedForwardAttachmentIds.includes(item.attachmentId)}
                            onChange={() => setSelectedForwardAttachmentIds((current) => current.includes(item.attachmentId) ? current.filter((id) => id !== item.attachmentId) : [...current, item.attachmentId])}
                          />
                          <span>{item.fileName}</span><small>{formatFileSize(item.sizeBytes)}</small>
                        </label>
                      ))}
                    </section>
                  ) : null}
                  <section className="user-mail-compose-attachments" aria-label="메일 첨부">
                    <div><strong>첨부</strong><small>{mailComposeAttachmentCount}개 · {formatFileSize(mailComposeAttachmentBytes)}</small></div>
                    <label title="파일당 10 MB, 최대 10개, 합계 25 MB">
                      파일 선택
                      <input type="file" multiple onChange={(event) => { addMailComposeFiles(event.target.files); event.target.value = ""; }} />
                    </label>
                    {mailComposeRetainedOrdinaryAttachments.map((attachment) => <div key={attachment.attachmentId}><span>{attachment.fileName}</span><small>기존 첨부 · {formatFileSize(attachment.sizeBytes)}</small><button type="button" aria-label={`${attachment.fileName} 첨부 제거`} onClick={() => setMailComposePersistedAttachments((current) => current.filter((item) => item.attachmentId !== attachment.attachmentId))}>제거</button></div>)}
                    {mailComposeFiles.map((item) => <div key={item.id}><span>{item.file.name}</span><small>{formatFileSize(item.file.size)}</small><button type="button" aria-label={`${item.file.name} 첨부 제거`} onClick={() => removeMailComposeAttachment(item.id)}>제거</button></div>)}
                  </section>
                  <label className="user-mail-compose-field" title="현재보다 1분 이후, 365일 이내">
                    <span>예약 발송 시각</span>
                    <input type="datetime-local" aria-label="mail-compose-scheduled-at" value={mailComposeForm.scheduledAt} onChange={(event) => setMailComposeForm((current) => ({ ...current, scheduledAt: event.target.value }))} />
                  </label>
                  <div className="user-mail-compose-submit-actions">
                    <button type="button" disabled={mailLoading} onClick={() => void submitMailCompose("draft")}>임시저장</button>
                    <button type="button" disabled={mailLoading} onClick={() => void submitMailCompose("schedule")}>예약 발송</button>
                    <button type="button" disabled={mailLoading} onClick={() => void submitMailCompose("send")} style={{ background: uiContract.brand.primary, color: "#fff" }}>즉시 발송</button>
                  </div>
                  {recipientPickerTarget ? (
                    <div className="user-mail-recipient-picker-backdrop">
                      <section role="dialog" aria-modal="true" aria-label="메일 수신자 선택" className="user-mail-recipient-picker" onKeyDown={(event) => { if (event.key === "Escape") setRecipientPickerTarget(null); }}>
                        <header><strong>{recipientPickerTarget === "to" ? "받는 사람" : recipientPickerTarget === "cc" ? "참조" : "숨은참조"} 선택</strong><button type="button" onClick={() => setRecipientPickerTarget(null)}>닫기</button></header>
                        <nav className="user-mail-recipient-picker-tabs" aria-label="수신자 원본"><button type="button" aria-pressed={recipientPickerSource === "contact"} onClick={() => setRecipientPickerSource("contact")}>주소록</button><button type="button" aria-pressed={recipientPickerSource === "directory"} onClick={() => setRecipientPickerSource("directory")}>조직도</button><button type="button" aria-pressed={recipientPickerSource === "recent"} onClick={() => setRecipientPickerSource("recent")}>최근 수신자</button></nav>
                        <input autoFocus aria-label="수신자 검색" value={recipientPickerQuery} onChange={(event) => setRecipientPickerQuery(event.target.value)} placeholder="이름, 부서, 이메일 검색" />
                        <div className="user-mail-recipient-picker-list">
                          {recipientPickerLoading ? <span role="status">수신자를 불러오는 중입니다.</span> : recipientSuggestions.filter((item) => item.source === recipientPickerSource && `${item.name} ${item.email} ${item.detail}`.toLowerCase().includes(recipientPickerQuery.trim().toLowerCase())).map((item) => <button type="button" key={`${item.source}:${item.email}`} onClick={() => addRecipientSuggestion(item)}><strong>{item.name}</strong><span>{item.email}</span><small>{item.detail}</small></button>)}
                        </div>
                      </section>
                    </div>
                  ) : null}
                  {mailError ? <FeedbackState state="error" title="메일을 처리하지 못했습니다." message={mailError} /> : null}
                  </div>
                </form>
              ) : (
                <>
                  <header className="user-mail-detail-header">
                    <div><small>메일 상세</small><h2>{selectedMailDetail?.subject || "메일을 선택하세요"}</h2></div>
                    <div><button type="button" aria-label={mailDetailExpanded ? "메일 상세 분할 보기" : "메일 상세 전체 보기"} aria-pressed={mailDetailExpanded} onClick={() => setMailDetailExpanded((current) => !current)}>{mailDetailExpanded ? "분할 보기" : "상세 전체 보기"}</button><button type="button" onClick={openNewMailCompose}>메일 작성</button></div>
                  </header>
                  {mailDetailLoading ? (
                    <FeedbackState state="loading" title="메일 상세를 불러오는 중입니다." />
                  ) : mailDetailError ? (
                    <FeedbackState state="error" title="메일 상세를 불러오지 못했습니다." message={mailDetailError} action={{ label: "다시 시도", onAction: () => void loadMailDetail(token, selectedMailId, inferMailboxFromMailId(selectedMailId), { folder: activeMailFolder }) }} />
                  ) : !selectedMailDetail ? (
                    <FeedbackState state="empty" title="메일을 선택하세요." message="목록에서 메일을 선택하면 상세 내용을 확인할 수 있습니다." />
                  ) : (
                    <div className="user-mail-detail-content">
                      <dl className="user-mail-detail-meta">
                        <div><dt>보낸 사람</dt><dd>{selectedMailDetail.senderEmail}</dd></div>
                        <div><dt>받는 사람</dt><dd>{mailToRecipients.map((item) => item.recipientEmail).join(", ") || "-"}</dd></div>
                        <div><dt>참조</dt><dd>{mailCcRecipients.map((item) => item.recipientEmail).join(", ") || "-"}</dd></div>
                        <div><dt>일시</dt><dd>{formatMailDate(selectedMailDetail.sentAt || selectedMailDetail.createdAt)}</dd></div>
                        <div><dt>상태</dt><dd>{activeMailFolder === "sent" ? "보낸편지함" : activeMailFolder === "draft" ? "임시보관함" : activeMailFolder === "scheduled" ? "예약메일함" : "받은편지함"}</dd></div>
                      </dl>
                      <div className="user-mail-detail-actions">
                        {translationUiVisible && isInboxDetail ? <button type="button" disabled={translationLoading} onClick={() => void translateIncomingMail()}>메일 번역</button> : null}
                        {translationUiVisible && mailTranslationKind === "incoming" && mailTranslationPreview?.mailId === selectedMailDetail.mailId ? <button type="button" onClick={() => setShowTranslatedMail((current) => !current)}>{showTranslatedMail ? "원문 보기" : "번역문 보기"}</button> : null}
                        {activeMailFolder === "draft" ? <button type="button" onClick={editDraftMail}>초안 편집</button> : null}
                        {activeMailFolder === "scheduled" ? <><button type="button" onClick={editScheduledMail}>예약 수정</button><button type="button" onClick={() => void runScheduledAction("send")}>지금 발송</button><button type="button" onClick={() => void runScheduledAction("cancel")}>예약 취소</button></> : null}
                        {activeMailFolder === "sent" && selectedMailDetail.externalDeliveries.some((item) => ["failed", "blocked"].includes(item.status)) ? <button type="button" onClick={() => void runScheduledAction("retry")}>재시도</button> : null}
                        {canReplyToSelectedMail ? <button type="button" onClick={() => openMailComposeFromDetail("reply")}>답장</button> : null}
                        {canReplyToSelectedMail ? <button type="button" onClick={() => openMailComposeFromDetail("reply_all")}>전체답장</button> : null}
                        {canForwardSelectedMail ? <button type="button" onClick={() => openMailComposeFromDetail("forward")}>전달</button> : null}
                        {canViewSelectedMailReadReceipts ? <button type="button" aria-expanded={mailReadReceiptOpen} aria-controls="mail-read-receipt-popover" onClick={() => setMailReadReceiptOpen((current) => !current)}>수신 확인 · {selectedMailReadReceiptSummary}</button> : null}
                        {canUpdateSelectedMailStatus ? <button type="button" aria-label="mail-detail-read-action" onClick={() => void handleSelectedMailReadAction()}>{selectedMailSummary?.isRead ? "읽음 상태 확인" : "읽음 처리"}</button> : null}
                        {canUpdateSelectedMailStatus ? <button type="button" aria-label="mail-detail-star-action" onClick={() => void toggleSelectedMailStar()}>{selectedMailSummary?.isStarred ? "중요 해제" : "중요 표시"}</button> : null}
                      </div>
                      {canViewSelectedMailReadReceipts && mailReadReceiptOpen ? (
                        <section id="mail-read-receipt-popover" className="user-mail-read-receipt" role="dialog" aria-label="수신 확인 상세" aria-modal="false" onKeyDown={(event) => { if (event.key === "Escape") setMailReadReceiptOpen(false); }}>
                          <header><div><strong>수신 확인</strong><small aria-live="polite">{selectedMailReadReceiptSummary}</small></div><button type="button" onClick={() => setMailReadReceiptOpen(false)}>닫기</button></header>
                          <ul>
                            {selectedMailDetail.recipients.map((recipient) => (
                              <li key={`${recipient.recipientKind}:${recipient.recipientEmail}`}>
                                <span className="user-mail-read-receipt__recipient"><small>{recipient.recipientKind === "to" ? "받는 사람" : recipient.recipientKind === "cc" ? "참조" : recipient.recipientKind === "bcc" ? "숨은참조" : recipient.recipientKind}</small><strong>{maskMailReadReceiptAddress(recipient.recipientEmail)}</strong></span>
                                <span className="user-mail-read-receipt__status">{recipient.recipientUserId ? recipient.isRead === true ? <>읽음 · <time dateTime={recipient.readAt || undefined}>{formatMailDate(recipient.readAt)}</time></> : "읽지 않음" : "확인 불가"}</span>
                              </li>
                            ))}
                          </ul>
                        </section>
                      ) : null}
                      {activeMailFolder === "sent" && selectedMailDetail.externalDeliveries.length ? (
                        <section className="user-mail-read-receipt" aria-label="외부 전달 상태">
                          <header><div><strong>외부 전달 상태</strong><small>Relay 상세 주소와 오류는 관리자에게만 표시됩니다.</small></div></header>
                          <ul>{selectedMailDetail.externalDeliveries.map(delivery => (
                            <li key={delivery.recipientEmail+":"+delivery.recipientKind}><span><small>{delivery.recipientKind}</small><strong>{delivery.recipientEmail}</strong></span><span>{delivery.lastError ? `실패 사유: ${delivery.lastError}` : delivery.status === "queued" ? "외부 대기" : delivery.status === "blocked" ? "운영 설정 필요" : delivery.status === "retry_pending" ? "재시도 예정" : delivery.status === "sent" ? "전달 완료" : delivery.status === "failed" ? "전달 실패" : delivery.status}</span></li>
                          ))}</ul>
                        </section>
                      ) : null}
                      {showTranslatedMail && mailTranslationKind === "incoming" && mailTranslationPreview?.mailId === selectedMailDetail.mailId ? (
                        <div className="user-mail-detail-body" data-testid="translated-mail-body">{mailTranslationPreview.body}</div>
                      ) : selectedMailDetail.bodyHtml ? (
                        <section className="user-mail-detail-rich-body">
                          {hasRemoteMailImages && mailPreferences?.blockRemoteImages !== false && !showRemoteMailImages ? <button type="button" onClick={() => setShowRemoteMailImages(true)}>외부 이미지 표시</button> : null}
                          <iframe
                            title="메일 HTML 본문"
                            sandbox=""
                            referrerPolicy="no-referrer"
                            srcDoc={safeMailHtml}
                          />
                        </section>
                      ) : (
                        <div className="user-mail-detail-body">{selectedMailDetail.bodyText || selectedMailDetail.subject}</div>
                      )}
                      {downloadableMailAttachments.length ? (
                        <section className="user-mail-detail-attachments" aria-label="첨부 파일">
                          <h3>첨부 {downloadableMailAttachments.length}개</h3>
                          {downloadableMailAttachments.map((attachment) => <button type="button" key={attachment.attachmentId} onClick={() => void handleMailAttachmentDownload(attachment.attachmentId, attachment.fileName)}><strong>{attachment.fileName}</strong><span>{attachment.contentType}</span><small>{formatFileSize(attachment.sizeBytes)}</small><em>다운로드</em></button>)}
                        </section>
                      ) : null}
                    </div>
                  )}
                </>
              )}
            </article>
              )}
            />
            )}
          </section>
        );
      }

      if (activePortalMenu === "schedule") {
        return (
          <section style={{ display: "grid", gridTemplateColumns: "320px minmax(420px, 1fr)", gap: 18, minHeight: 0 }}>
            <aside style={{ borderRadius: 24, padding: 22, background: "#fff", border: "1px solid #dbe4ec", overflowY: "auto" }}>
              <div style={{ fontSize: 12, color: uiContract.brand.primary, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>일정 요약</div>
              <h2 style={{ margin: "10px 0 0" }}>오늘 일정</h2>
              <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
                {[
                  { title: "오전 점검", time: "09:30", state: "운영 확인" },
                  { title: "결재 마감 확인", time: "13:00", state: `${dashboardStats.pendingApprovals}건 대기` },
                  { title: "알림 점검", time: "16:00", state: `미확인 ${dashboardStats.unreadCount}건` },
                ].map((item) => (
                  <article key={`${item.time}-${item.title}`} style={{ borderRadius: 16, border: "1px solid #dbe4ec", background: "#f8fafc", padding: 14 }}>
                    <div style={{ fontWeight: 800 }}>{item.title}</div>
                    <div style={{ marginTop: 6, color: "#475569" }}>{item.time}</div>
                    <div style={{ marginTop: 8, color: "#0f766e", fontWeight: 700 }}>{item.state}</div>
                  </article>
                ))}
              </div>
            </aside>
            <article style={{ borderRadius: 24, padding: 22, background: "#fff", border: "1px solid #dbe4ec", overflowY: "auto" }}>
              <div style={{ fontSize: 12, color: uiContract.brand.primary, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>업무 일정 보기</div>
              <h2 style={{ margin: "10px 0 0" }}>마감과 협업 일정</h2>
              <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
                {[
                  "메일 확인과 결재 처리 흐름을 일정 우선순위에 맞춰 정렬합니다.",
                  "긴 설명 대신 오늘 처리해야 할 업무와 마감 시각만 먼저 보여줍니다.",
                  "정책 경로는 Help / 설정에서 확인합니다.",
                ].map((item) => (
                  <div key={item} style={{ borderRadius: 16, border: "1px solid #dbe4ec", background: "#fff", padding: 14, color: "#334155", lineHeight: 1.6 }}>
                    {item}
                  </div>
                ))}
              </div>
            </article>
          </section>
        );
      }

      if (activePortalMenu === "contacts") {
        return (
          <section style={{ display: "grid", gridTemplateColumns: "280px minmax(420px, 1fr)", gap: 18, minHeight: 0 }}>
            <aside style={{ borderRadius: 24, padding: 22, background: "#fff", border: "1px solid #dbe4ec", overflowY: "auto" }}>
              <div style={{ fontSize: 12, color: uiContract.brand.primary, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>주소록 요약</div>
              <h2 style={{ margin: "10px 0 0" }}>주소록 업무 보기</h2>
              {contactDirectory.length === 0 ? <div style={{ marginTop: 14, color: "#64748b" }}>{uiContract.messages.empty}</div> : null}
              <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                {contactDirectory.map((item) => (
                  <button
                    key={`${item.name}-${item.email || item.department}`}
                    type="button"
                    onClick={() => setSelectedContactEmail(item.email || `${item.name}-${item.department}`)}
                    style={{ padding: 16, border: "1px solid #dbe4ec", borderRadius: 16, background: "#f8fafc", textAlign: "left", cursor: "pointer" }}
                  >
                    <div style={{ fontWeight: 800 }}>{item.name}</div>
                    <div style={{ color: "#475569", marginTop: 6 }}>{item.email || "내부 채널"} / {item.department} / {item.role}</div>
                    <div style={{ color: item.state === "온라인" ? "#166534" : "#64748b", marginTop: 8, fontWeight: 700 }}>{item.state}</div>
                  </button>
                ))}
              </div>
            </aside>
            <article style={{ borderRadius: 24, padding: 22, background: "#fff", border: "1px solid #dbe4ec", overflowY: "auto" }}>
              <div style={{ fontSize: 12, color: uiContract.brand.primary, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>연락처 상세</div>
              <h3 style={{ margin: "10px 0 0", fontSize: 28 }}>최근 선택 항목으로 이동</h3>
              {selectedContact ? (
                <ul style={{ margin: 0, paddingLeft: 20, color: "#334155", lineHeight: 1.8 }}>
                  <li>최근 사용 대상: {selectedContact.name}</li>
                  <li>이메일: {selectedContact.email || "내부 채널"}</li>
                  <li>부서: {selectedContact.department}</li>
                  <li>역할: {selectedContact.role}</li>
                  <li>상태: {selectedContact.state}</li>
                  <li>표시 기준: 현재 세션 기반 사용자 + 대화방 대표</li>
                  <li>도움말: 클릭 동작은 상세 페이지로 확장 가능합니다.</li>
                </ul>
              ) : (
                <p style={{ color: "#64748b" }}>표시할 주소록 데이터가 없습니다.</p>
              )}
            </article>
          </section>
        );
      }

      if (activePortalMenu === "org") {
        return (
          <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, minHeight: 0 }}>
            <article style={{ borderRadius: 24, padding: 22, background: "#fff", border: "1px solid #dbe4ec", overflowY: "auto" }}>
              <div style={{ fontSize: 12, color: uiContract.brand.primary, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>조직 트리</div>
              <h2 style={{ margin: "10px 0 0" }}>조직도 업무 보기</h2>
              <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
                {organizationTree.map((item) => (
                  <div key={item.department} style={{ border: "1px solid #dbe4ec", borderRadius: 16, padding: 14, background: "#f8fafc" }}>
                    <strong>{item.department}</strong>
                    <div style={{ marginTop: 8 }}>
                      {item.users.map((userName, index) => (
                        <button
                          key={`${item.department}-${userName}-${index}`}
                          type="button"
                          onClick={() => setSelectedOrgMember(userName)}
                          style={{ width: "100%", border: 0, background: "#fff", borderRadius: 10, padding: "6px 10px", textAlign: "left", color: "#334155" }}
                        >
                          {userName}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </article>
            <article style={{ borderRadius: 24, padding: 22, background: "#fff", border: "1px solid #dbe4ec", overflowY: "auto" }}>
              <div style={{ fontSize: 12, color: uiContract.brand.primary, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>권한 요약</div>
              <h3 style={{ margin: "10px 0 0", fontSize: 28 }}>역할/권한 동기화</h3>
              <p style={{ color: "#475569", lineHeight: 1.7 }}>
                사용자 역할: {me?.roleName || "미지정"} / 회사: {me?.companyId || "알 수 없음"} / 이메일: {me?.userEmail || "미설정"}
              </p>
              <p style={{ color: "#64748b" }}>선택 사용자: {selectedOrganizationMember || "미지정"} / 권한 변경은 관리자 콘솔에서 반영되며 사용자 웹은 상태를 즉시 반영합니다.</p>
              <p style={{ color: "#64748b" }}>권한 상태: {selectedOrgMember ? "직접 선택됨" : "기본 상태"} </p>
            </article>
          </section>
        );
      }

      if (activePortalMenu === "files") {
        return (
          <section style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 18, minHeight: 0 }}>
            <article style={{ borderRadius: 24, padding: 22, background: "#fff", border: "1px solid #dbe4ec", overflowY: "auto" }}>
              <div style={{ fontSize: 12, color: uiContract.brand.primary, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>최근 파일</div>
              <h2 style={{ margin: "10px 0 0" }}>파일 업무 보기</h2>
              {fileHubItems.length > 0 ? (
                <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
                  {fileHubItems.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setSelectedFileId(item.key)}
                      style={{ border: "1px solid #dbe4ec", borderRadius: 16, padding: 14, background: selectedFileId === item.key ? "#e0f2fe" : "#f8fafc", color: "#334155", textAlign: "left" }}
                    >
                      <div style={{ fontWeight: 800 }}>{item.type}</div>
                      <div>{item.title}</div>
                      <div style={{ marginTop: 8, color: "#64748b" }}>
                        출처: {item.source} / {item.count}
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <p style={{ color: "#64748b" }}>{uiContract.messages.empty}</p>
              )}
            </article>
            <article style={{ borderRadius: 24, padding: 22, background: "#fff", border: "1px solid #dbe4ec", overflowY: "auto" }}>
              <div style={{ fontSize: 12, color: uiContract.brand.primary, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>파일 연계</div>
              <h3 style={{ margin: "10px 0 0", fontSize: 22 }}>설치형 연동 보기</h3>
              <p style={{ color: "#475569", lineHeight: 1.7 }}>
                첨부 파일과 공유 항목은 설치형 연동으로 확인합니다.
              </p>
              {selectedFileItem ? (
                <div style={{ marginTop: 14, border: "1px solid #dbe4ec", borderRadius: 16, padding: 14, background: "#f8fafc" }}>
                  <div style={{ fontWeight: 800 }}>{selectedFileItem.type}</div>
                  <div>{selectedFileItem.title}</div>
                  <div style={{ marginTop: 8, color: "#64748b" }}>출처: {selectedFileItem.source}</div>
                  <div style={{ marginTop: 4, color: "#64748b" }}>수량: {selectedFileItem.count}</div>
                </div>
              ) : null}
            </article>
          </section>
        );
      }

      if (activePortalMenu === "approval") {
        const activeApprovalMenu = APPROVAL_SHELL_MENU_ITEMS.find((item) => item.key === approvalShellMenu) ?? APPROVAL_SHELL_MENU_ITEMS[0];
        const menuDocuments = isApprovalActualMenuKey(approvalShellMenu)
          ? approvalDocumentsByMenu[approvalShellMenu]
          : [];
        const filteredDocuments = filterApprovalDocuments(menuDocuments, approvalStatusFilter, approvalSearch);
        const effectiveSelectionId = resolveApprovalSelection(selectedApprovalId, filteredDocuments);
        const selectedDocument = selectedApprovalDetail?.id === effectiveSelectionId ? selectedApprovalDetail : null;
        const selectedApprovers = createForm.approverUserIds
          .map((userId) => approvalApprovers.find((user) => user.userId === userId))
          .filter((user): user is ApprovalApprover => Boolean(user));
        const selectedReferences = createForm.referenceUserIds.map((userId) => approvalApprovers.find((user) => user.userId === userId)).filter((user): user is ApprovalApprover => Boolean(user));
        const selectedViewers = createForm.viewerUserIds.map((userId) => approvalApprovers.find((user) => user.userId === userId)).filter((user): user is ApprovalApprover => Boolean(user));
        const availableApprovers = approvalApprovers.filter((user) => {
          const keyword = approverSearch.trim().toLowerCase();
          const alreadySelected = [...createForm.approverUserIds, ...createForm.referenceUserIds, ...createForm.viewerUserIds].includes(user.userId);
          return !alreadySelected && (!keyword || `${user.userName} ${user.departmentName} ${user.userEmail}`.toLowerCase().includes(keyword));
        });
        const openActionModal = (mode: ApprovalActionType) => {
          if (selectedDocument) openApprovalAction(mode, selectedDocument);
        };
        const renderApprovalMenuItem = (item: ApprovalShellMenuItem) => {
          const isCurrent = approvalShellMenu === item.key;
          const count = isApprovalActualMenuKey(item.key) ? approvalDocumentsByMenu[item.key].length : null;
          return (
            <button
              key={item.key}
              type="button"
              className="ui031-menu-item"
              aria-current={isCurrent ? "page" : undefined}
              onClick={() => openApprovalShellMenu(item.key)}
            >
              <span><strong>{item.label}</strong><small>{item.description}</small></span>
              <em>{count == null ? "준비" : count}</em>
            </button>
          );
        };
        return (
          <section className="ui031-shell">
            <aside className="ui031-shell__sidebar" aria-label="전자결재 보조 메뉴">
              <header className="ui031-shell__intro">
                <span>업무 탐색</span>
                <div><h1>전자결재</h1><i className="ui031-help" tabIndex={0} data-tooltip="결재 문서를 처리 순서와 보관 관점으로 나누어 확인합니다." aria-label="전자결재 도움말">i</i></div>
                <p>처리할 문서와 보관 문서를 빠르게 오갑니다.</p>
              </header>
              <span
                className="ui031-primary-wrap"
                tabIndex={canAct.create ? -1 : 0}
                data-tooltip={canAct.create ? "새 결재 작성 창을 엽니다." : "현재 계정은 결재 작성 권한이 없습니다."}
              >
                <button aria-label="새 결재 진행" type="button" disabled={!canAct.create} onClick={() => void openApprovalEditor("create")}>새 결재 진행</button>
              </span>
              <nav className="ui031-menu-group" aria-label="전자결재 업무 메뉴">
                <strong>업무</strong>
                {APPROVAL_SHELL_MENU_ITEMS.filter((item) => item.group === "work").map(renderApprovalMenuItem)}
              </nav>
              <nav className="ui031-menu-group" aria-label="전자결재 문서함">
                <strong>문서함</strong>
                {APPROVAL_SHELL_MENU_ITEMS.filter((item) => item.group === "library").map(renderApprovalMenuItem)}
              </nav>
              <div className="ui031-menu-footer">
                {APPROVAL_SHELL_MENU_ITEMS.filter((item) => item.group === "footer").map(renderApprovalMenuItem)}
              </div>
            </aside>
            <main className="ui031-shell__main" aria-labelledby="ui031-content-title">
            <header className="ui031-shell__header">
              <div>
                <span>전자결재</span>
                <h2 id="ui031-content-title">{activeApprovalMenu.label}</h2>
                <p>{activeApprovalMenu.description}</p>
              </div>
              <strong>{isApprovalActualMenuKey(approvalShellMenu) ? `${menuDocuments.length}건` : "개인 설정"}</strong>
            </header>
            {approvalError && approvalModal === "none" ? <FeedbackState state="error" title="결재 정보를 처리하지 못했습니다." message={approvalError} action={{ label: "다시 시도", onAction: () => void reload() }} /> : null}
            {isApprovalActualMenuKey(approvalShellMenu) ? (
            <div className="ui031-shell__body ui032-approval-split">
              <SplitView
                ariaLabel="결재 목록과 상세 크기 조절"
                storageKey="moaworks.user.approval.split-ratio.v2"
                defaultRatio={50}
                minRatio={28}
                maxRatio={65}
                secondaryMaximized={approvalDetailMaximized}
                primary={<section className="ui031-list" aria-label="결재 목록">
                <div className="ui031-list__filters">
                  {[["all", "전체"], ["draft", "초안"], ["submitted", "상신"], ["rejected", "반려"], ["withdrawn", "회수"], ["approved", "완료"]].map(([value, label]) => (
                    <button key={value} type="button" className={approvalStatusFilter === value ? "is-active" : ""} onClick={() => setApprovalStatusFilter(value)}>{label}</button>
                  ))}
                </div>
                <input className="ui031-list__search" aria-label="결재 검색" value={approvalSearch} onChange={(event) => setApprovalSearch(event.target.value)} placeholder="제목, 기안자, 현재 결재자 검색" />
                <div className="ui032-list-columns" aria-hidden="true"><span>기안일</span><span>긴급 여부</span><span>제목</span><span>기안자</span></div>
                <div className="ui031-list__items">
                  {filteredDocuments.map((document) => {
                    const currentLine = document.lines.find((line) => line.sequence === document.currentLineIndex);
                    const isSelected = effectiveSelectionId === document.id;
                    const decidedCount = document.lines.filter((line) => line.status !== "pending").length;
                    return <button className={`ui032-list-row${isSelected ? " is-active" : ""}`} aria-current={isSelected ? "true" : undefined} key={document.id} type="button" onClick={() => void selectApprovalDocument(document.id)}>
                      <span>{formatDateLabel(document.createdAt)}</span><span className={document.urgent ? "is-urgent" : ""}>{document.urgent ? "긴급" : "일반"}</span><strong>{document.title}</strong><span>{document.creatorUserName}</span>
                      <small><span className={`ui032-status is-${document.status}`}>{approvalStatusLabel(document.status)}</span> 현재 {currentLine?.approverUserName ?? "-"} · 진행 {decidedCount}/{document.lines.length}</small>
                    </button>;
                  })}
                  {!filteredDocuments.length ? <div className="ui032-empty">표시할 결재 문서가 없습니다.</div> : null}
                </div>
              </section>}
                secondary={<section className="ui031-detail ui032-detail" aria-label="결재 상세">
                <div className="ui032-detail__toolbar"><button type="button" onClick={() => setApprovalDetailMaximized((current) => !current)}>{approvalDetailMaximized ? "분할 복귀" : "상세 최대화"}</button></div>
                {approvalDetailLoading ? <div className="ui032-state" role="status">최신 결재 상세를 불러오는 중입니다.</div> : null}
                {approvalDetailError ? <div className="ui032-state is-error" role="alert">{approvalDetailError}<button type="button" onClick={retryApprovalDetail}>상세 다시 시도</button></div> : null}
                {!approvalDetailLoading && !approvalDetailError && selectedDocument ? <>
                  <header className="ui032-detail__header"><div><span>선택 문서</span><h2>{selectedDocument.title}</h2><p>기안 {selectedDocument.creatorUserName} · 작성 {formatDateLabel(selectedDocument.createdAt)} · 상신 {selectedDocument.submittedAt ? formatDateLabel(selectedDocument.submittedAt) : "-"} · 갱신 {formatDateLabel(selectedDocument.updatedAt)}</p></div><span className={`ui032-status is-${selectedDocument.status}`}>{approvalStatusLabel(selectedDocument.status)}</span></header>
                  <section className="ui032-detail__content" data-testid="approval-document-body"><h3>본문</h3><p>{selectedDocument.content}</p></section>
                  <div className="ui032-detail-links"><button type="button" onClick={() => setApprovalLineModalOpen(true)}>결재선 보기</button><button type="button" onClick={() => setApprovalHistoryModalOpen(true)}>처리 이력 보기</button></div>
                  <section className="ui032-attachments"><h3>첨부</h3>{approvalAttachmentError ? <div className="ui032-attachment-error" role="alert">{approvalAttachmentError}</div> : null}{selectedDocument.attachments.length ? selectedDocument.attachments.map((attachment) => <article key={attachment.attachmentId}>{attachment.previewUrl && approvalAttachmentPreviewUrls[attachment.attachmentId] ? <img className={`ui035-attachment-preview is-${approvalPreferences?.attachmentImageDisplay ?? "filename"}`} src={approvalAttachmentPreviewUrls[attachment.attachmentId]} alt={attachment.fileName} /> : null}<div><strong>{attachment.fileName}</strong><span>{attachment.contentType} · {formatFileSize(attachment.sizeBytes)} · {formatDateLabel(attachment.createdAt)}</span></div><button type="button" onClick={() => void handleApprovalAttachmentDownload(attachment.attachmentId, attachment.fileName)}>다운로드</button></article>) : <div className="ui032-empty">첨부 파일이 없습니다.</div>}</section>
                  <div className="ui032-actions" aria-label="결재 처리 도구">
                    {selectedDocument.creatorUserId === me?.userId && selectedDocument.status === "draft" && canAct.create ? <button type="button" onClick={() => void openApprovalEditor("edit", selectedDocument)}>수정</button> : null}
                    {selectedDocument.creatorUserId === me?.userId && selectedDocument.status === "draft" && canAct.submit ? <button type="button" onClick={() => openActionModal("submit")}>상신</button> : null}
                    {selectedDocument.creatorUserId === me?.userId && selectedDocument.status === "submitted" && canAct.withdraw ? <button type="button" onClick={() => openActionModal("withdraw")}>회수</button> : null}
                    {selectedDocument.creatorUserId === me?.userId && (selectedDocument.status === "rejected" || selectedDocument.status === "withdrawn") && canAct.rework ? <button type="button" onClick={() => openActionModal("redraft")}>재기안</button> : null}
                    {isCurrentApprovalActor(selectedDocument) && canAct.act ? <button type="button" onClick={() => openActionModal("approve")}>승인</button> : null}
                    {isCurrentApprovalActor(selectedDocument) && canAct.act ? <button type="button" onClick={() => openActionModal("reject")}>반려</button> : null}
                    {approvalShellMenu !== "trash" && selectedDocument.creatorUserId === me?.userId && (selectedDocument.status === "draft" || selectedDocument.status === "approved") ? <button type="button" onClick={() => void handleApprovalTrashAction("delete")}>삭제</button> : null}
                    {approvalShellMenu === "trash" ? <button type="button" onClick={() => void handleApprovalTrashAction("restore")}>복원</button> : null}
                    {approvalShellMenu === "trash" ? <button className="is-destructive" type="button" onClick={() => void handleApprovalTrashAction("permanent")}>영구 삭제</button> : null}
                  </div>
                </> : !approvalDetailLoading && !approvalDetailError ? <div className="ui032-empty">목록에서 결재 문서를 선택하세요.</div> : null}
              </section>}
              />
            </div>
            ) : approvalShellMenu === "settings" ? (
              <section className="ui035-settings" aria-label="결재 기본 설정">
                <nav role="tablist" aria-label="결재 환경설정 탭">
                  <button type="button" role="tab" aria-selected={approvalSettingsTab === "basic"} onClick={() => selectApprovalSettingsTab("basic")}>기본 설정</button>
                  <button type="button" role="tab" aria-selected={approvalSettingsTab === "delegation"} onClick={() => selectApprovalSettingsTab("delegation")}>부재/위임 설정</button>
                </nav>
                {approvalSettingsTab === "basic" ? <>
                  {approvalPreferencesLoading ? <div className="ui035-settings__state" role="status">기본 설정을 불러오는 중입니다.</div> : null}
                  {approvalPreferencesError ? <div className="ui035-settings__state is-error" role="alert">{approvalPreferencesError}<button type="button" onClick={() => token && void loadApprovalPreferences(token)}>서버 값을 다시 조회</button></div> : null}
                  {!approvalPreferencesLoading ? <div className="ui035-settings__body">
                  <fieldset>
                    <legend>서명/도장 <i tabIndex={0} data-tooltip="서명은 승인 시점의 결재선에 보존됩니다." aria-label="서명 보존 안내">i</i></legend>
                    <div className="ui035-signature-row">
                      <div className="ui035-signature-preview">
                        {approvalSignaturePreviewUrl ? <img src={approvalSignaturePreviewUrl} alt="서명 미리보기" style={{ maxWidth: 55, maxHeight: 40 }} /> : <span>등록된 서명 없음</span>}
                      </div>
                      <div><strong>{approvalPreferencesDraft.signatureName || "서명을 등록하지 않았습니다."}</strong><small>{approvalSignatureFile ? formatFileSize(approvalSignatureFile.size) : approvalPreferences?.signatureSizeBytes ? formatFileSize(approvalPreferences.signatureSizeBytes) : "PNG/JPEG/WEBP · 최대 512KB"}</small></div>
                      <label className="ui035-file-button"><span>{approvalPreferencesDraft.signatureName ? "교체" : "선택"}</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={selectApprovalSignature} /></label>
                      <button type="button" disabled={!approvalPreferencesDraft.signatureName} onClick={removeApprovalSignature}>제거</button>
                    </div>
                  </fieldset>
                  <fieldset>
                    <legend>결재 작성 방식 <i tabIndex={0} data-tooltip="현재 확인된 작성 방식만 제공합니다." aria-label="작성 방식 안내">i</i></legend>
                    {APPROVAL_WRITING_METHODS.map((item) => <label key={item.value}><input type="radio" name="approval-writing-method" value={item.value} checked={approvalPreferencesDraft.writingMethod === item.value} onChange={() => setApprovalPreferencesDraft((current) => ({ ...current, writingMethod: item.value }))} />{item.label}</label>)}
                  </fieldset>
                  <fieldset>
                    <legend>첨부 이미지 표시 <i tabIndex={0} data-tooltip="이미지 첨부의 상세 화면 표시 크기를 선택합니다." aria-label="첨부 표시 안내">i</i></legend>
                    {APPROVAL_ATTACHMENT_IMAGE_DISPLAYS.map((item) => <label key={item.value}><input type="radio" name="approval-attachment-display" value={item.value} checked={approvalPreferencesDraft.attachmentImageDisplay === item.value} onChange={() => setApprovalPreferencesDraft((current) => ({ ...current, attachmentImageDisplay: item.value }))} />{item.label}</label>)}
                  </fieldset>
                  </div> : null}
                  <footer className="ui035-settings__actions"><span>{approvalPreferencesDirty ? "저장하지 않은 변경사항이 있습니다." : "서버 설정과 일치합니다."}</span><button type="button" disabled={!approvalPreferencesDirty || approvalPreferencesSaving} onClick={cancelApprovalPreferences}>취소</button><button type="button" disabled={!approvalPreferencesDirty || approvalPreferencesSaving || !canAct.create} onClick={() => void saveApprovalPreferences()}>{approvalPreferencesSaving ? "저장 중" : "저장"}</button></footer>
                </> : <section className="ui036-delegations" aria-label="부재 및 위임 목록">
                  <div className="ui036-delegations__toolbar">
                    <button type="button" disabled={!canAct.create} onClick={openApprovalDelegationCreate}>부재 추가</button>
                    <button type="button" disabled={!selectedApprovalDelegationId || !canAct.create} onClick={() => openApprovalDelegationEdit()}>수정</button>
                    <button type="button" disabled={!selectedApprovalDelegationId || !canAct.create} onClick={() => setApprovalDelegationDeleteTarget(approvalDelegations.find((item) => item.delegationId === selectedApprovalDelegationId) ?? null)}>삭제</button>
                    <i tabIndex={0} data-tooltip="활성 위임 기간에는 대결자가 현재 결재선을 처리할 수 있습니다." aria-label="위임 처리 안내">i</i>
                    <span>페이지 크기 20 · 총 {approvalDelegationsTotal}건</span>
                  </div>
                  {approvalDelegationsLoading ? <div className="ui035-settings__state" role="status">부재/위임 설정을 불러오는 중입니다.</div> : null}
                  {approvalDelegationsError ? <div className="ui035-settings__state is-error" role="alert">{approvalDelegationsError}<button type="button" onClick={() => token && void loadApprovalDelegations(token, approvalDelegationsPage)}>다시 조회</button></div> : null}
                  {!approvalDelegationsLoading && !approvalDelegationsError ? <div className="ui036-delegations__table-wrap">
                    <table><caption>내 부재 및 위임 설정</caption><thead><tr><th>선택</th><th>부재 시작</th><th>부재 종료</th><th>대결자</th><th>부재 사유</th><th>사용 여부</th><th>상태</th></tr></thead>
                    <tbody>{approvalDelegations.map((item) => <tr key={item.delegationId} className={selectedApprovalDelegationId === item.delegationId ? "is-selected" : ""} onDoubleClick={() => openApprovalDelegationEdit(item)}>
                      <td><input type="radio" name="approval-delegation-selection" aria-label={`${item.delegateUserName} 위임 선택`} checked={selectedApprovalDelegationId === item.delegationId} onChange={() => setSelectedApprovalDelegationId(item.delegationId)} /></td>
                      <td>{item.startDate}</td><td>{item.endDate}</td><td><strong>{item.delegateUserName}</strong><small>{item.departmentName} · {item.delegateUserEmail}</small></td><td>{item.reason}</td><td>{item.enabled ? "사용" : "사용 안 함"}</td><td><span className={`ui036-status is-${item.status}`}>{APPROVAL_DELEGATION_STATUS_LABELS[item.status]}</span></td>
                    </tr>)}</tbody></table>
                    {!approvalDelegations.length ? <div className="ui036-delegations__empty"><p>저장된 부재 목록이 없습니다.</p><button type="button" disabled={!canAct.create} onClick={openApprovalDelegationCreate}>부재 추가</button></div> : null}
                  </div> : null}
                  <footer className="ui036-delegations__paging"><button type="button" disabled={approvalDelegationsPage <= 1} onClick={() => token && void loadApprovalDelegations(token, approvalDelegationsPage - 1)}>이전</button><span>{approvalDelegationsPage} / {Math.max(1, Math.ceil(approvalDelegationsTotal / 20))}</span><button type="button" disabled={approvalDelegationsPage * 20 >= approvalDelegationsTotal} onClick={() => token && void loadApprovalDelegations(token, approvalDelegationsPage + 1)}>다음</button></footer>
                </section>}
              </section>
            ) : (
              <section className="ui031-ready" role="status" aria-live="polite">
                <span aria-hidden="true">i</span>
                <h3>{activeApprovalMenu.label} 준비 중</h3>
                <p>{activeApprovalMenu.readyMessage}</p>
                <small>현재 사용할 수 있는 메뉴: 결재 대기 · 수신 · 예정 · 개인 문서함</small>
              </section>
            )}
            </main>
            <CommonPopup title="결재선" open={approvalLineModalOpen} onClose={() => setApprovalLineModalOpen(false)} className="ui032-approval-line-modal">
              <section className="ui032-timeline">{selectedDocument?.lines.length ? selectedDocument.lines.map((line) => <article key={line.id}><i>{line.sequence}</i><div><strong>{line.approverUserName}{line.delegationId && line.decidedByUserName ? ` · 대결 ${line.decidedByUserName}` : ""}</strong><span>{approvalLineStatusLabel(line.status)} · {line.decidedAt ? formatDateLabel(line.decidedAt) : "결정 대기"}</span><p className="ui032-line-opinion"><b>{line.decidedByUserName ?? line.approverUserName} 의견</b>{line.comment?.trim() || "처리 의견 없음"}</p></div>{line.hasSignature && line.signatureUrl && approvalLineSignatureUrls[line.id] ? <img className="ui035-line-signature" src={approvalLineSignatureUrls[line.id]} alt={`${line.approverUserName} 승인 서명`} /> : null}</article>) : <div className="ui032-empty">등록된 결재선이 없습니다.</div>}</section>
            </CommonPopup>
            <CommonPopup title="처리 이력" open={approvalHistoryModalOpen} onClose={() => setApprovalHistoryModalOpen(false)} className="ui032-history-modal">
              <section className="ui032-history">{approvalLogsLoading ? <div className="ui032-state" role="status">처리 이력을 불러오는 중입니다.</div> : approvalLogsError ? <div className="ui032-state is-error" role="alert">{approvalLogsError}<button type="button" onClick={retryApprovalLogs}>이력 다시 시도</button></div> : approvalLogs.length ? approvalLogs.map((log) => <article key={log.id}><strong>{log.event}</strong><span>{log.actorUserName} · {log.statusBefore ?? "-"} → {log.statusAfter ?? "-"} · {formatDateLabel(log.createdAt)}</span></article>) : <div className="ui032-empty">처리 이력이 없습니다.</div>}</section>
            </CommonPopup>
            <CommonPopup
              title={approvalModal === "edit" ? "결재 초안 수정" : "새 결재 작성"}
              open={approvalModal === "create" || approvalModal === "edit"}
              onClose={closeApprovalModal}
              dirty={approvalComposeDirty}
              saving={loading}
              error={approvalError}
              className="ui033-compose-popup"
              maximizable
              closeRequestRef={approvalComposeCloseRequestRef}
            >
              <form className="ui033-compose" onSubmit={handleCreate}>
                <div className="ui033-compose__tabs" role="tablist" aria-label="결재 작성 단계">
                  <button type="button" role="tab" aria-selected={approvalComposeTab === "document"} onClick={() => setApprovalComposeTab("document")}>문서</button>
                  <button type="button" role="tab" aria-selected={approvalComposeTab === "line"} onClick={() => setApprovalComposeTab("line")}>결재선 <span>{createForm.approverUserIds.length}</span></button>
                </div>
                {approvalComposeTab === "document" ? (
                  <section className="ui033-compose__panel" role="tabpanel" aria-label="문서 입력">
                    <div className="ui033-compose__options"><label><input type="checkbox" checked={createForm.urgent} onChange={(event) => setCreateForm((current) => ({ ...current, urgent: event.target.checked }))} /> 긴급 결재</label><label><input type="checkbox" checked={createForm.shareWithDepartment} onChange={(event) => setCreateForm((current) => ({ ...current, shareWithDepartment: event.target.checked }))} /> 완료 후 부서 공유</label></div>
                    <label>제목<input aria-label="결재 제목" required maxLength={200} value={createForm.title} onChange={(event) => setCreateForm((current) => ({ ...current, title: event.target.value }))} placeholder="결재 제목을 입력하세요." /></label>
                    <label className="ui033-compose__content">본문<textarea aria-label="결재 본문" required maxLength={20000} value={createForm.content} onChange={(event) => setCreateForm((current) => ({ ...current, content: event.target.value }))} placeholder="결재 내용을 입력하세요." /></label>
                    <section className="ui033-compose__attachments">
                      <header><div><strong>첨부</strong><span>최대 10개 · 파일당 10MB · 합계 25MB</span></div><label className="ui033-file-button">파일 선택<input type="file" accept="*/*" multiple onChange={addApprovalFiles} /></label></header>
                      <div className="ui033-file-summary">총 {approvalRetainedAttachments.length + approvalPendingFiles.length}개 · {formatFileSize(approvalRetainedAttachments.reduce((sum, item) => sum + item.sizeBytes, 0) + approvalPendingFiles.reduce((sum, item) => sum + item.file.size, 0))}</div>
                      <div className="ui033-file-list">
                        {approvalRetainedAttachments.map((attachment) => <article key={attachment.attachmentId}><div><strong>{attachment.fileName}</strong><span>기존 첨부 · {formatFileSize(attachment.sizeBytes)}</span></div><button type="button" onClick={() => setApprovalRetainedAttachments((current) => current.filter((item) => item.attachmentId !== attachment.attachmentId))}>제거</button></article>)}
                        {approvalPendingFiles.map((item) => <article key={item.id}><div><strong>{item.file.name}</strong><span>새 첨부 · {formatFileSize(item.file.size)}</span></div><button type="button" onClick={() => setApprovalPendingFiles((current) => current.filter((file) => file.id !== item.id))}>제거</button></article>)}
                        {!approvalRetainedAttachments.length && !approvalPendingFiles.length ? <p>첨부 파일이 없습니다.</p> : null}
                      </div>
                    </section>
                  </section>
                ) : (
                  <section className="ui033-compose__panel ui033-compose__line" role="tabpanel" aria-label="결재선 설정">
                    <div className="ui033-approver-search"><label>사용자 검색<input aria-label="결재선 사용자 검색" value={approverSearch} onChange={(event) => setApproverSearch(event.target.value)} placeholder="이름, 부서, 이메일 검색" /></label><div>{availableApprovers.map((user) => <article key={user.userId}><div><strong>{user.userName}</strong><span>{user.departmentName} · {user.userEmail}</span></div><button type="button" onClick={() => selectApprovalApprover(user.userId)}>결재</button><button type="button" onClick={() => setCreateForm((current) => ({ ...current, referenceUserIds: [...current.referenceUserIds, user.userId] }))}>참조</button><button type="button" onClick={() => setCreateForm((current) => ({ ...current, viewerUserIds: [...current.viewerUserIds, user.userId] }))}>열람</button></article>)}</div></div>
                    <div className="ui033-approver-selected" aria-label="선택된 결재선"><header><strong>선택된 결재선</strong><span>{selectedApprovers.length}명</span></header>{selectedApprovers.map((user, index) => <article className="ui033-selected-approver" key={user.userId}><i>{index + 1}</i><div><strong>{user.userName}</strong><span>{user.departmentName} · {user.userEmail}</span></div><button type="button" disabled={index === 0} onClick={() => moveApprovalApprover(user.userId, -1)}>위</button><button type="button" disabled={index === selectedApprovers.length - 1} onClick={() => moveApprovalApprover(user.userId, 1)}>아래</button><button type="button" onClick={() => setCreateForm((current) => ({ ...current, approverUserIds: current.approverUserIds.filter((id) => id !== user.userId) }))}>제거</button></article>)}{!selectedApprovers.length ? <p>임시저장은 결재선 없이 가능하며, 상신 전에 1명 이상 지정해야 합니다.</p> : null}</div>
                    <div className="ui033-audience-selected"><section><header><strong>참조자</strong><span>{selectedReferences.length}명</span></header>{selectedReferences.map((user) => <article key={user.userId}><div><strong>{user.userName}</strong><span>{user.departmentName}</span></div><button type="button" onClick={() => setCreateForm((current) => ({ ...current, referenceUserIds: current.referenceUserIds.filter((id) => id !== user.userId) }))}>제거</button></article>)}</section><section><header><strong>열람자</strong><span>{selectedViewers.length}명</span></header>{selectedViewers.map((user) => <article key={user.userId}><div><strong>{user.userName}</strong><span>{user.departmentName}</span></div><button type="button" onClick={() => setCreateForm((current) => ({ ...current, viewerUserIds: current.viewerUserIds.filter((id) => id !== user.userId) }))}>제거</button></article>)}</section></div>
                  </section>
                )}
                <footer className="ui033-compose__footer"><button type="button" onClick={() => approvalComposeCloseRequestRef.current?.()}>취소</button><button type="submit" disabled={loading}>{approvalModal === "edit" ? "수정 저장" : "임시저장"}</button></footer>
              </form>
            </CommonPopup>
            <CommonPopup
              title={approvalDelegationPopupMode === "edit" ? "부재/위임 수정" : "부재 추가"}
              open={approvalDelegationPopupMode !== "none"}
              onClose={() => setApprovalDelegationPopupMode("none")}
              dirty={approvalDelegationDirty}
              saving={approvalDelegationSaving}
              error={approvalDelegationError}
              className="ui036-delegation-popup"
              closeRequestRef={approvalDelegationCloseRequestRef}
            >
              <form className="ui036-delegation-form" onSubmit={saveApprovalDelegation}>
                <div className="ui036-delegation-period"><label>시작일<input type="date" required value={approvalDelegationDraft.startDate} onChange={(event) => setApprovalDelegationDraft((current) => ({ ...current, startDate: event.target.value }))} /></label><label>종료일<input type="date" required value={approvalDelegationDraft.endDate} onChange={(event) => setApprovalDelegationDraft((current) => ({ ...current, endDate: event.target.value }))} /></label></div>
                <section className="ui036-delegation-candidates"><label>대결자 검색<input value={approvalDelegationSearch} onChange={(event) => setApprovalDelegationSearch(event.target.value)} placeholder="이름, 부서, 이메일 검색" disabled={approvalDelegationCandidatesLoading} /></label>{approvalDelegationCandidatesLoading ? <div className="ui035-settings__state" role="status">대결자 후보를 조회하고 있습니다.</div> : null}{approvalDelegationCandidatesError ? <div className="ui035-settings__state is-error" role="alert"><span>{approvalDelegationCandidatesError}</span><button type="button" onClick={() => token && void loadApprovalDelegationCandidates(token, true)}>대결자 다시 조회</button></div> : null}{!approvalDelegationCandidatesLoading && !approvalDelegationCandidatesError ? <div role="listbox" aria-label="대결자 검색 결과">{approvalDelegationCandidates.map((user) => <button type="button" role="option" aria-selected={approvalDelegationDraft.delegateUserId === user.userId} key={user.userId} onClick={() => setApprovalDelegationDraft((current) => ({ ...current, delegateUserId: user.userId }))}><strong>{user.userName}</strong><span>{user.departmentName} · {user.userEmail}</span></button>)}{!approvalDelegationCandidates.length ? <p>선택 가능한 활성 사용자가 없습니다.</p> : null}</div> : null}</section>
                <label>부재 사유<textarea required maxLength={500} value={approvalDelegationDraft.reason} onChange={(event) => setApprovalDelegationDraft((current) => ({ ...current, reason: event.target.value }))} placeholder="부재 사유를 입력하세요." /><small>{approvalDelegationDraft.reason.length}/500</small></label>
                <label className="ui036-delegation-enabled">사용 여부<input type="checkbox" role="switch" checked={approvalDelegationDraft.enabled} onChange={(event) => setApprovalDelegationDraft((current) => ({ ...current, enabled: event.target.checked }))} /></label>
                <footer><button type="button" onClick={() => approvalDelegationCloseRequestRef.current?.()}>취소</button><button type="submit" disabled={approvalDelegationSaving}>{approvalDelegationSaving ? "저장 중" : "저장"}</button></footer>
              </form>
            </CommonPopup>
            <CommonPopup title="부재/위임 삭제" open={Boolean(approvalDelegationDeleteTarget)} onClose={() => setApprovalDelegationDeleteTarget(null)} saving={approvalDelegationSaving} kind="alertdialog">
              <div className="ui036-delegation-delete"><strong>삭제할 위임</strong><p>{approvalDelegationDeleteTarget ? `${approvalDelegationDeleteTarget.delegateUserName} · ${approvalDelegationDeleteTarget.startDate} ~ ${approvalDelegationDeleteTarget.endDate}` : ""}</p><span>삭제 후 목록에서 사라지며 기존 처리 이력은 보존됩니다.</span><div><button type="button" onClick={() => setApprovalDelegationDeleteTarget(null)}>취소</button><button type="button" className="is-destructive" onClick={() => void confirmDeleteApprovalDelegation()}>삭제</button></div></div>
            </CommonPopup>
            <CommonPopup title="변경사항 확인" open={Boolean(approvalPendingMenu || approvalPendingPortalMenu)} onClose={() => { setApprovalPendingMenu(null); setApprovalPendingPortalMenu(null); }} dirty={approvalPreferencesDirty}>
              <div className="ui035-discard-confirm"><p>저장하지 않은 결재 기본 설정이 있습니다. 변경사항을 버리고 이동할까요?</p><button type="button" onClick={() => { setApprovalPendingMenu(null); setApprovalPendingPortalMenu(null); }}>계속 작성</button><button type="button" onClick={discardApprovalPreferencesAndNavigate}>변경 버리고 이동</button></div>
            </CommonPopup>
            {renderApprovalActionPopup()}
          </section>
        );
      }

      if (activePortalMenu === "messenger") {
        return (
          <section style={{ display: "grid", gridTemplateColumns: "280px minmax(420px, 1fr) 280px", gap: 18, minHeight: 0 }}>
            <aside style={{ display: "grid", gap: 12, alignContent: "start", overflowY: "auto" }}>
              {messengerRoomsData.map((room) => (
                <button
                  key={room.roomId}
                  type="button"
                  onClick={() => void selectMessengerRoom(token, room.roomId, { markRead: true })}
                  style={{
                    borderRadius: 20,
                    padding: 16,
                    border: selectedRoomId === room.roomId ? `1px solid ${uiContract.brand.primary}` : "1px solid #dbe4ec",
                    background: "#fff",
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  <strong>{room.roomName}</strong>
                  <p style={{ margin: "8px 0 0", color: "#475569" }}>{room.lastMessage || "최근 메시지가 없습니다."}</p>
                  <div style={{ marginTop: 8, color: room.unreadCount > 0 ? "#b91c1c" : "#64748b", fontSize: 13, fontWeight: 700 }}>
                    미읽음 {room.unreadCount} · {formatDateLabel(room.lastMessageAt || room.updatedAt)}
                  </div>
                </button>
              ))}
              {messengerRoomsData.length === 0 ? (
                <article style={{ borderRadius: 20, padding: 18, border: "1px dashed #cbd5e1", color: "#64748b", background: "#fff" }}>
                  {messengerLoading ? "대화방을 불러오는 중입니다." : uiContract.messages.empty}
                </article>
              ) : null}
            </aside>
            <article style={{ borderRadius: 24, padding: 22, border: "1px solid #dbe4ec", background: "#fff", overflowY: "auto" }}>
              <div style={{ fontSize: 12, color: uiContract.brand.primary, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>대화 타임라인</div>
              <h2 style={{ margin: "10px 0 0", fontSize: 28 }}>{selectedRoomDetail?.roomName || "대화방을 선택하세요"}</h2>
              {messengerTimeline.map((item) => (
                <div key={`${item.sender}-${item.time}`} style={{ marginTop: 12, padding: 16, borderRadius: 18, background: "#f8fafc", border: "1px solid #dbe4ec" }}>
                  <strong>{item.sender}</strong>
                  <span style={{ marginLeft: 10, color: "#64748b", fontSize: 13 }}>{item.time}</span>
                  <p style={{ color: "#334155", lineHeight: 1.6 }}>{item.body}</p>
                  <div style={{ color: "#0f766e", fontSize: 13, fontWeight: 700 }}>{item.meta}</div>
                </div>
              ))}
              {messengerTimeline.length === 0 ? <p style={{ color: "#64748b" }}>{uiContract.messages.empty}</p> : null}
              <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
                <textarea
                  value={messengerDraft}
                  onChange={(event) => setMessengerDraft(event.target.value)}
                  placeholder="메시지를 입력하세요."
                  style={{ minHeight: 88, borderRadius: 16, border: "1px solid #cbd5e1", padding: 14 }}
                />
                <div style={{ display: "flex", gap: 10 }}>
                  <button
                    type="button"
                    onClick={() => void handleMessengerSend()}
                    disabled={messengerLoading || !selectedRoomId || !messengerDraft.trim()}
                    style={{ height: 44, borderRadius: 14, border: 0, background: uiContract.brand.primary, color: "#fff", padding: "0 16px", fontWeight: 800, cursor: "pointer" }}
                  >
                    메시지 전송
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedRoomId) {
                        void selectMessengerRoom(token, selectedRoomId, { markRead: true });
                      }
                    }}
                    disabled={!selectedRoomId}
                    style={{ height: 44, borderRadius: 14, border: "1px solid #cbd5e1", background: "#fff", padding: "0 16px", fontWeight: 700, cursor: "pointer" }}
                  >
                    읽음 처리
                  </button>
                </div>
              </div>
              {messengerError ? <p style={{ color: "#b91c1c", marginTop: 14 }}>{messengerError}</p> : null}
            </article>
            <aside style={{ display: "grid", gap: 12, alignContent: "start", overflowY: "auto" }}>
              {selectedRoomDetail ? (
                <article style={{ borderRadius: 20, padding: 16, border: "1px solid #dbe4ec", background: "#fff" }}>
                  <strong>대화방 관리</strong>
                  <p style={{ color: "#475569", lineHeight: 1.6, fontSize: 12 }}>
                    나가면 참여가 종료됩니다. 삭제된 대화와 첨부는 14일 후 자동 정리됩니다.
                  </p>
                  {selectedRoomDetail.canDelete ? (
                    <button
                      type="button"
                      onClick={() => {
                        const nextOwner = selectedRoomDetail.participants.find((item) => item.userId !== selectedRoomDetail.createdByUserId);
                        setMessengerNewOwnerId(nextOwner?.userId || "");
                        setMessengerLifecycleAction("transfer");
                      }}
                      disabled={messengerLoading || selectedRoomDetail.participants.length < 2}
                      style={{ width: "100%", minHeight: 38, borderRadius: 12, border: "1px solid #cbd5e1", background: "#fff", fontSize: 12, fontWeight: 700 }}
                    >
                      방장 이전
                    </button>
                  ) : null}
                  {selectedRoomDetail.canLeave ? (
                    <button type="button" onClick={() => setMessengerLifecycleAction("leave")} disabled={messengerLoading} style={{ width: "100%", minHeight: 38, marginTop: 8, borderRadius: 12, border: "1px solid #cbd5e1", background: "#fff", fontSize: 12, fontWeight: 700 }}>
                      대화방 나가기
                    </button>
                  ) : null}
                  {selectedRoomDetail.canDelete ? (
                    <button type="button" onClick={() => setMessengerLifecycleAction("delete")} disabled={messengerLoading} style={{ width: "100%", minHeight: 38, marginTop: 8, borderRadius: 12, border: "1px solid #fecaca", background: "#fff7f7", color: "#b91c1c", fontSize: 12, fontWeight: 700 }}>
                      대화방 삭제
                    </button>
                  ) : null}
                </article>
              ) : null}
              {collaborationPanels.map((item) => (
                <article key={item.title} style={{ borderRadius: 20, padding: 16, border: "1px solid #dbe4ec", background: "#fff" }}>
                  <strong>{item.title}</strong>
                  <p style={{ color: "#475569", lineHeight: 1.6 }}>{item.body}</p>
                </article>
              ))}
            </aside>
            <CommonPopup
              title={messengerLifecycleAction === "transfer" ? "방장 이전" : messengerLifecycleAction === "leave" ? "대화방 나가기" : "대화방 삭제"}
              open={messengerLifecycleAction !== "none"}
              onClose={() => { setMessengerLifecycleAction("none"); setMessengerNewOwnerId(""); }}
              saving={messengerLoading}
              error={messengerError}
              kind="alertdialog"
            >
              <div style={{ display: "grid", gap: 12, fontSize: 12 }}>
                {messengerLifecycleAction === "transfer" ? (
                  <label style={{ display: "grid", gap: 6 }}>
                    <span>새 방장</span>
                    <select value={messengerNewOwnerId} onChange={(event) => setMessengerNewOwnerId(event.target.value)}>
                      {selectedRoomDetail?.participants.filter((item) => item.userId !== selectedRoomDetail.createdByUserId).map((item) => (
                        <option key={item.userId} value={item.userId}>{item.userName} · {item.userEmail}</option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <p style={{ margin: 0, lineHeight: 1.7 }}>
                    {messengerLifecycleAction === "leave"
                      ? "이 대화방에서 나갑니다. 기존 대화 기록은 보존 정책에 따라 유지됩니다."
                      : "대화방을 삭제합니다. 대화와 첨부는 14일간 보존된 후 자동 정리됩니다."}
                  </p>
                )}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <button type="button" onClick={() => setMessengerLifecycleAction("none")}>취소</button>
                  <button
                    type="button"
                    disabled={messengerLoading || (messengerLifecycleAction === "transfer" && !messengerNewOwnerId)}
                    onClick={() => {
                      if (messengerLifecycleAction === "transfer") void handleMessengerOwnerTransfer();
                      if (messengerLifecycleAction === "leave") void handleMessengerLeave();
                      if (messengerLifecycleAction === "delete") void handleMessengerDelete();
                    }}
                  >
                    {messengerLifecycleAction === "transfer" ? "이전" : messengerLifecycleAction === "leave" ? "나가기" : "삭제"}
                  </button>
                </div>
              </div>
            </CommonPopup>
          </section>
        );
      }

      if (activePortalMenu === "alerts") {
        return (
          <NotificationCenter
            token={token}
            onChanged={() => refreshNotifications(token)}
            onNavigate={(menu, item) => { void openNotificationTarget(menu, item); }}
          />
        );
      }

      if (activePortalMenu === "settings") {
        return (
          <section style={{ display: "grid", gridTemplateColumns: "minmax(360px, 0.9fr) minmax(420px, 1.1fr)", gap: 18, minHeight: 0 }}>
            <article style={{ borderRadius: 24, padding: 22, border: "1px solid #dbe4ec", background: "#fff", overflowY: "auto" }}>
              <div style={{ fontSize: 12, color: uiContract.brand.primary, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>사용자 설정</div>
              <h2 style={{ marginTop: 10 }}>언어 / 시간대 / 연결 정보</h2>
              <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ color: "#475569", fontWeight: 700 }}>언어</span>
                  <select value={locale} onChange={(event) => saveLocale(resolveLocale(event.target.value))}>
                    {supportedLocales.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ color: "#475569", fontWeight: 700 }}>시간대</span>
                  <select value={timezone} onChange={(event) => saveTimezone(event.target.value)}>
                    {supportedTimezones.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
                <div style={{ borderRadius: 16, background: "#f8fafc", border: "1px solid #dbe4ec", padding: 14 }}>
                  <div style={{ color: "#475569", fontWeight: 700 }}>API Base</div>
                  <div style={{ marginTop: 8, color: "#334155", wordBreak: "break-all" }}>{apiBase}</div>
                </div>
              </div>
            </article>
            <article style={{ borderRadius: 24, padding: 22, border: "1px solid #dbe4ec", background: "#fff", overflowY: "auto" }}>
              <div style={{ fontSize: 12, color: uiContract.brand.primary, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>설정 반영</div>
              <h2 style={{ marginTop: 10 }}>화면 계약 반영 상태</h2>
              <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
                {settingsContractCards.map((item) => (
                  <div key={item.title} style={{ padding: 14, borderRadius: 16, background: "#f8fafc", border: "1px solid #dbe4ec" }}>
                    <strong>{item.title}</strong>
                    <p style={{ marginBottom: 0, color: "#475569", lineHeight: 1.6 }}>{item.body}</p>
                  </div>
                ))}
              </div>
            </article>
            {translationTool}
          </section>
        );
      }

      if (activePortalMenu === "help") {
        return (
          <section style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 18, minHeight: 0 }}>
            <article style={{ borderRadius: 24, padding: 22, border: "1px solid #dbe4ec", background: "#fff", overflowY: "auto" }}>
              <h2 style={{ marginTop: 0 }}>Help / 정책 안내</h2>
              <p style={{ color: "#475569", lineHeight: 1.7 }}>정책 본문은 업무 홈에 직접 노출하지 않고 {uiContract.helpText} 경로에서 확인합니다.</p>
              <p style={{ color: "#475569", lineHeight: 1.7 }}>메일: {MAIL_POLICY.serverRetention} / {MAIL_POLICY.localRetention}</p>
              <p style={{ color: "#475569", lineHeight: 1.7 }}>메신저: {MESSENGER_POLICY.serverRetention} / {MESSENGER_POLICY.localRetention}</p>
            </article>
            <article style={{ borderRadius: 24, padding: 22, border: "1px solid #dbe4ec", background: "#fff", overflowY: "auto" }}>
              <h2 style={{ marginTop: 0 }}>정책 경로</h2>
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ padding: 14, borderRadius: 16, background: "#f8fafc", border: "1px solid #dbe4ec", color: "#475569", lineHeight: 1.6 }}>메일 보관 정책은 Help 및 설정 경로에서 확인합니다.</div>
                <div style={{ padding: 14, borderRadius: 16, background: "#f8fafc", border: "1px solid #dbe4ec", color: "#475569", lineHeight: 1.6 }}>로그인 후 업무 화면에는 정책 본문을 길게 노출하지 않습니다.</div>
              </div>
            </article>
          </section>
        );
      }

      return <UserHome
        userName={me.userName}
        loading={homeLoading}
        error={homeError || mailError || approvalError || messengerError}
        mails={inboxMails}
        approvals={documents}
        schedules={homeSchedules}
        rooms={messengerRoomsData}
        notices={homeNotices}
        onOpenList={(target) => setPortalMenu(target)}
        onOpenItem={(target, itemId) => void openHomeItem(target, itemId)}
      />;
    };

    const quickComposeTargets = [
      {
        mode: "mail" as QuickComposeMode,
        label: "메일 작성",
        description: "메일 작성 화면으로 이동해 새 메일 작성 시작.",
      },
      {
        mode: "approval" as QuickComposeMode,
        label: "결재 작성",
        description: "결재 문서 초안 작성 화면으로 이동.",
      },
      {
        mode: "messenger" as QuickComposeMode,
        label: "메신저 작성",
        description: "대화방 선택 및 메시지 작성을 위한 메신저 화면으로 이동.",
      },
    ];

    const quickComposePicker = showQuickComposePicker ? (
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 40,
          display: "grid",
          placeItems: "center",
          background: "rgba(15, 23, 42, 0.45)",
          padding: 20,
        }}
      >
        <div
          style={{
            width: "min(540px, 94vw)",
            borderRadius: 22,
            border: "1px solid #dbe4ec",
            background: "#ffffff",
            padding: 22,
            boxShadow: "0 24px 56px rgba(15, 23, 42, 0.2)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: "#0f766e", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>빠른 작성 대상</div>
              <h2 style={{ margin: "8px 0 0", fontSize: 26, lineHeight: 1.2 }}>작업 시작 대상을 선택하세요</h2>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowQuickComposePicker(false);
                setQuickComposeMode("none");
              }}
              style={{ width: 38, height: 38, borderRadius: 10, border: "1px solid #d7e0e8", background: "#fff", fontWeight: 800 }}
            >
              닫기
            </button>
          </div>
          <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
            {quickComposeTargets.map((item) => (
              <button
                key={item.mode}
                type="button"
                onClick={() => void openQuickComposeByMode(item.mode)}
                style={{ borderRadius: 16, padding: 14, border: "1px solid #dbe4ec", background: "#f8fafc", textAlign: "left" }}
              >
                <div style={{ fontWeight: 800 }}>{item.label}</div>
                <div style={{ marginTop: 6, color: "#475569" }}>{item.description}</div>
              </button>
            ))}
          </div>
          <p style={{ margin: "14px 0 0", color: "#64748b", fontSize: 13 }}>
            현재 메뉴: {activePortalMenu}
          </p>
        </div>
      </div>
    ) : null;

    return (
      <main
        className="user-shell"
        style={{
          height: "100vh",
          overflow: "hidden",
          background: "radial-gradient(circle at top left, rgba(15,118,110,0.12), transparent 28%), linear-gradient(180deg, #f7f5ef 0%, #eef4f3 100%)",
          color: "#0f172a",
          fontFamily: `"Pretendard Variable", "SUIT", "Noto Sans KR", "Segoe UI", sans-serif`,
        }}
      >
        <div className="user-shell-layout" style={{ display: "grid", gridTemplateColumns: "260px minmax(0, 1fr)", gap: 20, height: "100%", padding: 24, overflow: "hidden" }}>
          <aside className="user-app-rail" style={{ borderRadius: 30, padding: 22, background: "linear-gradient(180deg, #102a43 0%, #0f172a 100%)", color: "#e2e8f0", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 56, height: 56, borderRadius: 18, overflow: "hidden", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
                <img src={uiContract.company.logoDataUrl} alt={`${uiContract.company.name} 로고`} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              </div>
              <div>
                <div style={{ fontSize: 13, color: "#7dd3fc", letterSpacing: "0.08em", textTransform: "uppercase" }}>{uiContract.company.name} Portal</div>
                <h1 style={{ margin: "10px 0 6px", fontSize: 30, lineHeight: 1.08, letterSpacing: "-0.04em" }}>사용자 업무 홈</h1>
                <p style={{ margin: 0, color: "rgba(226,232,240,0.72)", lineHeight: 1.65 }}>{uiContract.company.domain}</p>
              </div>
            </div>
            <p style={{ margin: "14px 0 0", color: "rgba(226,232,240,0.72)", lineHeight: 1.65 }}>업무 처리 중심의 그룹웨어 홈입니다.</p>
            <nav className="user-app-rail-menu" aria-label="업무 메뉴" style={{ display: "grid", gap: 8, marginTop: 24 }}>
              {portalMenus.map((item) => (
                <button className="user-app-rail-item" key={item.key} type="button" aria-current={activePortalMenu === item.key ? "page" : undefined} onClick={() => setPortalMenu(item.key)} style={{ borderRadius: 16, padding: "12px 14px", border: activePortalMenu === item.key ? "1px solid #7dd3fc" : "1px solid rgba(255,255,255,0.05)", background: activePortalMenu === item.key ? "rgba(125,211,252,0.18)" : "rgba(255,255,255,0.04)", color: "#e2e8f0", textAlign: "left", cursor: "pointer" }}>
                  <span style={{ display: "block", fontWeight: 800 }}>{item.label}</span>
                  <small style={{ color: "rgba(226,232,240,0.64)" }}>{item.desc}</small>
                </button>
              ))}
            </nav>
          </aside>

          <section style={{ minWidth: 0, height: "100%", display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", gap: 16, overflow: "hidden" }}>
            <header className="user-shell-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, padding: "18px 22px", borderRadius: 26, background: "rgba(255,255,255,0.9)", border: "1px solid rgba(148, 163, 184, 0.18)" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 52, height: 52, borderRadius: 16, overflow: "hidden", background: "#eff6ff", border: "1px solid #d7e0e8" }}>
                    <img src={uiContract.company.logoDataUrl} alt={`${uiContract.company.name} 로고`} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: uiContract.brand.primary }}>{uiContract.company.name} 업무 허브</div>
                    <div style={{ marginTop: 6, fontSize: 30, fontWeight: 900, letterSpacing: "-0.04em" }}>{me?.userName}님, 우선순위를 확인하세요</div>
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                <input ref={searchInputRef} className="user-global-search" aria-label="통합 검색" value={searchText} onFocus={() => { if (searchText.trim()) setSearchOpen(true); }} onKeyDown={(event) => { if (event.key === "Escape") closeUnifiedSearch(); }} onChange={(event) => setSearchText(event.target.value)} placeholder="통합 검색" style={{ width: 300, height: 46, borderRadius: 14, border: "1px solid #d7e0e8", background: "#fff", padding: "0 14px" }} />
                {searchText ? <button type="button" className="user-search-clear" aria-label="검색 지우기" onClick={closeUnifiedSearch}>지우기</button> : null}
                {notificationError && !showNotificationPanel ? <div className="feedback-shell-warning"><CompactWarning item={{ id: "notification-load", source: "notifications", tone: "warning", title: "알림 연결 확인 필요", message: notificationError, action: { label: "다시 시도", onAction: () => void loadNotificationData(token) } }} onDismiss={() => setNotificationError("")} /></div> : null}
                <button ref={notificationButtonRef} className="user-notification-entry" type="button" aria-label={`알림, 미확인 ${notificationSummary?.unreadCount ?? 0}건`} aria-controls="recent-notification-panel" aria-expanded={showNotificationPanel} onClick={toggleNotificationPanel} style={{ height: 46, borderRadius: 14, border: "1px solid #d7e0e8", background: "#fff", padding: "0 12px", fontWeight: 700, cursor: "pointer" }}>알림 {(notificationSummary?.unreadCount ?? 0) > 0 ? <span aria-hidden="true">{notificationSummary?.unreadCount}</span> : null}</button>
                {uiContract.quickComposeVisible && activePortalMenu !== "home" ? (
                  <button
                    type="button"
                    onClick={() => void openQuickCompose()}
                    style={{ height: 46, borderRadius: 14, border: 0, background: uiContract.brand.primary, color: "#fff", padding: "0 16px", fontWeight: 800 }}
                  >
                    빠른 작성
                  </button>
                ) : null}
                <button type="button" onClick={refreshUiContract} style={{ height: 46, borderRadius: 14, border: "1px solid #d7e0e8", background: "#fff", padding: "0 14px", fontWeight: 700 }}>설정 반영</button>
                <div style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 46, padding: "0 12px", borderRadius: 14, border: "1px solid #d7e0e8", background: "#fff" }}>
                  <button type="button" className="user-profile-entry" aria-label="내 프로필 수정" onClick={() => setPortalMenu("settings")}>
                    <span className="user-profile-entry__avatar">{headerProfilePhotoUrl ? <img src={headerProfilePhotoUrl} alt="" /> : <span aria-hidden="true">{(headerProfile?.name ?? me.userName).trim().slice(0, 1)}</span>}</span>
                    <span style={{ display: "grid", gap: 2, lineHeight: 1.1 }}>
                      <strong>{headerProfile?.name ?? me.userName}</strong>
                      <span style={{ color: "#64748b", fontSize: 11 }}>{me.roleName || "역할 미지정"} / {me.userEmail}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      clearUserToken();
                      setToken("");
                      setMe(null);
                    }}
                    style={{ height: 34, borderRadius: 12, border: 0, background: "#0f172a", color: "#fff", padding: "0 12px", fontWeight: 800, cursor: "pointer" }}
                  >
                    로그아웃
                  </button>
                </div>
              </div>
            </header>
            {searchOpen ? (
              <div className="user-search-backdrop">
                <button type="button" className="user-search-dismiss" aria-label="검색 바깥 영역 닫기" onClick={closeUnifiedSearch} />
                <section className="user-search-panel" role="dialog" aria-label="통합 검색 결과">
                  <div className="user-search-panel-header">
                    <div><strong>통합 검색</strong><span>{searchText.trim()}</span></div>
                    <button type="button" aria-label="검색 닫기" onClick={closeUnifiedSearch}>닫기</button>
                  </div>
                  <div className="user-search-filters" role="group" aria-label="검색 유형 필터">
                    {([["all", "전체"], ["mail", "메일"], ["approval", "결재"], ["messenger", "메신저"], ["schedule", "일정"], ["contacts", "주소록"], ["org", "조직도"], ["files", "파일"]] as const).map(([type, label]) => (
                      <button key={type} type="button" data-search-filter={type} aria-pressed={searchFilter === type} onClick={() => setSearchFilter(type)}>{label} {type === "all" ? searchResults.length : searchResults.filter((item) => item.type === type).length}</button>
                    ))}
                  </div>
                  <div className="user-search-result-list">
                    {searchLoading ? <div className="user-search-state">검색 중입니다.</div> : null}
                    {!searchLoading && searchError ? <div className="user-search-error" role="alert">{searchError}</div> : null}
                    {!searchLoading && !searchError && searchResults.filter((item) => searchFilter === "all" || item.type === searchFilter).length === 0 ? <div className="user-search-state">검색 결과가 없습니다.</div> : null}
                    {!searchLoading && !searchError ? searchResults.filter((item) => searchFilter === "all" || item.type === searchFilter).map((item) => (
                      <button key={`${item.type}-${item.id}`} type="button" className="user-search-result" onClick={() => openSearchResult(item)}>
                        <span>{item.type}</span><strong>{item.title}</strong><small>{item.detail}</small>
                      </button>
                    )) : null}
                  </div>
                  <button type="button" className="user-search-all" onClick={() => setSearchFilter("all")}>전체 결과</button>
                </section>
              </div>
            ) : null}
            {showNotificationPanel ? (
              <div className="user-notification-backdrop">
                <button type="button" className="user-notification-dismiss" aria-label="알림 바깥 영역 닫기" onClick={closeNotificationPanel} />
                <aside id="recent-notification-panel" className="user-notification-panel" role="dialog" aria-labelledby="recent-notification-title" aria-modal="false" onKeyDown={event => { if (event.key === "Escape") closeNotificationPanel(); }}>
                  <div className="user-notification-panel-header">
                    <div>
                      <strong id="recent-notification-title">최근 알림</strong>
                      <span>읽지 않음 {notificationSummary?.unreadCount ?? 0}건</span>
                    </div>
                    <button type="button" aria-label="알림 닫기" autoFocus onClick={closeNotificationPanel}>닫기</button>
                  </div>
                  {notificationError ? <div className="user-notification-panel-error" role="alert">{notificationError}</div> : null}
                  <div className="user-notification-panel-list" aria-busy={loading || notificationLoading}>
                    {loading ? <div className="user-notification-empty">알림을 처리하는 중입니다.</div> : null}
                    {notificationLoading && notifications.length === 0 ? <div className="user-notification-empty">알림을 불러오는 중입니다.</div> : null}
                    {notifications.slice(0, 5).map(item => {
                      const value = (item.resourceType || item.category).toLowerCase();
                      const menu = value.includes("mail") ? "mail" : value.includes("approval") ? "approval" : value.includes("message") || value.includes("room") ? "messenger" : value.includes("schedule") || value.includes("calendar") ? "schedule" : value.includes("file") ? "files" : value.includes("notice") ? "notices" : "alerts";
                      return <button key={item.notificationId} type="button" className={`user-notification-row ${item.status === "unread" ? "is-unread" : ""}`} onClick={() => void openNotificationTarget(menu, item)}>
                        <span>{item.category}</span>
                        <strong>{item.title}</strong>
                        <small>{new Date(item.occurredAt).toLocaleString("ko-KR")} · {item.status === "unread" ? "읽지 않음" : "읽음"}</small>
                      </button>;
                    })}
                    {!notificationLoading && notifications.length === 0 ? <div className="user-notification-empty">최근 알림이 없습니다.</div> : null}
                  </div>
                  <div className="user-notification-panel-actions">
                    <button type="button" onClick={() => void executeReadAll()} disabled={loading || notificationLoading || !(notificationSummary?.unreadCount ?? 0)}>모두 읽음</button>
                    <button type="button" className="user-notification-all" onClick={() => { closeNotificationPanel(); setPortalMenu("alerts"); }}>전체 알림 보기</button>
                  </div>
                </aside>
              </div>
            ) : null}
            <section className="user-shell-content" style={{ minHeight: 0, overflow: "hidden", position: "relative" }}>
              {renderWorkPanel()}
            </section>
          </section>
          <ConfirmModal
            open={mailComposeCloseConfirmOpen}
            title="작성 중인 메일 닫기"
            message="저장하지 않은 받는 사람, 제목, 본문이 사라집니다."
            confirmLabel="저장하지 않고 닫기"
            onCancel={() => setMailComposeCloseConfirmOpen(false)}
            onConfirm={resetMailCompose}
          />
          <ConfirmModal
            open={mailDeleteConfirmOpen}
            title="메일 삭제 확인"
            message={<><strong>{selectedMailIds.length}개 메일</strong>을 삭제 상태로 전환합니다. 처리 후 목록을 다시 불러옵니다.</>}
            confirmLabel="선택 메일 삭제"
            busy={mailBulkBusy}
            onCancel={() => setMailDeleteConfirmOpen(false)}
            onConfirm={async () => {
              const completed = await runBulkMailAction("delete");
              if (completed) setMailDeleteConfirmOpen(false);
            }}
          />
          {mailResourceModal !== "none" ? (
            <div className="mail-resource-modal-backdrop" role="presentation">
              <section className={mailResourceModal === "folder" ? "mail-resource-modal mail-folder-modal" : "mail-resource-modal mail-tag-modal"} role="dialog" aria-modal="true" aria-labelledby="mail-resource-modal-title" onKeyDown={(event) => { if (event.key === "Escape") setMailResourceModal("none"); }}>
                <h2 id="mail-resource-modal-title">{mailResourceModal === "folder" ? "사용자 메일함" : "태그"} {mailResourceEditId ? "수정" : "추가"}</h2>
                <label><span>이름</span><input autoFocus maxLength={mailResourceModal === "folder" ? 40 : 30} value={mailResourceName} onChange={(event) => setMailResourceName(event.target.value)} /></label>
                {mailResourceModal === "tag" ? <label><span>색상</span><select value={mailTagColor} onChange={(event) => setMailTagColor(event.target.value as MailTag["color"])}>{["gray", "red", "orange", "yellow", "green", "blue", "purple"].map((color) => <option key={color} value={color}>{color}</option>)}</select></label> : null}
                <div><button type="button" onClick={() => setMailResourceModal("none")}>취소</button><button type="button" disabled={!mailResourceName.trim() || mailBulkBusy} onClick={() => void saveMailResource()}>저장</button></div>
              </section>
            </div>
          ) : null}
          <ConfirmModal
            open={Boolean(mailResourceDelete)}
            title={mailResourceDelete?.kind === "folder" ? "사용자 메일함 삭제" : "태그 삭제"}
            message={mailResourceDelete?.kind === "folder" ? "포함된 메일은 받은편지함으로 돌아갑니다. 삭제하시겠습니까?" : "메일은 유지되고 태그 관계만 제거됩니다."}
            confirmLabel="삭제"
            busy={mailBulkBusy}
            onCancel={() => setMailResourceDelete(null)}
            onConfirm={async () => {
              if (!mailResourceDelete) return;
              await removeMailResource(mailResourceDelete.kind, mailResourceDelete.id);
              setMailResourceDelete(null);
            }}
          />
          <div id="mail-purge-confirm">
            <ConfirmModal
              open={mailPurgeConfirmOpen}
              title="메일 영구 삭제"
              message={<><strong>{selectedMailIds.length}개 메일</strong>을 이 사용자 화면에서 복구할 수 없게 처리합니다. 다른 사용자의 메일 원문과 첨부는 삭제하지 않습니다.</>}
              confirmLabel="영구 삭제"
              busy={mailBulkBusy}
              onCancel={() => setMailPurgeConfirmOpen(false)}
              onConfirm={async () => { if (await runUi020BulkAction("purge")) setMailPurgeConfirmOpen(false); }}
            />
          </div>          {quickComposePicker}
        </div>
      </main>
    );
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top left, rgba(15,118,110,0.12), transparent 28%), linear-gradient(180deg, #f7f5ef 0%, #eef4f3 100%)",
        color: "#0f172a",
        fontFamily: `"Pretendard Variable", "SUIT", "Noto Sans KR", "Segoe UI", sans-serif`,
      }}
    >
      {!token ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(320px, 1.15fr) minmax(320px, 0.85fr)",
            gap: 28,
            maxWidth: 1360,
            margin: "0 auto",
            padding: "48px 32px 56px",
          }}
        >
          <section
            style={{
              padding: 38,
              borderRadius: 36,
              background: "linear-gradient(145deg, #103b39 0%, #0b1f2a 78%)",
              color: "#f8fafc",
              boxShadow: "0 30px 80px rgba(15, 23, 42, 0.28)",
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                position: "absolute",
                right: -80,
                top: -80,
                width: 260,
                height: 260,
                borderRadius: 999,
                background: "rgba(153, 246, 228, 0.08)",
              }}
            />
            <div style={{ position: "relative" }}>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 14px",
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,0.18)",
                  background: "rgba(255,255,255,0.06)",
                  fontSize: 13,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                }}
              >
                <span style={{ width: 28, height: 28, borderRadius: 10, overflow: "hidden", display: "inline-block", background: "rgba(255,255,255,0.16)" }}>
                  <img src={uiContract.company.logoDataUrl} alt={`${uiContract.company.name} 로고`} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                </span>
                {uiContract.company.name} Groupware
              </div>
              <h1 style={{ margin: "24px 0 18px", fontSize: 58, lineHeight: 1.05, letterSpacing: "-0.04em" }}>
                메일, 결재, 메신저가 한 화면에서 이어지는
                <br />
                사용자 업무 포털
              </h1>
                <p style={{ margin: 0, maxWidth: 660, color: "rgba(248,250,252,0.82)", fontSize: 18, lineHeight: 1.6 }}>
                  메일, 결재, 메신저를 한 화면에서 바로 이어가는 사용자 포털입니다.
                </p>

              <div
                style={{
                  marginTop: 30,
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: 16,
                }}
              >
                <SurfaceCard
                  title="메일"
                  value="서버 1개월"
                  subtext="중요 메일은 설치형 프로그램에서 로컬 아카이브 무기한 보관을 유지하고, 웹은 빠른 확인과 처리 흐름을 맡습니다."
                  tone="teal"
                />
                <SurfaceCard
                  title="메신저"
                  value="서버 2주"
                  subtext="업무 대화는 웹에서 빠르게 확인하고, 상세 보관은 설치형 프로그램의 JSON/HTML 대화 파일 흐름으로 연결합니다."
                  tone="sand"
                />
              </div>

              <div
                style={{
                  marginTop: 24,
                  display: "grid",
                  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                  gap: 12,
                }}
              >
                {[
                  { title: "메일함", value: "안 읽은 메일 / 중요함 / 임시보관함" },
                  { title: "결재", value: "대기 결재 / 상신 / 반려 / 재기안" },
                  { title: "메신저", value: "최근 대화 / 고정 채널 / 파일 링크" },
                ].map((item) => (
                  <div
                    key={item.title}
                    style={{
                      padding: "16px 18px",
                      borderRadius: 24,
                      border: "1px solid rgba(255,255,255,0.12)",
                      background: "rgba(255,255,255,0.06)",
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{item.title}</div>
                    <div style={{ marginTop: 8, fontSize: 14, color: "rgba(248,250,252,0.76)", lineHeight: 1.6 }}>{item.value}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section
            style={{
              display: "grid",
              gap: 20,
              alignContent: "start",
            }}
          >
            <article
              style={{
                background: "rgba(255,255,255,0.82)",
                backdropFilter: "blur(18px)",
                border: "1px solid rgba(148, 163, 184, 0.18)",
                borderRadius: 30,
                padding: 30,
                boxShadow: "0 24px 60px rgba(15, 23, 42, 0.12)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 14, color: "#0f766e", fontWeight: 700 }}>사용자 포털 접속</div>
                  <h2 style={{ margin: "10px 0 0", fontSize: 34, letterSpacing: "-0.04em" }}>업무 시작</h2>
                </div>
                <p style={{ margin: 0, color: "#115e59", fontSize: 13, fontWeight: 700 }}>Help / 정책 안내로 주요 설정을 안내합니다.</p>
              </div>

              <div
                style={{
                  marginTop: 18,
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "14px 16px",
                  borderRadius: 20,
                  background: "#f8fafc",
                  border: "1px solid #dbe4ec",
                }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 14,
                    overflow: "hidden",
                    background: "#ffffff",
                    border: "1px solid #dbe4ec",
                    flexShrink: 0,
                  }}
                >
                  <img src={uiContract.company.logoDataUrl} alt={`${uiContract.company.name} 로고`} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a" }}>{uiContract.company.name}</div>
                  <div style={{ marginTop: 4, fontSize: 13, color: "#475569" }}>{uiContract.company.domain}</div>
                </div>
              </div>

              <form onSubmit={handleLogin} style={{ display: "grid", gap: 14, marginTop: 24 }}>
                <label style={{ display: "grid", gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#334155" }}>아이디</span>
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 10, alignItems: "center" }}>
                    <input
                      value={loginForm.loginId}
                      onChange={(event) => setLoginForm((current) => ({ ...current, loginId: normalizeLoginIdInput(event.target.value) }))}
                      placeholder="admin"
                      style={{
                        height: 54,
                        borderRadius: 16,
                        border: "1px solid #cbd5e1",
                        padding: "0 16px",
                        font: "inherit",
                        background: "#fff",
                      }}
                    />
                    <span style={{ height: 54, display: "inline-flex", alignItems: "center", padding: "0 16px", borderRadius: 16, border: "1px solid #dbe4ec", background: "#f8fafc", color: "#475569", fontSize: 13, fontWeight: 700 }}>
                      @{uiContract.company.domain}
                    </span>
                  </div>
                </label>
                <label style={{ display: "grid", gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#334155" }}>비밀번호</span>
                  <input
                    type="password"
                    value={loginForm.password}
                    onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
                    style={{
                      height: 54,
                      borderRadius: 16,
                      border: "1px solid #cbd5e1",
                      padding: "0 16px",
                      font: "inherit",
                      background: "#fff",
                    }}
                  />
                </label>
                <button
                  disabled={loading}
                  style={{
                    height: 56,
                    borderRadius: 18,
                    border: 0,
                    background: "linear-gradient(135deg, #0f766e 0%, #14532d 100%)",
                    color: "#fff",
                    fontSize: 16,
                    fontWeight: 800,
                    cursor: "pointer",
                    boxShadow: "0 18px 36px rgba(15, 118, 110, 0.22)",
                  }}
                >
                  {loading ? "접속 중..." : "업무 포털 로그인"}
                </button>
              </form>
            </article>

            <article
              style={{
                background: "#fff",
                borderRadius: 28,
                padding: 26,
                border: "1px solid #e2e8f0",
                boxShadow: "0 22px 44px rgba(15, 23, 42, 0.08)",
              }}
            >
              <h3 style={{ margin: 0, fontSize: 24, letterSpacing: "-0.03em" }}>Help / 정책 안내</h3>
              <div
                style={{
                  marginTop: 18,
                  padding: "16px 18px",
                  borderRadius: 20,
                  background: "#f8fafc",
                  border: "1px solid #dbe4ec",
                  color: "#475569",
                  lineHeight: 1.7,
                }}
              >
                정책 경로: `Help`, `정책 안내`, `설정 &gt; 보관 정책`
              </div>
            </article>

            {approvalError ? (
              <FeedbackState state="error" title="로그인할 수 없습니다." message={approvalError} />
            ) : null}
          </section>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "260px minmax(0, 1fr)",
            gap: 24,
            maxWidth: 1560,
            margin: "0 auto",
            padding: "24px 24px 40px",
          }}
        >
          <aside
            style={{
              position: "sticky",
              top: 24,
              alignSelf: "start",
              borderRadius: 30,
              padding: 24,
              background: "linear-gradient(180deg, #102a43 0%, #0f172a 100%)",
              color: "#e2e8f0",
              boxShadow: "0 24px 64px rgba(15, 23, 42, 0.24)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 56, height: 56, borderRadius: 18, overflow: "hidden", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
                <img src={uiContract.company.logoDataUrl} alt={`${uiContract.company.name} 로고`} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              </div>
              <div>
                <div style={{ fontSize: 14, color: "#7dd3fc", letterSpacing: "0.08em", textTransform: "uppercase" }}>{uiContract.company.name} Portal</div>
                <h1 style={{ margin: "14px 0 8px", fontSize: 32, lineHeight: 1.08, letterSpacing: "-0.04em" }}>사용자 업무 홈</h1>
                <p style={{ margin: 0, color: "rgba(226,232,240,0.72)", lineHeight: 1.5 }}>{uiContract.company.domain}</p>
              </div>
            </div>
            <p style={{ margin: "14px 0 0", color: "rgba(226,232,240,0.72)", lineHeight: 1.5 }}>
              메일, 결재, 메신저, 알림을 바로 처리하는 업무 홈입니다.
            </p>

            <nav style={{ display: "grid", gap: 10, marginTop: 28 }}>
              {orderedNavItems.map((item) => (
                <div
                  key={item.label}
                  style={{
                    borderRadius: 18,
                    padding: "14px 16px",
                    background: item.label === "결재" ? `${uiContract.brand.primary}29` : "rgba(255,255,255,0.04)",
                    border: `1px solid ${item.label === "결재" ? `${uiContract.brand.primary}52` : "rgba(255,255,255,0.05)"}`,
                  }}
                >
                  <div style={{ fontWeight: 800, fontSize: 15 }}>{item.label}</div>
                  <div style={{ marginTop: 6, fontSize: 12, color: "rgba(226,232,240,0.66)", lineHeight: 1.5 }}>{item.desc}</div>
                </div>
              ))}
            </nav>

            <div style={{ marginTop: 26, paddingTop: 20, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <div style={{ fontSize: 12, color: "#67e8f9", letterSpacing: "0.08em", textTransform: "uppercase" }}>Help / 정책 안내</div>
              <div style={{ marginTop: 12, fontSize: 13, color: "rgba(226,232,240,0.82)", lineHeight: 1.8 }}>
                <div>정책 경로: {uiContract.helpText}</div>
              </div>
            </div>
          </aside>

          <section style={{ minWidth: 0 }}>
            <header
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 16,
                flexWrap: "wrap",
                padding: "22px 24px",
                borderRadius: 28,
                background: "rgba(255,255,255,0.88)",
                backdropFilter: "blur(18px)",
                border: "1px solid rgba(148, 163, 184, 0.18)",
                boxShadow: "0 20px 40px rgba(15, 23, 42, 0.08)",
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: uiContract.brand.primary }}>오늘의 업무 허브</div>
                <div style={{ marginTop: 8, fontSize: 34, fontWeight: 800, letterSpacing: "-0.04em" }}>
                  {me?.userName}님, 오늘 우선순위를 확인하세요
                </div>
              </div>
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="메일, 결재, 대화, 파일 검색"
                  style={{
                    width: 320,
                    height: 50,
                    borderRadius: 16,
                    border: "1px solid #d7e0e8",
                    background: "#fff",
                    padding: "0 16px",
                    font: "inherit",
                  }}
                />
                {token && uiContract.quickComposeVisible ? (
                  <button
                    type="button"
                    onClick={() => void openQuickCompose()}
                    style={{
                      height: 50,
                      borderRadius: 16,
                      border: 0,
                      padding: "0 18px",
                      background: uiContract.brand.primary,
                      color: "#fff",
                      fontWeight: 800,
                      cursor: "pointer",
                    }}
                  >
                    빠른 작성
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={refreshUiContract}
                  style={{
                    height: 50,
                    borderRadius: 16,
                    border: "1px solid #d7e0e8",
                    padding: "0 18px",
                    background: "#fff",
                    color: "#334155",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  설정 다시 반영
                </button>
                <div
                  style={{
                    display: "inline-flex",
                    gap: 8,
                    alignItems: "center",
                    padding: "12px 14px",
                    borderRadius: 16,
                    background: "#fff",
                    border: "1px solid #d7e0e8",
                    color: "#334155",
                  }}
                >
                  알림 {dashboardStats.unreadCount}
                </div>
                <div
                  style={{
                    display: "inline-flex",
                    gap: 8,
                    alignItems: "center",
                    padding: "12px 14px",
                    borderRadius: 16,
                    background: "#fff",
                    border: "1px solid #d7e0e8",
                    color: "#334155",
                  }}
                >
                  {me?.roleName}
                </div>
              </div>
            </header>

            <section
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                gap: 18,
                marginTop: 22,
              }}
            >
            {homeSurfaceCards.map((item) => (
                <SurfaceCard
                  key={item.id}
                  title={item.title}
                  value={item.value}
                  subtext={item.subtext}
                  tone={item.tone}
                  onClick={token ? () => handleHomeSurfaceCardClick(item.id) : undefined}
                />
              ))}
            </section>

            <section
              style={{
                marginTop: 22,
                background: "#ffffff",
                borderRadius: 28,
                padding: 26,
                border: "1px solid #dce5ec",
                boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 12, color: "#0f766e", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>공통 제품 규칙</div>
                  <h2 style={{ margin: "10px 0 0", fontSize: 28, letterSpacing: "-0.04em" }}>브랜드 체계 / 공통 컴포넌트 / 상태 표현</h2>
                </div>
                <div style={{ color: "#64748b", fontSize: 14 }}>4개 프로그램이 같은 제품군처럼 읽히는 기준</div>
              </div>

              <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
                {brandPalette.map((item) => (
                  <div key={item.title} style={{ borderRadius: 20, border: "1px solid #dbe4ec", background: "#f8fafc", padding: 16 }}>
                    <div style={{ width: 52, height: 52, borderRadius: 18, background: item.value }} />
                    <div style={{ marginTop: 12, fontWeight: 800 }}>{item.title}</div>
                    <div style={{ marginTop: 6, fontSize: 13, color: "#475569" }}>{item.value}</div>
                    <div style={{ marginTop: 8, color: "#64748b", lineHeight: 1.6 }}>{item.usage}</div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
                {componentRules.map((item) => (
                  <div key={item.title} style={{ borderRadius: 20, border: "1px solid #dbe4ec", background: "#fff", padding: 16 }}>
                    <div style={{ fontSize: 12, color: "#0f766e", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}>{item.title}</div>
                    <div style={{ marginTop: 10, color: "#334155", lineHeight: 1.65 }}>{item.body}</div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
                {statusVisualRules.map((item) => (
                  <div key={item.title} style={{ borderRadius: 20, border: `1px solid ${item.border}`, background: item.bg, padding: 16 }}>
                    <div style={{ color: item.color, fontWeight: 800 }}>{item.title}</div>
                    <div style={{ marginTop: 8, color: "#334155", lineHeight: 1.6 }}>{item.body}</div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
                {settingsContractCards.map((item) => (
                  <div key={item.title} style={{ borderRadius: 20, border: "1px solid #dbe4ec", background: "#fff", padding: 16 }}>
                    <div style={{ fontSize: 12, color: "#0f766e", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}>{item.title}</div>
                    <div style={{ marginTop: 10, color: "#334155", lineHeight: 1.65 }}>{item.body}</div>
                  </div>
                ))}
              </div>
            </section>

            <section
              style={{
                marginTop: 22,
                background: "#ffffff",
                borderRadius: 28,
                padding: 26,
                border: "1px solid #dce5ec",
                boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 12, color: "#0f766e", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>핵심 업무 화면</div>
                  <h2 style={{ margin: "10px 0 0", fontSize: 28, letterSpacing: "-0.04em" }}>메일 / 결재 / 메신저 작업면</h2>
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {[
                    { id: "mail", label: "메일" },
                    { id: "approval", label: "결재" },
                    { id: "messenger", label: "메신저" },
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setActiveWorkspace(item.id as WorkspaceTab)}
                      style={{
                        height: 42,
                        borderRadius: 999,
                        border: activeWorkspace === item.id ? "0" : "1px solid #cbd5e1",
                        background: activeWorkspace === item.id ? "#0f766e" : "#fff",
                        color: activeWorkspace === item.id ? "#fff" : "#334155",
                        padding: "0 16px",
                        fontWeight: 800,
                        cursor: "pointer",
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {activeWorkspace === "mail" ? (
                <div style={{ display: "grid", gridTemplateColumns: "minmax(240px, 0.62fr) minmax(320px, 0.9fr) minmax(320px, 1.05fr)", gap: 18, marginTop: 22 }}>
                  <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
                    <div style={{ padding: 18, borderRadius: 22, background: "#0f172a", color: "#f8fafc" }}>
                      <div style={{ fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.78 }}>메일 폴더</div>
                      <div style={{ marginTop: 10, fontSize: 22, fontWeight: 800 }}>폴더 / 보관 흐름</div>
                    </div>
                    {mailFolders.map((item) => (
                      <div key={item.title} style={{ borderRadius: 22, padding: 18, border: "1px solid #dbe4ec", background: "#f8fafc" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                          <strong style={{ fontSize: 17 }}>{item.title}</strong>
                          <span style={{ color: item.tone, fontWeight: 800 }}>{item.count}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
                    <div style={{ padding: 18, borderRadius: 22, border: "1px solid #dbe4ec", background: "#fff" }}>
                      <div style={{ fontSize: 12, color: "#0f766e", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>메일 액션</div>
                      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
                        {["새 메일 작성", "통합 검색", "중요 필터", "미읽음 필터", "첨부 포함 필터"].map((action) => (
                          <span key={action} style={{ padding: "9px 12px", borderRadius: 999, background: "#eff6ff", color: "#1d4ed8", fontWeight: 700, fontSize: 13 }}>
                            {action}
                          </span>
                        ))}
                      </div>
                    </div>
                    {mailListSamples.map((item) => (
                      <div key={`${item.sender}-${item.subject}`} style={{ borderRadius: 22, padding: 18, border: "1px solid #dbe4ec", background: item.unread ? "#f8fafc" : "#fff" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                          <div style={{ fontWeight: 800 }}>{item.sender}</div>
                          <div style={{ fontSize: 13, color: "#64748b" }}>{item.time}</div>
                        </div>
                        <div style={{ marginTop: 8, fontSize: 18, fontWeight: 800, color: "#0f172a" }}>{item.subject}</div>
                        <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ padding: "6px 10px", borderRadius: 999, background: item.unread ? "#dbeafe" : "#e2e8f0", color: item.unread ? "#1d4ed8" : "#475569", fontSize: 12, fontWeight: 800 }}>
                            {item.unread ? "안읽음" : "읽음"}
                          </span>
                          {item.important ? (
                            <span style={{ padding: "6px 10px", borderRadius: 999, background: "#fff7ed", color: "#b45309", fontSize: 12, fontWeight: 800 }}>
                              중요
                            </span>
                          ) : null}
                          {item.attachment ? (
                            <span style={{ padding: "6px 10px", borderRadius: 999, background: "#ecfeff", color: "#0f766e", fontSize: 12, fontWeight: 800 }}>
                              첨부
                            </span>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
                    <div style={{ borderRadius: 22, padding: 20, border: "1px solid #dbe4ec", background: "#fff" }}>
                      <div style={{ fontSize: 12, color: "#0f766e", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>메일 상세 읽기 영역</div>
                      <h3 style={{ margin: "10px 0 0", fontSize: 24 }}>3분기 계약 검토 요청</h3>
                      <div style={{ marginTop: 14, display: "grid", gap: 10, color: "#475569" }}>
                        <div><strong style={{ color: "#0f172a" }}>발신자</strong> 대표이사 &lt;{`ceo@${uiContract.company.domain}`}&gt;</div>
                        <div><strong style={{ color: "#0f172a" }}>수신자</strong> 신산님, 경영지원팀</div>
                        <div><strong style={{ color: "#0f172a" }}>참조</strong> 법무협업, 제품전략</div>
                        <div><strong style={{ color: "#0f172a" }}>첨부</strong> 계약서_v3.pdf, 검토포인트.xlsx</div>
                      </div>
                      <div style={{ marginTop: 16, padding: 16, borderRadius: 18, background: "#f8fafc", border: "1px solid #dbe4ec", color: "#334155", lineHeight: 1.7 }}>
                        오늘 안으로 계약 조항 변경 포인트를 검토해 주세요. 회신이 필요한 항목은 중요 표시 후 바로 답장할 수 있도록 배치했습니다.
                      </div>
                      <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
                        {["답장", "전달", "중요 표시", "보관 이동"].map((action) => (
                          <span key={action} style={{ padding: "9px 12px", borderRadius: 999, background: "#ecfeff", color: "#0f766e", fontWeight: 700, fontSize: 13 }}>
                            {action}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div style={{ padding: 16, borderRadius: 18, background: "#fff7ed", border: "1px solid #fed7aa", color: "#9a3412" }}>
                      Help / 정책 안내 / 설정 &gt; 보관 정책 경로만 유지하고, 메일 화면 본문에는 정책 설명을 직접 넣지 않습니다.
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
                      {mailStatusMessages.map((item) => (
                        <div key={item.title} style={{ padding: 16, borderRadius: 18, border: "1px solid #dbe4ec", background: "#f8fafc" }}>
                          <div style={{ fontSize: 12, color: item.tone, fontWeight: 800 }}>{item.title}</div>
                          <div style={{ marginTop: 10, color: "#334155", lineHeight: 1.6 }}>{item.body}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {activeWorkspace === "approval" ? (
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 0.85fr) minmax(0, 1.15fr)", gap: 18, marginTop: 22 }}>
                  <div style={{ display: "grid", gap: 12 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
                      {approvalBuckets.map((item) => (
                        <div key={item.title} style={{ borderRadius: 18, padding: 16, background: "#f8fafc", border: "1px solid #dbe4ec" }}>
                          <div style={{ fontSize: 12, color: item.tone, fontWeight: 800 }}>{item.title}</div>
                          <div style={{ marginTop: 8, fontSize: 26, fontWeight: 800 }}>{item.count}</div>
                        </div>
                      ))}
                    </div>
                      <div style={{ borderRadius: 22, padding: 18, background: "#fff", border: "1px solid #dbe4ec" }}>
                        <strong>결재 리스트</strong>
                        <div style={{ marginTop: 8, color: "#475569" }}>초안/상신/승인대기/완료 상태를 탭으로 구분해 확인합니다.</div>
                      </div>
                      <div style={{ borderRadius: 22, padding: 18, background: "#f8fafc", border: "1px solid #dbe4ec" }}>
                        <strong>최근 결재 활동</strong>
                        <div style={{ marginTop: 8, color: "#475569" }}>최근 감사 이벤트 {logsCount}건을 확인하고 상태 변경까지 이동합니다.</div>
                      </div>
                  </div>
                  <div style={{ borderRadius: 22, padding: 20, background: "#fff", border: "1px solid #dbe4ec" }}>
                    <div style={{ fontSize: 12, color: "#0f766e", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>결재 상세 보기</div>
                    <h3 style={{ margin: "10px 0 0", fontSize: 24 }}>문서 리스트와 상세 작업을 한 흐름으로</h3>
                      <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
                        <div style={{ padding: 16, borderRadius: 18, background: "#f8fafc", border: "1px solid #dbe4ec" }}>
                          상태 탭/상세 본문/결재선을 한 화면에서 처리합니다.
                        </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
                        {[
                          "결재선: 부장 → 본부장 → 대표",
                          "최근 활동: 상신 09:10 / 검토중",
                          "권한 메시지: 승인 권한 없으면 즉시 차단",
                        ].map((item) => (
                          <div key={item} style={{ padding: 14, borderRadius: 16, background: "#eff6ff", color: "#1d4ed8", fontSize: 13, fontWeight: 700 }}>
                            {item}
                          </div>
                        ))}
                      </div>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        {["결재 작성", "상신", "회수", "반려 문서 재기안"].map((action) => (
                          <span key={action} style={{ padding: "9px 12px", borderRadius: 999, background: "#ecfeff", color: "#0f766e", fontWeight: 700, fontSize: 13 }}>
                            {action}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {activeWorkspace === "messenger" ? (
                <div style={{ display: "grid", gridTemplateColumns: "minmax(240px, 0.7fr) minmax(320px, 1fr) minmax(260px, 0.72fr)", gap: 18, marginTop: 22 }}>
                  <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
                    {messengerRooms.map((group) => (
                      <div key={group.title} style={{ borderRadius: 22, padding: 18, background: "#f8fafc", border: "1px solid #dbe4ec" }}>
                        <strong>{group.title}</strong>
                        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                          {group.entries.map((entry) => (
                            <div key={entry} style={{ padding: 10, borderRadius: 14, background: "#fff", border: "1px solid #e2e8f0", color: "#334155" }}>
                              {entry}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ borderRadius: 22, padding: 20, background: "#fff", border: "1px solid #dbe4ec" }}>
                    <div style={{ fontSize: 12, color: "#0f766e", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>대화 타임라인</div>
                    <h3 style={{ margin: "10px 0 0", fontSize: 24 }}>메시지 / 첨부 / 링크 / 상태 흐름</h3>
                    <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
                      {messengerTimeline.map((item) => (
                        <div key={`${item.sender}-${item.time}`} style={{ padding: 16, borderRadius: 18, background: "#f8fafc", border: "1px solid #dbe4ec" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                            <strong>{item.sender}</strong>
                            <span style={{ fontSize: 13, color: "#64748b" }}>{item.time}</span>
                          </div>
                          <div style={{ marginTop: 10, color: "#334155", lineHeight: 1.7 }}>{item.body}</div>
                          <div style={{ marginTop: 10, color: "#0f766e", fontSize: 13, fontWeight: 700 }}>{item.meta}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
                      {["새 대화", "대화 검색", "파일 모아보기", "알림 설정"].map((action) => (
                        <span key={action} style={{ padding: "9px 12px", borderRadius: 999, background: "#eff6ff", color: "#1d4ed8", fontWeight: 700, fontSize: 13 }}>
                          {action}
                        </span>
                      ))}
                    </div>
                    <div style={{ marginTop: 16, padding: 16, borderRadius: 18, background: "#fff7ed", border: "1px solid #fed7aa", color: "#9a3412" }}>
                      타임라인은 로컬 파일 보관 진입만 안내합니다.
                    </div>
                  </div>
                  <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
                    {collaborationPanels.map((item) => (
                      <div key={item.title} style={{ borderRadius: 22, padding: 18, background: "#fff", border: "1px solid #dbe4ec" }}>
                        <div style={{ fontSize: 12, color: "#0f766e", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}>{item.title}</div>
                        <div style={{ marginTop: 10, color: "#475569", lineHeight: 1.7 }}>{item.body}</div>
                      </div>
                    ))}
                    {messengerBuckets.map((item) => (
                      <div key={item.title} style={{ borderRadius: 22, padding: 18, background: "#f8fafc", border: "1px solid #dbe4ec" }}>
                        <strong>{item.title}</strong>
                        <div style={{ marginTop: 8, color: "#475569", lineHeight: 1.65 }}>{item.note}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>

            <section
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1.2fr) minmax(320px, 0.8fr)",
                gap: 20,
                marginTop: 22,
              }}
            >
              <article
                style={{
                  background: "#ffffff",
                  borderRadius: 28,
                  padding: 26,
                  border: "1px solid #dce5ec",
                  boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <div>
                <div style={{ fontSize: 12, color: "#0f766e", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>메인 대시보드</div>
                <h2 style={{ margin: "10px 0 0", fontSize: 28, letterSpacing: "-0.04em" }}>즐겨찾기 업무와 오늘 처리할 일</h2>
              </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                    gap: 16,
                    marginTop: 22,
                  }}
                >
                  {[
                    {
                      title: "메일",
                      description: "받은편지함, 중요메일, 임시보관함, 개인 로컬 아카이브",
                      badge: "업무 진입 우선",
                    },
                    {
                      title: "결재",
                      description: "대기 결재 확인, 신규 상신, 반려 재기안, 최근 감사 로그",
                      badge: `${dashboardStats.pendingApprovals}건 대기`,
                    },
                    {
                      title: "메신저",
                      description: "최근 대화, 고정 채널, 조직 기반 대화방, 대화 파일 저장",
                      badge: "대화 빠른 확인",
                    },
                    {
                      title: "오늘 일정",
                      description: "일정·회의·마감일을 한 번에 보는 자리",
                      badge: "다음 단계 연동",
                    },
                    {
                      title: "공지",
                      description: "운영 공지, 조직 공지, 팀 공지를 상단 고정 영역으로 배치",
                      badge: "공지 허브",
                    },
                    {
                      title: "즐겨찾기 업무",
                      description: "자주 쓰는 메일함, 결재함, 파일함을 개인화 메뉴로 저장",
                      badge: "사용자 맞춤",
                    },
                  ].map((item) => (
                    <div
                      key={item.title}
                      style={{
                        borderRadius: 22,
                        padding: 18,
                        background: "#f8fafc",
                        border: "1px solid #dbe4ec",
                        display: "grid",
                        gap: 10,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                        <strong style={{ fontSize: 18 }}>{item.title}</strong>
                        <span
                          style={{
                            padding: "7px 10px",
                            borderRadius: 999,
                            background: "#ecfeff",
                            color: "#0f766e",
                            fontSize: 12,
                            fontWeight: 700,
                            textAlign: "center",
                          }}
                        >
                          {item.badge}
                        </span>
                      </div>
                      <div style={{ color: "#475569", lineHeight: 1.65, fontSize: 14 }}>{item.description}</div>
                    </div>
                  ))}
                </div>
              </article>

              <article
                style={{
                  background: "#ffffff",
                  borderRadius: 28,
                  padding: 26,
                  border: "1px solid #dce5ec",
                  boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
                  display: "grid",
                  gap: 18,
                }}
              >
                <div>
                  <div style={{ fontSize: 12, color: "#0f766e", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>사용자 / Help</div>
                  <h2 style={{ margin: "10px 0 0", fontSize: 28, letterSpacing: "-0.04em" }}>프로필과 정책 안내</h2>
                </div>

                <div
                  style={{
                    padding: 18,
                    borderRadius: 22,
                    background: "linear-gradient(135deg, #f0fdfa, #ecfeff)",
                    border: "1px solid #99f6e4",
                  }}
                >
                  <div style={{ fontSize: 20, fontWeight: 800 }}>{me?.userName}</div>
                  <div style={{ marginTop: 6, color: "#334155" }}>
                    {me?.roleName || "역할 미지정"} / {canAct.create ? "결재 작성 가능" : "읽기 전용"}
                  </div>
                  <div style={{ marginTop: 12, color: "#475569" }}>{me?.userEmail}</div>
                </div>

                <div
                  style={{
                    padding: 18,
                    borderRadius: 22,
                    background: "#f8fafc",
                    border: "1px solid #dbe4ec",
                    color: "#334155",
                    lineHeight: 1.7,
                  }}
                >
                  <div style={{ fontWeight: 800 }}>정책 안내 열람 경로</div>
                  <div style={{ marginTop: 8 }}>{uiContract.helpText} 경로와 오류/차단 메시지 도움말에서 같은 기준으로 안내합니다.</div>
                </div>

                <button
                  onClick={() => {
                    clearUserToken();
                    setToken("");
                    setMe(null);
                  }}
                  style={{
                    height: 52,
                    borderRadius: 16,
                    border: 0,
                    background: "#0f172a",
                    color: "#fff",
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  로그아웃
                </button>
              </article>
            </section>

            <section
              style={{
                marginTop: 22,
                background: "#ffffff",
                borderRadius: 28,
                padding: 26,
                border: "1px solid #dce5ec",
                boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 12, color: "#0f766e", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>다국어 메시지 범위</div>
                  <h2 style={{ margin: "10px 0 0", fontSize: 28, letterSpacing: "-0.04em" }}>오류 / 경고 / 차단 / 빈 상태까지 포함</h2>
                </div>
                <div style={{ color: "#64748b", fontSize: 14 }}>현재 언어 {locale}</div>
              </div>
              <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 12 }}>
                {messageScopes.map((item) => (
                  <div key={item.title} style={{ borderRadius: 18, padding: 16, background: "#f8fafc", border: "1px solid #dbe4ec" }}>
                    <div style={{ fontSize: 12, color: item.tone, fontWeight: 800 }}>{item.title}</div>
                    <div style={{ marginTop: 10, color: "#334155", lineHeight: 1.65 }}>{item.sample}</div>
                  </div>
                ))}
              </div>
            </section>

            <section
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 0.9fr) minmax(0, 1.1fr)",
                gap: 20,
                marginTop: 22,
              }}
            >
              <article
                style={{
                  background: "#ffffff",
                  borderRadius: 28,
                  padding: 26,
                  border: "1px solid #dce5ec",
                  boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 12, color: "#0f766e", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>알림 센터</div>
                    <h2 style={{ margin: "10px 0 0", fontSize: 28, letterSpacing: "-0.04em" }}>업무 흐름과 연결된 알림</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => void refreshNotifications(token)}
                    disabled={loading}
                    style={{
                      height: 46,
                      borderRadius: 14,
                      border: "1px solid #cbd5e1",
                      background: "#fff",
                      padding: "0 16px",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    알림 새로고침
                  </button>
                </div>

                <div
                  style={{
                    marginTop: 18,
                    display: "flex",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    style={{
                      padding: "8px 12px",
                      borderRadius: 999,
                      background: "#eef2ff",
                      color: "#3730a3",
                      fontSize: 13,
                      fontWeight: 700,
                    }}
                  >
                    미읽음 {notificationSummary?.unreadCount ?? 0}
                  </span>
                  <span
                    style={{
                      padding: "8px 12px",
                      borderRadius: 999,
                      background: "#fff7ed",
                      color: "#9a3412",
                      fontSize: 13,
                      fontWeight: 700,
                    }}
                  >
                    긴급 {notificationSummary?.severityCount.CRITICAL ?? 0}
                  </span>
                  <span
                    style={{
                      padding: "8px 12px",
                      borderRadius: 999,
                      background: "#eff6ff",
                      color: "#1d4ed8",
                      fontSize: 13,
                      fontWeight: 700,
                    }}
                  >
                    모드 {notificationMode === "streaming" ? "SSE" : notificationMode === "fallback" ? "Polling Fallback" : "Polling"}
                  </span>
                </div>

                {notificationError ? (
                  <div style={{ marginTop: 16, color: "#b91c1c", background: "#fff1f2", border: "1px solid #fecdd3", padding: "14px 16px", borderRadius: 16 }}>
                    {notificationError}
                  </div>
                ) : null}

                <div style={{ marginTop: 18, display: "grid", gap: 12 }}>
                  {notifications.slice(0, 6).map((item) => (
                    <div
                      key={item.notificationId}
                      style={{
                        display: "grid",
                        gap: 10,
                        padding: 18,
                        borderRadius: 22,
                        background: item.status === "unread" ? "#f8fafc" : "#ffffff",
                        border: "1px solid #dbe4ec",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                        <div>
                          <div style={{ fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: "#0f766e", fontWeight: 800 }}>
                            {item.category}
                          </div>
                          <div style={{ marginTop: 6, fontSize: 18, fontWeight: 800 }}>{item.title}</div>
                        </div>
                        <span
                          style={{
                            padding: "8px 12px",
                            borderRadius: 999,
                            background: item.status === "unread" ? "#fee2e2" : "#ecfccb",
                            color: item.status === "unread" ? "#991b1b" : "#3f6212",
                            fontSize: 12,
                            fontWeight: 800,
                          }}
                        >
                          {item.status}
                        </span>
                      </div>
                      <div style={{ color: "#475569", lineHeight: 1.65 }}>{item.message}</div>
                      <div>
                        <button
                          type="button"
                          onClick={() => void executeAck(item.notificationId)}
                          disabled={loading || item.status !== "unread"}
                          style={{
                            height: 42,
                            borderRadius: 14,
                            border: "1px solid #cbd5e1",
                            background: item.status === "unread" ? "#fff" : "#f8fafc",
                            padding: "0 14px",
                            fontWeight: 700,
                            cursor: item.status === "unread" ? "pointer" : "default",
                          }}
                        >
                          읽음 처리
                        </button>
                      </div>
                    </div>
                  ))}
                  {notifications.length === 0 ? (
                    <div
                      style={{
                        padding: 20,
                        borderRadius: 22,
                        border: "1px dashed #cbd5e1",
                        color: "#64748b",
                        background: "#f8fafc",
                      }}
                    >
                      아직 표시할 알림이 없습니다.
                    </div>
                  ) : null}
                </div>
              </article>

              <article
                id="approval-compose"
                style={{
                  display: uiContract.quickComposeVisible ? "grid" : "none",
                  background: "#ffffff",
                  borderRadius: 28,
                  padding: 26,
                  border: "1px solid #dce5ec",
                  boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 12, color: "#0f766e", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>빠른 결재 작성</div>
                    <h2 style={{ margin: "10px 0 0", fontSize: 28, letterSpacing: "-0.04em" }}>업무 중심 작성 화면</h2>
                  </div>
                  <div style={{ color: "#64748b", fontSize: 14 }}>감사 로그 누적 {logsCount}</div>
                </div>

                {canAct.create ? (
                  <div style={{ marginTop: 20, display: "grid", gap: 12 }}>
                    <div style={{ color: "#475569", fontSize: 13 }}>결재 작성과 결재선 선택은 별도 팝업에서 처리합니다.</div>
                    <button
                      type="button"
                      onClick={() => void openApprovalEditor("create")}
                      style={{ height: 44, borderRadius: 14, border: 0, background: "linear-gradient(135deg, #0f766e 0%, #0f172a 100%)", color: "#fff", fontWeight: 800, cursor: "pointer" }}
                    >
                      새 결재 작성 열기
                    </button>
                  </div>
                ) : (
                  <div
                    style={{
                      marginTop: 20,
                      padding: 18,
                      borderRadius: 22,
                      border: "1px dashed #cbd5e1",
                      color: "#64748b",
                      background: "#f8fafc",
                    }}
                  >
                    현재 계정은 결재 작성 권한이 없습니다.
                  </div>
                )}

              </article>
            </section>

            <section
              style={{
                marginTop: 22,
                background: "#ffffff",
                borderRadius: 28,
                padding: 26,
                border: "1px solid #dce5ec",
                boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 12, color: "#0f766e", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>업무 문서</div>
                  <h2 style={{ margin: "10px 0 0", fontSize: 28, letterSpacing: "-0.04em" }}>결재 리스트와 상세 작업</h2>
                </div>
                <div style={{ color: "#64748b", fontSize: 14 }}>총 {documents.length}건</div>
              </div>

              <div style={{ marginTop: 20, display: "grid", gap: 14 }}>
                {documents.map((doc) => {
                  const currentLine = doc.currentLineIndex == null ? null : doc.lines.find((item) => item.sequence === doc.currentLineIndex) ?? null;
                  return (
                    <article
                      key={doc.id}
                      style={{
                        borderRadius: 24,
                        padding: 20,
                        background: doc.status === "submitted" ? "#f8fafc" : "#fff",
                        border: "1px solid #dbe4ec",
                        display: "grid",
                        gap: 14,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                        <div>
                          <div style={{ fontSize: 12, color: "#0f766e", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>{doc.status}</div>
                          <div style={{ marginTop: 8, fontSize: 24, fontWeight: 800, letterSpacing: "-0.03em" }}>{doc.title}</div>
                        </div>
                        <div
                          style={{
                            padding: "8px 12px",
                            borderRadius: 999,
                            background: "#eff6ff",
                            color: "#1d4ed8",
                            fontSize: 13,
                            fontWeight: 700,
                          }}
                        >
                          작성자 {doc.creatorUserName}
                        </div>
                      </div>
                      <div style={{ color: "#475569", lineHeight: 1.65 }}>
                        현재 결재선: {currentLine ? `${currentLine.approverUserName} / ${currentLine.status}` : "대기 없음"}
                        {currentLine?.comment ? ` / ${currentLine.comment}` : ""}
                      </div>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                        {doc.status === "draft" && canAct.submit && doc.creatorUserId === me?.userId && (
                          <button
                            onClick={() => openApprovalAction("submit", doc)}
                            disabled={loading}
                            style={{ height: 42, borderRadius: 14, border: 0, padding: "0 14px", background: "#0f766e", color: "#fff", fontWeight: 700, cursor: "pointer" }}
                          >
                            상신
                          </button>
                        )}
                        {doc.status === "submitted" && doc.creatorUserId === me?.userId && canAct.withdraw && (
                          <button
                            onClick={() => openApprovalAction("withdraw", doc)}
                            disabled={loading}
                            style={{ height: 42, borderRadius: 14, border: "1px solid #cbd5e1", padding: "0 14px", background: "#fff", fontWeight: 700, cursor: "pointer" }}
                          >
                            회수
                          </button>
                        )}
                        {doc.status === "rejected" && doc.creatorUserId === me?.userId && canAct.rework && (
                          <button
                            onClick={() => openApprovalAction("redraft", doc)}
                            disabled={loading}
                            style={{ height: 42, borderRadius: 14, border: "1px solid #cbd5e1", padding: "0 14px", background: "#fff", fontWeight: 700, cursor: "pointer" }}
                          >
                            재기안
                          </button>
                        )}
                        {doc.status === "submitted" && canAct.act && isCurrentApprovalActor(doc) && (
                          <>
                            <button
                              onClick={() => openApprovalAction("approve", doc)}
                              disabled={loading}
                              style={{ height: 42, borderRadius: 14, border: 0, padding: "0 14px", background: "#14532d", color: "#fff", fontWeight: 700, cursor: "pointer" }}
                            >
                              승인
                            </button>
                            <button
                              onClick={() => openApprovalAction("reject", doc)}
                              disabled={loading}
                              style={{ height: 42, borderRadius: 14, border: 0, padding: "0 14px", background: "#9f1239", color: "#fff", fontWeight: 700, cursor: "pointer" }}
                            >
                              반려
                            </button>
                          </>
                        )}
                      </div>
                    </article>
                  );
                })}

                {documents.length === 0 ? (
                  <div
                    style={{
                      padding: 20,
                      borderRadius: 22,
                      border: "1px dashed #cbd5e1",
                      color: "#64748b",
                      background: "#f8fafc",
                    }}
                  >
                    아직 문서가 없습니다.
                  </div>
                ) : null}
              </div>
            </section>
          </section>
        </div>
      )}

      {renderApprovalActionPopup()}
<ToastViewport items={feedbackItems} onDismiss={dismissFeedback} />
    </main>
  );
}
