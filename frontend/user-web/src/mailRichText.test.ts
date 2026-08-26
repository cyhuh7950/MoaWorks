import type { JSONContent } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import {
  applyTranslatedSegments,
  extractTranslationSegments,
  projectMailDocument,
  type TranslationSegment,
} from "./mailRichText";

const richDocument: JSONContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      attrs: { textAlign: "center" },
      content: [
        { type: "text", text: "안녕", marks: [{ type: "bold" }] },
        {
          type: "text",
          text: " 링크",
          marks: [{ type: "link", attrs: { href: "https://example.com/path?q=1" } }],
        },
      ],
    },
    {
      type: "image",
      attrs: {
        contentId: "mw-1@example.invalid",
        src: "cid:mw-1@example.invalid",
        alt: "영수증",
        width: 320,
        height: 180,
      },
    },
  ],
};

describe("projectMailDocument", () => {
  it("keeps approved marks and emits an accessible image fallback", () => {
    const before = structuredClone(richDocument);

    const result = projectMailDocument(richDocument);

    expect(result.bodyText).toBe("안녕 링크\n[이미지: 영수증]");
    expect(result.bodyHtml).toContain("<strong>안녕</strong>");
    expect(result.bodyHtml).toContain('href="https://example.com/path?q=1"');
    expect(result.bodyHtml).toContain('src="cid:mw-1@example.invalid"');
    expect(result.bodyHtml).not.toMatch(/blob:|data:|javascript:/i);
    expect(result.contentIds).toEqual(["mw-1@example.invalid"]);
    expect(richDocument).toEqual(before);
  });

  it("preserves useful list and table boundaries in bodyText", () => {
    const result = projectMailDocument({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "첫째" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "둘째" }] }] },
          ],
        },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "품목" }] }] },
                { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "수량" }] }] },
              ],
            },
            {
              type: "tableRow",
              content: [
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "사과" }] }] },
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "2" }] }] },
              ],
            },
          ],
        },
      ],
    });

    expect(result.bodyText).toBe("- 첫째\n- 둘째\n품목\t수량\n사과\t2");
  });

  it("uses a deterministic fallback when image alt is blank", () => {
    const result = projectMailDocument({
      type: "doc",
      content: [{ type: "image", attrs: { contentId: "mw-2@example.invalid", alt: "   " } }],
    });

    expect(result.bodyText).toBe("[이미지: 본문 이미지]");
    expect(result.bodyHtml).toContain('alt="본문 이미지"');
  });

  it.each([
    null,
    {},
    { type: "doc", content: "not-an-array" },
    { type: "doc", content: [{ type: "text", text: "root text" }] },
    { type: "doc", content: [{ type: "script", content: [{ type: "text", text: "alert(1)" }] }] },
    { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "event" }] }] }] },
  ])("rejects malformed or unsupported structured content %#", (value) => {
    expect(() => projectMailDocument(value as JSONContent)).toThrow();
  });

  it.each(["javascript:alert(1)", "data:text/html,x", "//tracker.example/x", "/relative"])(
    "rejects unsafe link href %s",
    (href) => {
      expect(() =>
        projectMailDocument({
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href } }] }] }],
        }),
      ).toThrow();
    },
  );

  it.each(["https://tracker.example/x.png", "data:image/png;base64,AAAA", "blob:preview", "/relative.png"])(
    "rejects non-CID image src %s",
    (src) => {
      expect(() =>
        projectMailDocument({
          type: "doc",
          content: [{ type: "image", attrs: { contentId: "mw-3@example.invalid", src, alt: "x" } }],
        }),
      ).toThrow();
    },
  );

  it("rejects duplicate CID image nodes", () => {
    expect(() =>
      projectMailDocument({
        type: "doc",
        content: [
          { type: "image", attrs: { contentId: "mw-4@example.invalid", alt: "a" } },
          { type: "image", attrs: { contentId: "mw-4@example.invalid", alt: "b" } },
        ],
      }),
    ).toThrow();
  });
});

describe("translation segment mapping", () => {
  const document: JSONContent = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "첫 문장", marks: [{ type: "bold" }] },
          { type: "text", text: "링크", marks: [{ type: "link", attrs: { href: "mailto:user@example.com" } }] },
        ],
      },
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "셀" }] }] },
              { type: "tableCell", content: [{ type: "image", attrs: { contentId: "mw-5@example.invalid", alt: "도표" } }] },
            ],
          },
        ],
      },
    ],
  };

  it("extracts deterministic text-node paths without mutating input", () => {
    const before = structuredClone(document);

    const result = extractTranslationSegments(document);

    expect(result.segments).toEqual([
      { id: "0.0", text: "첫 문장" },
      { id: "0.1", text: "링크" },
      { id: "1.0.0.0.0", text: "셀" },
    ]);
    expect(result.document).toEqual(document);
    expect(result.document).not.toBe(document);
    expect(document).toEqual(before);
  });

  it("applies all translations atomically while preserving structure and marks", () => {
    const before = structuredClone(document);

    const translated = applyTranslatedSegments(document, [
      { id: "0.0", text: "First sentence" },
      { id: "0.1", text: "Link" },
      { id: "1.0.0.0.0", text: "Cell" },
    ]);

    expect(translated.content?.[0].content?.[0]).toMatchObject({ text: "First sentence", marks: [{ type: "bold" }] });
    expect(translated.content?.[0].content?.[1]).toMatchObject({
      text: "Link",
      marks: [{ type: "link", attrs: { href: "mailto:user@example.com" } }],
    });
    expect(translated.content?.[1].content?.[0].content?.[1].type).toBe("tableCell");
    expect(translated.content?.[1].content?.[0].content?.[1].content?.[0].type).toBe("image");
    expect(document).toEqual(before);
  });

  const mismatchCases: TranslationSegment[][] = [
    [{ id: "wrong", text: "x" }],
    [
      { id: "0.0", text: "x" },
      { id: "0.1", text: "y" },
    ],
    [
      { id: "0.1", text: "x" },
      { id: "0.0", text: "y" },
      { id: "1.0.0.0.0", text: "z" },
    ],
    [
      { id: "0.0", text: "x" },
      { id: "0.0", text: "y" },
      { id: "1.0.0.0.0", text: "z" },
    ],
  ];

  it.each(mismatchCases.map((items) => [items] as const))(
    "rejects count, id, order, or uniqueness mismatches without partial mutation %#",
    (items) => {
    const before = structuredClone(document);

    expect(() => applyTranslatedSegments(document, items)).toThrow();
    expect(document).toEqual(before);
    },
  );
});
