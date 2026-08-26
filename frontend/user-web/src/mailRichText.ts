import type { JSONContent } from "@tiptap/core";

export type MailDocumentProjection = {
  bodyHtml: string;
  bodyText: string;
  contentIds: string[];
};

export type TranslationSegment = {
  id: string;
  text: string;
};

type JsonRecord = Record<string, unknown>;

const allowedNodeTypes = new Set([
  "doc",
  "paragraph",
  "heading",
  "text",
  "hardBreak",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "horizontalRule",
  "table",
  "tableRow",
  "tableHeader",
  "tableCell",
  "image",
]);

const allowedMarkTypes = new Set(["bold", "italic", "underline", "strike", "textStyle", "highlight", "link"]);
const blockNodeTypes = new Set(["paragraph", "heading", "bulletList", "orderedList", "blockquote", "horizontalRule", "table", "image"]);
const allowedChildrenByParent: Record<string, ReadonlySet<string>> = {
  doc: blockNodeTypes,
  paragraph: new Set(["text", "hardBreak", "image"]),
  heading: new Set(["text", "hardBreak"]),
  bulletList: new Set(["listItem"]),
  orderedList: new Set(["listItem"]),
  listItem: blockNodeTypes,
  blockquote: blockNodeTypes,
  table: new Set(["tableRow"]),
  tableRow: new Set(["tableHeader", "tableCell"]),
  tableHeader: blockNodeTypes,
  tableCell: blockNodeTypes,
};
const allowedFonts = new Set(["맑은 고딕", "Arial", "Georgia", "Times New Roman", "monospace"]);
const allowedFontSizes = new Set(["10px", "12px", "14px", "16px", "18px", "24px", "32px"]);
const allowedLineHeights = new Set(["1", "1.15", "1.5", "1.75", "2"]);
const allowedTextAlignments = new Set(["left", "center", "right", "justify"]);
const colorPattern = /^(?:#[0-9a-f]{6}|rgb\(\s*(?:25[0-5]|2[0-4]\d|1?\d?\d)\s*,\s*(?:25[0-5]|2[0-4]\d|1?\d?\d)\s*,\s*(?:25[0-5]|2[0-4]\d|1?\d?\d)\s*\))$/i;
const contentIdPattern = /^(?!.*\.\.)[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~]+(?:\.[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertOnlyKeys(value: JsonRecord, allowed: ReadonlySet<string>, context: string) {
  for (const [key, item] of Object.entries(value)) {
    if (!allowed.has(key) && item !== null && item !== undefined) {
      throw new Error(`${context}에 허용되지 않은 속성이 있습니다.`);
    }
  }
}

function readAttrs(node: JSONContent): JsonRecord {
  if (node.attrs === undefined || node.attrs === null) {
    return {};
  }
  if (!isRecord(node.attrs)) {
    throw new Error("노드 속성 형식이 올바르지 않습니다.");
  }
  return node.attrs;
}

function readPositiveInteger(value: unknown, name: string, maximum: number): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    throw new Error(`${name} 값이 허용 범위를 벗어났습니다.`);
  }
  return value as number;
}

function readSafeColor(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string" || !colorPattern.test(value)) {
    throw new Error(`${name} 값이 안전하지 않습니다.`);
  }
  return value;
}

function readSafeHref(value: unknown): string {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f\s]/.test(value)) {
    throw new Error("링크 주소가 안전하지 않습니다.");
  }
  if (!/^(?:https?:\/\/|mailto:)/i.test(value)) {
    throw new Error("허용되지 않은 링크 형식입니다.");
  }
  try {
    const parsed = new URL(value);
    if (!["http:", "https:", "mailto:"].includes(parsed.protocol)) {
      throw new Error("허용되지 않은 링크 형식입니다.");
    }
  } catch {
    throw new Error("링크 주소가 올바르지 않습니다.");
  }
  return value;
}

function validateMark(mark: unknown) {
  if (!isRecord(mark) || typeof mark.type !== "string" || !allowedMarkTypes.has(mark.type)) {
    throw new Error("허용되지 않은 텍스트 서식입니다.");
  }
  assertOnlyKeys(mark, new Set(["type", "attrs"]), "텍스트 서식");
  const attrs = mark.attrs === undefined || mark.attrs === null ? {} : mark.attrs;
  if (!isRecord(attrs)) {
    throw new Error("텍스트 서식 속성 형식이 올바르지 않습니다.");
  }

  if (["bold", "italic", "underline", "strike"].includes(mark.type)) {
    assertOnlyKeys(attrs, new Set(), mark.type);
    return;
  }
  if (mark.type === "link") {
    assertOnlyKeys(attrs, new Set(["href", "target", "rel", "class"]), "link");
    readSafeHref(attrs.href);
    for (const key of ["target", "rel", "class"] as const) {
      if (attrs[key] !== undefined && attrs[key] !== null) {
        throw new Error(`link ${key} 속성은 허용되지 않습니다.`);
      }
    }
    return;
  }
  if (mark.type === "highlight") {
    assertOnlyKeys(attrs, new Set(["color"]), "highlight");
    readSafeColor(attrs.color, "배경색");
    return;
  }

  assertOnlyKeys(attrs, new Set(["fontFamily", "fontSize", "lineHeight", "color"]), "textStyle");
  if (attrs.fontFamily !== undefined && attrs.fontFamily !== null && !allowedFonts.has(String(attrs.fontFamily))) {
    throw new Error("허용되지 않은 글꼴입니다.");
  }
  if (attrs.fontSize !== undefined && attrs.fontSize !== null && !allowedFontSizes.has(String(attrs.fontSize))) {
    throw new Error("허용되지 않은 글자 크기입니다.");
  }
  if (attrs.lineHeight !== undefined && attrs.lineHeight !== null && !allowedLineHeights.has(String(attrs.lineHeight))) {
    throw new Error("허용되지 않은 줄 간격입니다.");
  }
  readSafeColor(attrs.color, "글자색");
}

function validateNode(node: unknown, path: number[], contentIds: Set<string>, parentType?: string) {
  if (!isRecord(node) || typeof node.type !== "string" || !allowedNodeTypes.has(node.type)) {
    throw new Error(`허용되지 않은 문서 노드입니다: ${path.join(".") || "root"}`);
  }
  if (parentType !== undefined && !allowedChildrenByParent[parentType]?.has(node.type)) {
    throw new Error(`문서 노드 배치가 허용된 editor schema와 일치하지 않습니다: ${path.join(".")}`);
  }
  assertOnlyKeys(node, new Set(["type", "attrs", "content", "marks", "text"]), "문서 노드");

  if (node.type === "text") {
    if (typeof node.text !== "string" || node.content !== undefined || node.attrs !== undefined) {
      throw new Error("텍스트 노드 형식이 올바르지 않습니다.");
    }
    if (node.marks !== undefined) {
      if (!Array.isArray(node.marks)) {
        throw new Error("텍스트 서식 목록 형식이 올바르지 않습니다.");
      }
      node.marks.forEach(validateMark);
    }
    return;
  }

  if (node.text !== undefined || node.marks !== undefined) {
    throw new Error("텍스트가 아닌 노드에 텍스트 속성이 있습니다.");
  }
  const typedNode = node as JSONContent;
  const attrs = readAttrs(typedNode);

  if (node.type === "doc") {
    assertOnlyKeys(attrs, new Set(), "doc");
  } else if (["paragraph", "blockquote"].includes(node.type)) {
    assertOnlyKeys(attrs, new Set(["textAlign"]), node.type);
    if (attrs.textAlign !== undefined && attrs.textAlign !== null && !allowedTextAlignments.has(String(attrs.textAlign))) {
      throw new Error("허용되지 않은 문단 정렬입니다.");
    }
  } else if (node.type === "heading") {
    assertOnlyKeys(attrs, new Set(["level", "textAlign"]), "heading");
    if (![1, 2, 3].includes(attrs.level as number)) {
      throw new Error("허용되지 않은 제목 단계입니다.");
    }
    if (attrs.textAlign !== undefined && attrs.textAlign !== null && !allowedTextAlignments.has(String(attrs.textAlign))) {
      throw new Error("허용되지 않은 제목 정렬입니다.");
    }
  } else if (node.type === "orderedList") {
    assertOnlyKeys(attrs, new Set(["start"]), "orderedList");
    readPositiveInteger(attrs.start, "목록 시작 번호", 1_000_000);
  } else if (["tableCell", "tableHeader"].includes(node.type)) {
    assertOnlyKeys(attrs, new Set(["colspan", "rowspan", "textAlign", "colwidth"]), node.type);
    readPositiveInteger(attrs.colspan, "열 병합", 100);
    readPositiveInteger(attrs.rowspan, "행 병합", 100);
    if (attrs.colwidth !== undefined && attrs.colwidth !== null) {
      if (!Array.isArray(attrs.colwidth) || attrs.colwidth.some((item) => !Number.isInteger(item) || item < 1 || item > 4096)) {
        throw new Error("표 열 너비가 안전하지 않습니다.");
      }
    }
    if (attrs.textAlign !== undefined && attrs.textAlign !== null && !allowedTextAlignments.has(String(attrs.textAlign))) {
      throw new Error("허용되지 않은 표 정렬입니다.");
    }
  } else if (node.type === "image") {
    assertOnlyKeys(attrs, new Set(["contentId", "src", "alt", "width", "height", "title"]), "image");
    if (typeof attrs.contentId !== "string" || !contentIdPattern.test(attrs.contentId)) {
      throw new Error("본문 이미지 CID가 올바르지 않습니다.");
    }
    if (contentIds.has(attrs.contentId)) {
      throw new Error("중복 본문 이미지 CID는 허용되지 않습니다.");
    }
    contentIds.add(attrs.contentId);
    if (attrs.src !== undefined && attrs.src !== null && attrs.src !== `cid:${attrs.contentId}`) {
      throw new Error("본문 이미지는 CID 경로만 사용할 수 있습니다.");
    }
    if (attrs.alt !== undefined && attrs.alt !== null && typeof attrs.alt !== "string") {
      throw new Error("이미지 대체 텍스트 형식이 올바르지 않습니다.");
    }
    if (attrs.title !== undefined && attrs.title !== null) {
      throw new Error("이미지 title 속성은 허용되지 않습니다.");
    }
    readPositiveInteger(attrs.width, "이미지 너비", 4096);
    readPositiveInteger(attrs.height, "이미지 높이", 4096);
  } else {
    assertOnlyKeys(attrs, new Set(), node.type);
  }

  if (node.type === "image" || node.type === "hardBreak" || node.type === "horizontalRule") {
    if (node.content !== undefined) {
      throw new Error(`${node.type} 노드는 하위 내용을 가질 수 없습니다.`);
    }
    return;
  }
  if (node.content !== undefined && !Array.isArray(node.content)) {
    throw new Error("문서 하위 내용 형식이 올바르지 않습니다.");
  }
  (node.content ?? []).forEach((child, index) => validateNode(child, [...path, index], contentIds, node.type as string));
}

function validateDocument(doc: JSONContent): string[] {
  const contentIds = new Set<string>();
  validateNode(doc, [], contentIds);
  if (doc.type !== "doc" || !Array.isArray(doc.content)) {
    throw new Error("메일 문서는 content 배열이 있는 doc 노드여야 합니다.");
  }
  return [...contentIds];
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return entities[character];
  });
}

function styleAttribute(styles: Array<[string, string | undefined]>): string {
  const value = styles.filter((item): item is [string, string] => Boolean(item[1])).map(([name, item]) => `${name}:${item}`).join(";");
  return value ? ` style="${escapeHtml(value)}"` : "";
}

function nodeTextAlignStyle(attrs: JsonRecord): string {
  return styleAttribute([["text-align", attrs.textAlign === null || attrs.textAlign === undefined ? undefined : String(attrs.textAlign)]]);
}

function renderMarkedText(text: string, marks: unknown[] | undefined): string {
  let html = escapeHtml(text);
  for (const rawMark of marks ?? []) {
    const mark = rawMark as JsonRecord;
    const attrs = (isRecord(mark.attrs) ? mark.attrs : {}) as JsonRecord;
    if (mark.type === "bold") html = `<strong>${html}</strong>`;
    else if (mark.type === "italic") html = `<em>${html}</em>`;
    else if (mark.type === "underline") html = `<u>${html}</u>`;
    else if (mark.type === "strike") html = `<s>${html}</s>`;
    else if (mark.type === "link") html = `<a href="${escapeHtml(String(attrs.href))}" rel="noopener noreferrer">${html}</a>`;
    else if (mark.type === "highlight") html = `<span${styleAttribute([["background-color", attrs.color ? String(attrs.color) : undefined]])}>${html}</span>`;
    else if (mark.type === "textStyle") {
      html = `<span${styleAttribute([
        ["font-family", attrs.fontFamily ? String(attrs.fontFamily) : undefined],
        ["font-size", attrs.fontSize ? String(attrs.fontSize) : undefined],
        ["line-height", attrs.lineHeight ? String(attrs.lineHeight) : undefined],
        ["color", attrs.color ? String(attrs.color) : undefined],
      ])}>${html}</span>`;
    }
  }
  return html;
}

function renderHtml(node: JSONContent): string {
  if (node.type === "text") {
    return renderMarkedText(node.text ?? "", node.marks);
  }
  const attrs = readAttrs(node);
  const children = (node.content ?? []).map(renderHtml).join("");
  switch (node.type) {
    case "doc": return children;
    case "paragraph": return `<p${nodeTextAlignStyle(attrs)}>${children}</p>`;
    case "heading": return `<h${attrs.level}${nodeTextAlignStyle(attrs)}>${children}</h${attrs.level}>`;
    case "hardBreak": return "<br>";
    case "bulletList": return `<ul>${children}</ul>`;
    case "orderedList": return `<ol${attrs.start && attrs.start !== 1 ? ` start="${attrs.start}"` : ""}>${children}</ol>`;
    case "listItem": return `<li>${children}</li>`;
    case "blockquote": return `<blockquote${nodeTextAlignStyle(attrs)}>${children}</blockquote>`;
    case "horizontalRule": return "<hr>";
    case "table": return `<table>${children}</table>`;
    case "tableRow": return `<tr>${children}</tr>`;
    case "tableHeader":
    case "tableCell": {
      const tag = node.type === "tableHeader" ? "th" : "td";
      const colspan = attrs.colspan && attrs.colspan !== 1 ? ` colspan="${attrs.colspan}"` : "";
      const rowspan = attrs.rowspan && attrs.rowspan !== 1 ? ` rowspan="${attrs.rowspan}"` : "";
      return `<${tag}${colspan}${rowspan}${nodeTextAlignStyle(attrs)}>${children}</${tag}>`;
    }
    case "image": {
      const alt = typeof attrs.alt === "string" && attrs.alt.trim() ? attrs.alt.trim() : "본문 이미지";
      const width = attrs.width ? ` width="${attrs.width}"` : "";
      const height = attrs.height ? ` height="${attrs.height}"` : "";
      return `<img src="cid:${escapeHtml(String(attrs.contentId))}" alt="${escapeHtml(alt)}"${width}${height}>`;
    }
    default: throw new Error("허용되지 않은 문서 노드입니다.");
  }
}

function renderPlain(node: JSONContent): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "image") {
    const attrs = readAttrs(node);
    const alt = typeof attrs.alt === "string" && attrs.alt.trim() ? attrs.alt.trim() : "본문 이미지";
    return `[이미지: ${alt}]`;
  }
  if (node.type === "hardBreak") return "\n";
  if (node.type === "horizontalRule") return "---";
  if (node.type === "bulletList" || node.type === "orderedList") {
    const start = node.type === "orderedList" ? Number(readAttrs(node).start ?? 1) : 1;
    return (node.content ?? []).map((item, index) => `${node.type === "bulletList" ? "-" : `${start + index}.`} ${renderPlain(item)}`).join("\n");
  }
  if (node.type === "table") return (node.content ?? []).map(renderPlain).join("\n");
  if (node.type === "tableRow") return (node.content ?? []).map(renderPlain).join("\t");
  const children = (node.content ?? []).map(renderPlain).join("");
  if (node.type === "doc") return (node.content ?? []).map(renderPlain).join("\n");
  return children;
}

function normalizePlainText(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function cloneDocument(doc: JSONContent): JSONContent {
  return structuredClone(doc);
}

function collectTextNodes(node: JSONContent, path: number[], segments: TranslationSegment[]) {
  if (node.type === "text") {
    segments.push({ id: path.join("."), text: node.text ?? "" });
    return;
  }
  (node.content ?? []).forEach((child, index) => collectTextNodes(child, [...path, index], segments));
}

function replaceTextNodes(node: JSONContent, path: number[], replacements: ReadonlyMap<string, string>) {
  if (node.type === "text") {
    node.text = replacements.get(path.join("."));
    return;
  }
  (node.content ?? []).forEach((child, index) => replaceTextNodes(child, [...path, index], replacements));
}

export function projectMailDocument(doc: JSONContent): MailDocumentProjection {
  const contentIds = validateDocument(doc);
  return {
    bodyHtml: renderHtml(doc),
    bodyText: normalizePlainText(renderPlain(doc)),
    contentIds,
  };
}

export function extractTranslationSegments(doc: JSONContent): { document: JSONContent; segments: TranslationSegment[] } {
  validateDocument(doc);
  const segments: TranslationSegment[] = [];
  collectTextNodes(doc, [], segments);
  return { document: cloneDocument(doc), segments };
}

export function applyTranslatedSegments(doc: JSONContent, items: TranslationSegment[]): JSONContent {
  validateDocument(doc);
  const expected: TranslationSegment[] = [];
  collectTextNodes(doc, [], expected);
  if (!Array.isArray(items) || items.length !== expected.length) {
    throw new Error("번역 구간 수가 원문과 일치하지 않습니다.");
  }
  const seen = new Set<string>();
  items.forEach((item, index) => {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.text !== "string") {
      throw new Error("번역 구간 형식이 올바르지 않습니다.");
    }
    if (seen.has(item.id) || item.id !== expected[index].id) {
      throw new Error("번역 구간 식별자 또는 순서가 원문과 일치하지 않습니다.");
    }
    seen.add(item.id);
  });

  const result = cloneDocument(doc);
  replaceTextNodes(result, [], new Map(items.map((item) => [item.id, item.text])));
  return result;
}
