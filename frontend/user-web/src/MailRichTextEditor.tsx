import { Component, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent as ReactClipboardEvent, type DragEvent as ReactDragEvent, type ErrorInfo, type ReactNode } from "react";
import type { Editor, JSONContent } from "@tiptap/core";
import FileHandler from "@tiptap/extension-file-handler";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { TableKit } from "@tiptap/extension-table";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyleKit } from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

import { InlineImageRegistry, type InlineImageDraft } from "./mailInlineImages";
import { projectMailDocument } from "./mailRichText";
import "./mail-rich-text-editor.css";

export type MailRichTextEditorProps = {
  value: JSONContent;
  onChange: (value: JSONContent) => void;
  onUploadImage: (file: File) => Promise<InlineImageDraft>;
  onError: (message: string) => void;
  resolveInlineImageUrl?: (contentId: string) => string | undefined;
  disabled?: boolean;
};

type RuntimeProps = MailRichTextEditorProps & { lifecycleKey: number };
type PendingImage = { draft: InlineImageDraft; fallbackAlt: string };

const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_COUNT = 5;
const FONT_FAMILIES = ["맑은 고딕", "Arial", "Georgia", "Times New Roman", "monospace"];
const FONT_SIZES = ["10px", "12px", "14px", "16px", "18px", "24px", "32px"];
const LINE_HEIGHTS = ["1", "1.15", "1.5", "1.75", "2"];
const SAFE_LINK_PATTERN = /^(?:https?:\/\/|mailto:)[^\u0000-\u001f\u007f\s]+$/i;
const SAFE_BLOB_URL_PATTERN = /^blob:[^\u0000-\u0020\u007f]+$/;

function resolveSafeBlobUrl(
  resolver: MailRichTextEditorProps["resolveInlineImageUrl"],
  contentId: string,
): string | undefined {
  if (!resolver) return undefined;
  try {
    const resolved = resolver(contentId);
    if (!resolved || !SAFE_BLOB_URL_PATTERN.test(resolved)) return undefined;
    return new URL(resolved).protocol === "blob:" ? resolved : undefined;
  } catch {
    return undefined;
  }
}

function documentKey(value: JSONContent): string {
  return JSON.stringify(value);
}

function countImages(value: JSONContent): number {
  let count = value.type === "image" ? 1 : 0;
  for (const child of value.content ?? []) count += countImages(child);
  return count;
}

function imageContentIds(value: JSONContent): Set<string> {
  const result = new Set<string>();
  if (value.type === "image" && typeof value.attrs?.contentId === "string") result.add(value.attrs.contentId);
  for (const child of value.content ?? []) {
    for (const contentId of imageContentIds(child)) result.add(contentId);
  }
  return result;
}

function sanitizeAltFallback(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^.]+$/, "");
  const sanitized = withoutExtension.replace(/[\u0000-\u001f\u007f/\\<>:"|?*]+/g, " ").replace(/\s+/g, " ").trim();
  return sanitized || "본문 이미지";
}

function sanitizePastedHtml(html: string): string {
  if (!html || typeof DOMParser === "undefined") return html;
  const document = new DOMParser().parseFromString(html, "text/html");
  document.querySelectorAll("img,script,style,iframe,object,embed,form,audio,video").forEach((node) => node.remove());
  document.querySelectorAll("*").forEach((element) => {
    for (const attribute of [...element.attributes]) {
      if (/^on/i.test(attribute.name) || /url\s*\(/i.test(attribute.value)) element.removeAttribute(attribute.name);
    }
  });
  return document.body.innerHTML;
}

function toolbarButton(
  editor: Editor | null,
  name: string,
  action: () => boolean,
  options: { active?: boolean; available?: boolean } = {},
) {
  const disabled = editor === null || !editor.isEditable || options.available === false;
  return (
    <button
      key={name}
      type="button"
      aria-label={name}
      aria-pressed={options.active}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        if (!disabled) action();
      }}
    >
      {name}
    </button>
  );
}

function SelectControl({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="mail-rich-text-editor__select">
      <span>{label}</span>
      <select aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        <option value="">기본</option>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

class EditorFailureBoundary extends Component<
  { children: ReactNode; onError: (message: string) => void; onRetry: () => void },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    this.props.onError("메일 본문 편집기를 초기화하지 못했습니다.");
  }

  render() {
    if (this.state.error) {
      return (
        <div className="mail-rich-text-editor__error" role="alert">
          <p>메일 본문 편집기를 초기화하지 못했습니다.</p>
          <button
            type="button"
            onClick={() => {
              this.setState({ error: null });
              this.props.onRetry();
            }}
          >
            편집기 다시 시도
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function MailRichTextEditorRuntime({ value, onChange, onUploadImage, onError, resolveInlineImageUrl, disabled = false, lifecycleKey }: RuntimeProps) {
  const registryRef = useRef(new InlineImageRegistry());
  const resolverRef = useRef(resolveInlineImageUrl);
  const uploadedContentIdsRef = useRef(new Set<string>());
  const reservedUploadsRef = useRef(0);
  const aliveRef = useRef(true);
  const generationRef = useRef(0);
  const appliedDocumentKeyRef = useRef(documentKey(value));
  const applyingExternalRef = useRef(false);
  const readyForChangesRef = useRef(false);
  const uploadFilesRef = useRef<(files: readonly File[]) => void>(() => undefined);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [altText, setAltText] = useState("");
  const [editorRevision, setEditorRevision] = useState(0);

  resolverRef.current = resolveInlineImageUrl;

  const moaworksImage = useMemo(() => Image.extend({
    addAttributes() {
      return {
        src: { default: null },
        contentId: { default: null },
        alt: { default: "본문 이미지" },
        width: { default: null },
        height: { default: null },
      };
    },
    parseHTML() {
      return [{
        tag: "img[src^=\"cid:\"]",
        getAttrs: (element) => {
          const src = (element as HTMLElement).getAttribute("src") ?? "";
          const contentId = src.slice(4);
          return contentId ? { src, contentId, alt: (element as HTMLElement).getAttribute("alt") || "본문 이미지" } : false;
        },
      }];
    },
    renderHTML({ node }) {
      const contentId = String(node.attrs.contentId ?? "");
      const preview = registryRef.current.get(contentId) ?? resolveSafeBlobUrl(resolverRef.current, contentId);
      return ["img", {
        src: preview ?? `cid:${contentId}`,
        alt: node.attrs.alt || "본문 이미지",
        width: node.attrs.width || undefined,
        height: node.attrs.height || undefined,
        "data-content-id": contentId,
      }];
    },
  }).configure({
    inline: true,
    allowBase64: false,
    resize: { enabled: true, minWidth: 40, minHeight: 40, alwaysPreserveAspectRatio: true },
  }), []);

  const editor = useEditor({
    immediatelyRender: false,
    content: value,
    editable: !disabled,
    extensions: [
      StarterKit.configure({ link: false, underline: false }),
      Underline,
      TextStyleKit,
      TextAlign.configure({ types: ["heading", "paragraph", "tableCell", "tableHeader"] }),
      Highlight.configure({ multicolor: true }),
      Link.configure({ openOnClick: false, autolink: false, linkOnPaste: false, protocols: ["http", "https", "mailto"] }),
      TableKit.configure({ table: { resizable: true, lastColumnResizable: false } }),
      moaworksImage,
      FileHandler.configure({
        allowedMimeTypes: [...ALLOWED_IMAGE_TYPES],
        consumePasteEvent: true,
        onPaste: (_editor, files) => uploadFilesRef.current(files),
        onDrop: (_editor, files) => uploadFilesRef.current(files),
      }),
    ],
    editorProps: {
      attributes: {
        class: "mail-rich-text-editor__surface",
        role: "textbox",
        "aria-label": "메일 본문",
        "aria-multiline": "true",
      },
      transformPastedHTML: sanitizePastedHtml,
      handlePaste: (_view, event) => {
        if (disabled) return true;
        const files = [...(event.clipboardData?.files ?? [])];
        if (files.length > 0) {
          uploadFilesRef.current(files);
          return true;
        }
        return false;
      },
      handleDrop: (_view, event) => {
        if (disabled) return true;
        const files = [...(event.dataTransfer?.files ?? [])];
        if (files.length > 0) {
          uploadFilesRef.current(files);
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      if (applyingExternalRef.current) return;
      const nextValue = currentEditor.getJSON();
      const nextKey = documentKey(nextValue);
      if (!readyForChangesRef.current) {
        appliedDocumentKeyRef.current = nextKey;
        return;
      }
      if (nextKey === appliedDocumentKeyRef.current) return;
      try {
        projectMailDocument(nextValue);
      } catch {
        onError("메일 본문에 허용되지 않은 내용이 포함되어 있습니다.");
        return;
      }
      appliedDocumentKeyRef.current = nextKey;
      const referenced = imageContentIds(nextValue);
      for (const contentId of [...uploadedContentIdsRef.current]) {
        if (!referenced.has(contentId)) {
          registryRef.current.delete(contentId);
          uploadedContentIdsRef.current.delete(contentId);
        }
      }
      onChange(nextValue);
    },
    onCreate: ({ editor: currentEditor }) => {
      appliedDocumentKeyRef.current = documentKey(currentEditor.getJSON());
    },
    onTransaction: () => setEditorRevision((value) => value + 1),
    onSelectionUpdate: () => setEditorRevision((value) => value + 1),
  }, [lifecycleKey]);

  const reportError = useCallback((message: string) => {
    if (aliveRef.current) onError(message);
  }, [onError]);

  const uploadFiles = useCallback((files: readonly File[]) => {
    if (!editor || disabled || files.length === 0) return;
    const seenFiles = new Set<string>();
    const uniqueFiles = files.filter((file) => {
      const signature = `${file.name}\u0000${file.type}\u0000${file.size}\u0000${file.lastModified}`;
      if (seenFiles.has(signature)) return false;
      seenFiles.add(signature);
      return true;
    });
    let reservedCount = countImages(editor.getJSON()) + reservedUploadsRef.current;
    const generation = generationRef.current;

    for (const file of uniqueFiles) {
      if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
        reportError("본문 이미지는 PNG, JPEG, WebP 파일만 사용할 수 있습니다.");
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        reportError("본문 이미지는 파일당 5 MiB 이하여야 합니다.");
        continue;
      }
      if (reservedCount >= MAX_IMAGE_COUNT) {
        reportError("본문 이미지는 최대 5개까지 삽입할 수 있습니다.");
        continue;
      }
      reservedCount += 1;
      reservedUploadsRef.current += 1;
      void onUploadImage(file).then((draft) => {
        if (!aliveRef.current || generationRef.current !== generation) {
          if (draft.objectUrl?.startsWith("blob:") && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(draft.objectUrl);
          return;
        }
        if (!draft.contentId?.trim() || !draft.objectUrl?.startsWith("blob:")) {
          reservedUploadsRef.current -= 1;
          if (draft.objectUrl?.startsWith("blob:") && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(draft.objectUrl);
          reportError("업로드된 본문 이미지 정보가 올바르지 않습니다.");
          return;
        }
        registryRef.current.set(draft.contentId, draft.objectUrl);
        uploadedContentIdsRef.current.add(draft.contentId);
        const pending = { draft, fallbackAlt: sanitizeAltFallback(draft.alt || draft.fileName || file.name) };
        setPendingImages((current) => [...current, pending]);
        setAltText((current) => current || pending.fallbackAlt);
      }).catch(() => {
        if (aliveRef.current && generationRef.current === generation) {
          reservedUploadsRef.current -= 1;
          reportError("본문 이미지 업로드에 실패했습니다. 다시 시도해 주세요.");
        }
      });
    }
  }, [disabled, editor, onUploadImage, reportError]);

  uploadFilesRef.current = uploadFiles;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      generationRef.current += 1;
      registryRef.current.clear();
      uploadedContentIdsRef.current.clear();
      reservedUploadsRef.current = 0;
    };
  }, []);

  useEffect(() => {
    if (!editor) return;
    appliedDocumentKeyRef.current = documentKey(editor.getJSON());
    readyForChangesRef.current = true;
    editor.setEditable(!disabled);
  }, [disabled, editor]);

  useEffect(() => {
    if (!editor) return;
    const nextKey = documentKey(value);
    if (nextKey === appliedDocumentKeyRef.current) return;
    generationRef.current += 1;
    registryRef.current.clear();
    uploadedContentIdsRef.current.clear();
    reservedUploadsRef.current = 0;
    setPendingImages([]);
    setAltText("");
    applyingExternalRef.current = true;
    try {
      editor.commands.setContent(value, { emitUpdate: false, errorOnInvalidContent: true });
      appliedDocumentKeyRef.current = nextKey;
    } catch {
      reportError("메일 본문을 편집기에 불러오지 못했습니다.");
    } finally {
      applyingExternalRef.current = false;
    }
  }, [editor, reportError, value]);

  useEffect(() => {
    if (!editor) return;
    editor.view.dom.querySelectorAll<HTMLImageElement>("img[contentid], img[data-content-id]").forEach((image) => {
      const contentId = image.getAttribute("contentid") ?? image.getAttribute("data-content-id") ?? "";
      if (!contentId) return;
      const preview = registryRef.current.get(contentId) ?? resolveSafeBlobUrl(resolverRef.current, contentId);
      const nextSource = preview ?? `cid:${contentId}`;
      if (image.getAttribute("src") !== nextSource) image.setAttribute("src", nextSource);
    });
  }, [editor, editorRevision, resolveInlineImageUrl, value]);

  const commandDisabled = !editor || !editor.isEditable;
  const tableActive = Boolean(editor?.isActive("table"));
  const run = (callback: (chain: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>) =>
    editor ? callback(editor.chain().focus()).run() : false;

  const insertPendingImage = () => {
    if (!editor || disabled || pendingImages.length === 0) return;
    const pending = pendingImages[0];
    const alt = altText.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim() || pending.fallbackAlt;
    const inserted = editor.chain().focus().insertContent({
      type: "image",
      attrs: { src: `cid:${pending.draft.contentId}`, contentId: pending.draft.contentId, alt, width: null, height: null },
    }).run();
    if (!inserted) {
      reportError("본문 이미지를 편집기에 삽입하지 못했습니다.");
      return;
    }
    const remaining = pendingImages.slice(1);
    reservedUploadsRef.current -= 1;
    setPendingImages(remaining);
    setAltText(remaining[0]?.fallbackAlt ?? "");
  };

  const setLink = () => {
    if (!editor || disabled) return false;
    const current = String(editor.getAttributes("link").href ?? "");
    const href = window.prompt("링크 주소를 입력하세요. (http, https, mailto)", current);
    if (href === null) return false;
    if (!SAFE_LINK_PATTERN.test(href)) {
      reportError("링크는 http, https, mailto 주소만 사용할 수 있습니다.");
      return false;
    }
    return editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
  };

  return (
    <div className="mail-rich-text-editor" data-disabled={disabled || undefined} style={{ containerType: "inline-size" }}>
      <div className="mail-rich-text-editor__toolbar" role="toolbar" aria-label="메일 본문 서식">
        <SelectControl label="글꼴" value={String(editor?.getAttributes("textStyle").fontFamily ?? "")} options={FONT_FAMILIES} disabled={commandDisabled} onChange={(value) => { if (value) run((chain) => chain.setFontFamily(value)); else run((chain) => chain.unsetFontFamily()); }} />
        <SelectControl label="글자 크기" value={String(editor?.getAttributes("textStyle").fontSize ?? "")} options={FONT_SIZES} disabled={commandDisabled} onChange={(value) => { if (value) run((chain) => chain.setFontSize(value)); else run((chain) => chain.unsetFontSize()); }} />
        <SelectControl label="줄 간격" value={String(editor?.getAttributes("textStyle").lineHeight ?? "")} options={LINE_HEIGHTS} disabled={commandDisabled} onChange={(value) => { if (value) run((chain) => chain.setLineHeight(value)); else run((chain) => chain.unsetLineHeight()); }} />
        <label className="mail-rich-text-editor__color">글자색<input aria-label="글자색" type="color" disabled={commandDisabled} onChange={(event) => run((chain) => chain.setColor(event.target.value))} /></label>
        <label className="mail-rich-text-editor__color">배경색<input aria-label="배경색" type="color" disabled={commandDisabled} onChange={(event) => run((chain) => chain.toggleHighlight({ color: event.target.value }))} /></label>
        {toolbarButton(editor, "일반 문단", () => run((chain) => chain.setParagraph()), { active: Boolean(editor?.isActive("paragraph")) })}
        {([1, 2, 3] as const).map((level) => toolbarButton(editor, `제목 ${level}`, () => run((chain) => chain.toggleHeading({ level })), { active: Boolean(editor?.isActive("heading", { level })) }))}
        {toolbarButton(editor, "굵게", () => run((chain) => chain.toggleBold()), { active: Boolean(editor?.isActive("bold")) })}
        {toolbarButton(editor, "기울임", () => run((chain) => chain.toggleItalic()), { active: Boolean(editor?.isActive("italic")) })}
        {toolbarButton(editor, "밑줄", () => run((chain) => chain.toggleUnderline()), { active: Boolean(editor?.isActive("underline")) })}
        {toolbarButton(editor, "취소선", () => run((chain) => chain.toggleStrike()), { active: Boolean(editor?.isActive("strike")) })}
        {(["left", "center", "right", "justify"] as const).map((alignment, index) => toolbarButton(editor, ["왼쪽 정렬", "가운데 정렬", "오른쪽 정렬", "양쪽 정렬"][index], () => run((chain) => chain.setTextAlign(alignment)), { active: Boolean(editor?.isActive({ textAlign: alignment })) }))}
        {toolbarButton(editor, "글머리표", () => run((chain) => chain.toggleBulletList()), { active: Boolean(editor?.isActive("bulletList")) })}
        {toolbarButton(editor, "번호 목록", () => run((chain) => chain.toggleOrderedList()), { active: Boolean(editor?.isActive("orderedList")) })}
        {toolbarButton(editor, "들여쓰기", () => run((chain) => chain.sinkListItem("listItem")), { available: Boolean(editor?.can().sinkListItem("listItem")) })}
        {toolbarButton(editor, "내어쓰기", () => run((chain) => chain.liftListItem("listItem")), { available: Boolean(editor?.can().liftListItem("listItem")) })}
        {toolbarButton(editor, "인용문", () => run((chain) => chain.toggleBlockquote()), { active: Boolean(editor?.isActive("blockquote")) })}
        {toolbarButton(editor, "가로 구분선", () => run((chain) => chain.setHorizontalRule()))}
        {toolbarButton(editor, "링크 설정", setLink, { active: Boolean(editor?.isActive("link")) })}
        {toolbarButton(editor, "링크 해제", () => run((chain) => chain.extendMarkRange("link").unsetLink()), { available: Boolean(editor?.isActive("link")) })}
        {toolbarButton(editor, "실행 취소", () => run((chain) => chain.undo()), { available: Boolean(editor?.can().undo()) })}
        {toolbarButton(editor, "다시 실행", () => run((chain) => chain.redo()), { available: Boolean(editor?.can().redo()) })}
        {toolbarButton(editor, "서식 제거", () => run((chain) => chain.unsetAllMarks().clearNodes()))}
        {toolbarButton(editor, "표 삽입", () => run((chain) => chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true })))}
        {toolbarButton(editor, "행 앞에 추가", () => run((chain) => chain.addRowBefore()), { available: tableActive })}
        {toolbarButton(editor, "행 뒤에 추가", () => run((chain) => chain.addRowAfter()), { available: tableActive })}
        {toolbarButton(editor, "행 삭제", () => run((chain) => chain.deleteRow()), { available: tableActive })}
        {toolbarButton(editor, "열 앞에 추가", () => run((chain) => chain.addColumnBefore()), { available: tableActive })}
        {toolbarButton(editor, "열 뒤에 추가", () => run((chain) => chain.addColumnAfter()), { available: tableActive })}
        {toolbarButton(editor, "열 삭제", () => run((chain) => chain.deleteColumn()), { available: tableActive })}
        {toolbarButton(editor, "셀 병합", () => run((chain) => chain.mergeCells()), { available: tableActive && Boolean(editor?.can().mergeCells()) })}
        {toolbarButton(editor, "셀 분할", () => run((chain) => chain.splitCell()), { available: tableActive && Boolean(editor?.can().splitCell()) })}
        {toolbarButton(editor, "머리글 행 전환", () => run((chain) => chain.toggleHeaderRow()), { available: tableActive })}
        {toolbarButton(editor, "표 삭제", () => run((chain) => chain.deleteTable()), { available: tableActive })}
        <label className="mail-rich-text-editor__file-button">
          본문 이미지
          <input
            type="file"
            aria-label="본문 이미지 선택"
            accept="image/png,image/jpeg,image/webp"
            multiple
            disabled={commandDisabled}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              uploadFiles([...(event.target.files ?? [])]);
              event.target.value = "";
            }}
          />
        </label>
      </div>
      <div
        className="mail-rich-text-editor__content"
        onPasteCapture={(event: ReactClipboardEvent<HTMLDivElement>) => {
          const files = [...event.clipboardData.files];
          if (files.length === 0) return;
          event.preventDefault();
          event.stopPropagation();
          uploadFiles(files);
        }}
        onDropCapture={(event: ReactDragEvent<HTMLDivElement>) => {
          const files = [...event.dataTransfer.files];
          if (files.length === 0) return;
          event.preventDefault();
          event.stopPropagation();
          uploadFiles(files);
        }}
      >
        <EditorContent editor={editor} />
      </div>
      {pendingImages.length > 0 && (
        <div className="mail-rich-text-editor__image-alt" role="group" aria-label="본문 이미지 대체 텍스트">
          <label>이미지 대체 텍스트<input aria-label="이미지 대체 텍스트" value={altText} disabled={disabled} onChange={(event) => setAltText(event.target.value)} /></label>
          <button type="button" disabled={disabled} onClick={insertPendingImage}>이미지 삽입</button>
        </div>
      )}
    </div>
  );
}

export function MailRichTextEditor(props: MailRichTextEditorProps) {
  const [lifecycleKey, setLifecycleKey] = useState(0);
  const validationError = useMemo(() => {
    try {
      projectMailDocument(props.value);
      return null;
    } catch {
      return "메일 본문 문서 형식이 올바르지 않습니다.";
    }
  }, [props.value]);

  useEffect(() => {
    if (validationError) props.onError(validationError);
  }, [props, validationError]);

  if (validationError) {
    return <div className="mail-rich-text-editor__error" role="alert">{validationError}</div>;
  }

  return (
    <EditorFailureBoundary onError={props.onError} onRetry={() => setLifecycleKey((value) => value + 1)}>
      <MailRichTextEditorRuntime key={lifecycleKey} {...props} lifecycleKey={lifecycleKey} />
    </EditorFailureBoundary>
  );
}
