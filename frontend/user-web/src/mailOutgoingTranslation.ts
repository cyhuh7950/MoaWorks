export const OUTGOING_TRANSLATION_LOCALES = [
  { value: "ko", label: "한국어" },
  { value: "en", label: "영어" },
  { value: "ja", label: "일본어" },
  { value: "zh-cn", label: "중국어(간체)" },
  { value: "es", label: "스페인어" },
  { value: "fr", label: "프랑스어" },
  { value: "de", label: "독일어" },
] as const;

const SUPPORTED_LOCALES = new Set(OUTGOING_TRANSLATION_LOCALES.map((item) => item.value));
const LOCALE_ALIASES: Record<string, string> = {
  "ko-kr": "ko",
  "en-us": "en",
  "en-gb": "en",
  "ja-jp": "ja",
  "zh-hans": "zh-cn",
};

export function normalizeOutgoingTranslationLocale(value?: string | null): string {
  const normalized = value?.trim().toLowerCase() ?? "";
  const resolved = LOCALE_ALIASES[normalized] ?? normalized;
  return SUPPORTED_LOCALES.has(resolved as (typeof OUTGOING_TRANSLATION_LOCALES)[number]["value"])
    ? resolved
    : "en";
}

export function buildOutgoingTranslationTexts(
  form: { subject: string; bodyText: string },
  targetLocale: string,
): Array<{ text: string; sourceLocale: "auto"; targetLocale: string }> {
  const target = normalizeOutgoingTranslationLocale(targetLocale);
  return [form.subject.trim(), form.bodyText.trim()]
    .filter(Boolean)
    .map((text) => ({ text, sourceLocale: "auto" as const, targetLocale: target }));
}

export function applyOutgoingTranslationPreview<T extends { subject: string; bodyText: string }>(
  current: T,
  preview: { subject: string; body: string },
): T {
  return { ...current, subject: preview.subject, bodyText: preview.body };
}

type RichTranslationSegment = { id: string; text: string };

export function createOutgoingRichTranslationPlan<TDocument>(input: {
  subject: string;
  bodyDocument: TDocument;
  targetLocale: string;
  extractSegments: (document: TDocument) => { segments: RichTranslationSegment[] };
}) {
  const segments = input.extractSegments(input.bodyDocument).segments;
  if (segments.some((segment) => !segment.text.trim())) throw new Error("빈 본문 번역 구간은 허용되지 않습니다.");
  const subject = input.subject.trim();
  const targetLocale = normalizeOutgoingTranslationLocale(input.targetLocale);
  return {
    texts: [subject, ...segments.map((segment) => segment.text)].filter(Boolean).map((text) => ({ text, sourceLocale: "auto" as const, targetLocale })),
    subjectIncluded: Boolean(subject),
    segments,
    sourceSnapshot: { subject: input.subject, documentKey: JSON.stringify(input.bodyDocument) },
  };
}

export function createOutgoingRichTranslationPreview(
  plan: ReturnType<typeof createOutgoingRichTranslationPlan>,
  response: { fallbackUsed: boolean; items: Array<{ originalText: string; translatedText: string; source: string }> },
) {
  if (response.fallbackUsed || response.items.length !== plan.texts.length || response.items.some((item, index) => item.source === "fallback" || item.originalText !== plan.texts[index]?.text || !item.translatedText.trim())) {
    throw new Error("번역 응답이 원문 구간과 일치하지 않습니다.");
  }
  let index = 0;
  const subject = plan.subjectIncluded ? response.items[index++]!.translatedText : plan.sourceSnapshot.subject;
  return { subject, segments: plan.segments.map((segment) => ({ id: segment.id, text: response.items[index++]!.translatedText })), sourceSnapshot: plan.sourceSnapshot };
}

export function applyOutgoingRichTranslationPreview<T extends { subject: string; bodyDocument: TDocument }, TDocument>(
  current: T,
  preview: { subject: string; segments: RichTranslationSegment[]; sourceSnapshot: { subject: string; documentKey: string } },
  options: { applySegments: (document: TDocument, segments: RichTranslationSegment[]) => TDocument; projectDocument: (document: TDocument) => { bodyHtml: string; bodyText: string } },
) {
  if (current.subject !== preview.sourceSnapshot.subject || JSON.stringify(current.bodyDocument) !== preview.sourceSnapshot.documentKey) throw new Error("번역 미리보기 뒤 원문이 변경되었습니다.");
  const bodyDocument = options.applySegments(current.bodyDocument, preview.segments);
  return { ...current, subject: preview.subject, bodyDocument, ...options.projectDocument(bodyDocument) };
}
