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
