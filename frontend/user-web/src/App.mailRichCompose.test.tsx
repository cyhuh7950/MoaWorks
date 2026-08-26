// @vitest-environment jsdom
import type { JSONContent } from "@tiptap/core";
import { describe, expect, it, vi } from "vitest";
import * as app from "./App";
import * as outgoingTranslation from "./mailOutgoingTranslation";
import { projectMailDocument } from "./mailRichText";

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
});
