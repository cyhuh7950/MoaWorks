// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JSONContent } from "@tiptap/core";
import { Editor } from "@tiptap/core";
import { NodeSelection, TextSelection, type Selection } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { MailRichTextEditor } from "./MailRichTextEditor";
import type { InlineImageDraft } from "./mailInlineImages";

const emptyDoc: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };
const externalImageDoc: JSONContent = {
  type: "doc",
  content: [{
    type: "paragraph",
    content: [{
      type: "image",
      attrs: {
        src: "cid:mw-existing@example.invalid",
        contentId: "mw-existing@example.invalid",
        alt: "기존 이미지",
        width: null,
        height: null,
      },
    }],
  }],
};
const replacementImageDoc: JSONContent = {
  type: "doc",
  content: [{
    type: "paragraph",
    content: [{
      type: "image",
      attrs: {
        src: "cid:mw-replacement@example.invalid",
        contentId: "mw-replacement@example.invalid",
        alt: "교체 이미지",
        width: null,
        height: null,
      },
    }],
  }],
};
const interactiveContentDoc: JSONContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "일반 텍스트 " },
        { type: "text", text: "링크", marks: [{ type: "link", attrs: { href: "https://example.invalid" } }] },
        {
          type: "image",
          attrs: {
            src: "cid:mw-interaction@example.invalid",
            contentId: "mw-interaction@example.invalid",
            alt: "상호작용 이미지",
            width: null,
            height: null,
          },
        },
      ],
    },
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: ["머리글 1", "머리글 2"].map((text) => ({
            type: "tableHeader",
            attrs: { colspan: 1, rowspan: 1, colwidth: null },
            content: [{ type: "paragraph", content: [{ type: "text", text }] }],
          })),
        },
        {
          type: "tableRow",
          content: ["표 셀 1", "표 셀 2"].map((text) => ({
            type: "tableCell",
            attrs: { colspan: 1, rowspan: 1, colwidth: null },
            content: [{ type: "paragraph", content: [{ type: "text", text }] }],
          })),
        },
      ],
    },
  ],
};

type PreviewEditorProps = React.ComponentProps<typeof MailRichTextEditor>;
const PreviewEditor = MailRichTextEditor;

beforeAll(() => {
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => document.body });
  const emptyRects = () => ({
    0: new DOMRect(0, 0, 0, 0),
    length: 1,
    item: () => new DOMRect(0, 0, 0, 0),
    [Symbol.iterator]: function* () { yield this[0]; },
  });
  Object.defineProperty(HTMLElement.prototype, "getClientRects", { configurable: true, value: emptyRects });
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: emptyRects });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => new DOMRect(0, 0, 0, 0) });
});

function draftFor(file: File): InlineImageDraft {
  return {
    uploadId: `upload-${file.name}`,
    contentId: `mw-${file.name.replace(/[^a-z0-9]/gi, "-")}@example.invalid`,
    fileName: file.name,
    contentType: file.type,
    sizeBytes: file.size,
    previewPath: `/mail/attachments/staged/upload-${file.name}/preview`,
    objectUrl: `blob:${file.name}`,
    alt: "",
  };
}

function renderEditor(overrides: Partial<React.ComponentProps<typeof MailRichTextEditor>> = {}) {
  const props = {
    value: emptyDoc,
    onChange: vi.fn(),
    onUploadImage: vi.fn(async (file: File) => draftFor(file)),
    onError: vi.fn(),
    ...overrides,
  };
  return { ...render(<MailRichTextEditor {...props} />), props };
}

function renderPreviewEditor(overrides: Partial<PreviewEditorProps> = {}) {
  const props: PreviewEditorProps = {
    value: emptyDoc,
    onChange: vi.fn(),
    onUploadImage: vi.fn(async (file: File) => draftFor(file)),
    onError: vi.fn(),
    ...overrides,
  };
  return { ...render(<PreviewEditor {...props} />), props };
}

function observeEditorFocusCommands() {
  const commandsGetter = Object.getOwnPropertyDescriptor(Editor.prototype, "commands")?.get as
    | ((this: Editor) => Editor["commands"])
    | undefined;
  if (!commandsGetter) throw new Error("Tiptap Editor.commands getter is unavailable");
  const focusCommand = vi.fn();
  let mountedEditor: Editor | null = null;
  vi.spyOn(Editor.prototype, "commands", "get").mockImplementation(function (this: Editor) {
    mountedEditor = this;
    const commands = commandsGetter.call(this);
    return {
      ...commands,
      focus: (...args: Parameters<Editor["commands"]["focus"]>) => {
        focusCommand(...args);
        return commands.focus(...args);
      },
    };
  });
  return {
    focusCommand,
    getEditor: () => {
      if (!mountedEditor) throw new Error("mounted Tiptap editor is unavailable");
      return mountedEditor;
    },
  };
}

function selectionSnapshot(selection: Selection) {
  return {
    type: selection.constructor.name,
    from: selection.from,
    to: selection.to,
    anchor: selection.anchor,
    head: selection.head,
    json: selection.toJSON(),
  };
}

function findNodePositions(editor: Editor, nodeType: string) {
  const positions: number[] = [];
  editor.state.doc.descendants((node, position) => {
    if (node.type.name === nodeType) positions.push(position);
  });
  return positions;
}

const realSelectionCases = [
  {
    name: "TextSelection",
    selectionType: TextSelection,
    create: (editor: Editor) => {
      const [textPosition] = findNodePositions(editor, "text");
      return TextSelection.create(editor.state.doc, textPosition, textPosition + 4);
    },
  },
  {
    name: "NodeSelection",
    selectionType: NodeSelection,
    create: (editor: Editor) => NodeSelection.create(editor.state.doc, findNodePositions(editor, "image")[0]),
  },
  {
    name: "CellSelection",
    selectionType: CellSelection,
    create: (editor: Editor) => {
      const headerPositions = findNodePositions(editor, "tableHeader");
      return CellSelection.create(editor.state.doc, headerPositions[0], headerPositions[1]);
    },
  },
] as const;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MailRichTextEditor 접근성과 서식 계약", () => {
  it("초기 비활성 상태가 해제되면 실제 편집면을 다시 활성화하고 focus를 유지한다", async () => {
    const { rerender, props } = renderEditor({ disabled: true });
    const surface = await screen.findByRole("textbox", { name: "메일 본문" });
    expect(surface.getAttribute("contenteditable")).toBe("false");

    rerender(<MailRichTextEditor {...props} disabled={false} />);

    await waitFor(() => expect(surface.getAttribute("contenteditable")).toBe("true"));
    fireEvent.mouseDown(surface);
    expect(document.activeElement).toBe(surface);
  });

  it("아이콘 toolbar, 접근성 이름, 서식 dropdown과 HTML 탭 없는 편집면을 제공한다", async () => {
    renderEditor();

    const toolbar = await screen.findByRole("toolbar", { name: "메일 본문 서식" });
    expect(toolbar).toBeTruthy();
    expect(screen.getByRole("button", { name: "굵게" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByRole("tab", { name: /HTML/i })).toBeNull();
    expect(screen.getByRole("textbox", { name: "메일 본문" })).toBeTruthy();

    const iconCommandNames = [
      "기울임", "밑줄", "취소선", "왼쪽 정렬", "가운데 정렬", "오른쪽 정렬", "양쪽 정렬",
      "글머리표", "번호 목록", "들여쓰기", "내어쓰기", "인용문", "가로 구분선", "링크 설정",
      "링크 해제", "실행 취소", "다시 실행", "서식 제거", "표 삽입", "행 앞에 추가", "행 뒤에 추가",
      "행 삭제", "열 앞에 추가", "열 뒤에 추가", "열 삭제", "셀 병합", "셀 분할", "머리글 행 전환", "표 삭제",
    ];
    for (const name of ["굵게", ...iconCommandNames]) {
      const button = screen.getByRole("button", { name });
      expect(button.getAttribute("title")).toBe(name);
      expect(button.textContent?.trim()).toBe("");
      expect(button.querySelector("svg")).toBeTruthy();
    }
    expect(screen.getByLabelText("글꼴")).toBeTruthy();
    expect(screen.getByLabelText("글자 크기")).toBeTruthy();
    expect(screen.getByLabelText("줄 간격")).toBeTruthy();
    expect(screen.getByLabelText("문단 형식")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "일반 문단" })).toBeNull();
    expect(screen.queryByRole("button", { name: "제목 1" })).toBeNull();
    expect(screen.getByLabelText("글자색")).toBeTruthy();
    expect(screen.getByLabelText("배경색")).toBeTruthy();
    expect(screen.getByLabelText("본문 이미지 선택")).toBeTruthy();
  });

  it("사용자 입력만 onChange로 내보내고 외부 value 교체는 feedback loop를 만들지 않는다", async () => {
    const onChange = vi.fn();
    const { rerender, props } = renderEditor({ onChange });
    const textbox = await screen.findByRole("textbox", { name: "메일 본문" });

    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(textbox);
    await userEvent.keyboard("첫 문장");
    expect(onChange).toHaveBeenCalled();

    onChange.mockClear();
    const replacement: JSONContent = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "외부 교체" }] }],
    };
    rerender(<MailRichTextEditor {...props} value={replacement} onChange={onChange} />);

    await waitFor(() => expect(textbox.textContent).toContain("외부 교체"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("문단 형식 select 뒤 빈 editor surface pointer 입력을 본문 focus와 문서 입력으로 연결한다", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { focusCommand } = observeEditorFocusCommands();
    renderEditor({ onChange });
    const paragraphSelect = await screen.findByRole("combobox", { name: "문단 형식" });
    const textbox = screen.getByRole("textbox", { name: "메일 본문" });

    await user.click(paragraphSelect);
    expect(document.activeElement).toBe(paragraphSelect);
    focusCommand.mockClear();
    fireEvent.pointerDown(textbox);

    expect(focusCommand).toHaveBeenCalledWith("start");
    await waitFor(() => expect(document.activeElement).toBe(textbox));
    await user.keyboard("작성 가능");
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ type: "doc" }));
    expect(textbox.textContent).toContain("작성 가능");
  });

  it.each(realSelectionCases)("$name에서 보호 pointer target matrix는 실제 selection과 문서를 바꾸지 않는다", async ({ create, selectionType }) => {
    const onChange = vi.fn();
    const { focusCommand, getEditor } = observeEditorFocusCommands();
    const { container } = renderEditor({ value: interactiveContentDoc, onChange });
    const textbox = await screen.findByRole("textbox", { name: "메일 본문" });
    const editor = getEditor();
    const content = container.querySelector(".mail-rich-text-editor__content") as HTMLElement;
    const resizeHandle = document.createElement("span");
    resizeHandle.dataset.resizeHandle = "right";
    const button = document.createElement("button");
    const input = document.createElement("input");
    const select = document.createElement("select");
    content.append(resizeHandle, button, input, select);
    const targets = {
      text: textbox.querySelector("p"),
      link: textbox.querySelector("a"),
      image: textbox.querySelector("img"),
      resizeHandle,
      tableCell: textbox.querySelector("td"),
      tableHeader: textbox.querySelector("th"),
      button,
      input,
      select,
    };
    expect(Object.values(targets).every(Boolean)).toBe(true);

    for (const [targetName, target] of Object.entries(targets)) {
      editor.view.dispatch(editor.state.tr.setSelection(create(editor)));
      const beforeSelection = selectionSnapshot(editor.state.selection);
      const beforeDocument = editor.getJSON();
      expect(editor.state.selection).toBeInstanceOf(selectionType);
      focusCommand.mockClear();
      onChange.mockClear();

      fireEvent.pointerDown(target as Element);

      expect(selectionSnapshot(editor.state.selection), targetName).toEqual(beforeSelection);
      expect(editor.state.selection, targetName).toBeInstanceOf(selectionType);
      expect(editor.getJSON(), targetName).toEqual(beforeDocument);
      expect(focusCommand, targetName).not.toHaveBeenCalled();
      expect(onChange, targetName).not.toHaveBeenCalled();
    }
  });

  it("non-empty ProseMirror surface pointer는 기존 안전 selection을 문서 끝으로 옮기지 않는다", async () => {
    const onChange = vi.fn();
    const { focusCommand, getEditor } = observeEditorFocusCommands();
    renderEditor({ value: interactiveContentDoc, onChange });
    const textbox = await screen.findByRole("textbox", { name: "메일 본문" });
    const editor = getEditor();
    const [textPosition] = findNodePositions(editor, "text");
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, textPosition, textPosition + 4)));
    const beforeSelection = selectionSnapshot(editor.state.selection);
    const beforeDocument = editor.getJSON();
    expect(beforeSelection.to).toBeLessThan(editor.state.doc.content.size - 1);
    focusCommand.mockClear();
    onChange.mockClear();

    fireEvent.pointerDown(textbox);

    expect(focusCommand).toHaveBeenCalledWith(undefined);
    expect(selectionSnapshot(editor.state.selection)).toEqual(beforeSelection);
    expect(editor.state.selection).toBeInstanceOf(TextSelection);
    expect(editor.getJSON()).toEqual(beforeDocument);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("disabled editor의 root와 surface pointer target은 focus나 문서 변경을 만들지 않는다", async () => {
    const onChange = vi.fn();
    const { focusCommand, getEditor } = observeEditorFocusCommands();
    const { container } = renderEditor({ disabled: true, onChange });
    const textbox = await screen.findByRole("textbox", { name: "메일 본문" });
    const content = container.querySelector(".mail-rich-text-editor__content") as HTMLElement;
    const editor = getEditor();
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1)));
    const beforeSelection = selectionSnapshot(editor.state.selection);
    const beforeDocument = editor.getJSON();

    focusCommand.mockClear();
    onChange.mockClear();
    fireEvent.pointerDown(content);
    fireEvent.pointerDown(textbox);

    expect(document.activeElement).not.toBe(textbox);
    expect(selectionSnapshot(editor.state.selection)).toEqual(beforeSelection);
    expect(editor.getJSON()).toEqual(beforeDocument);
    expect(focusCommand).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("disabled이면 편집, command, paste/drop, upload를 모두 차단한다", async () => {
    const onUploadImage = vi.fn(async (file: File) => draftFor(file));
    const { props } = renderEditor({ disabled: true, onUploadImage });
    const textbox = await screen.findByRole("textbox", { name: "메일 본문" });
    const png = new File(["png"], "x.png", { type: "image/png" });

    expect(textbox.getAttribute("contenteditable")).toBe("false");
    expect((screen.getByRole("button", { name: "굵게" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.paste(textbox, { clipboardData: { files: [png], getData: () => "" } });
    fireEvent.drop(textbox, { dataTransfer: { files: [png] } });
    fireEvent.change(screen.getByLabelText("본문 이미지 선택"), { target: { files: [png] } });

    expect(onUploadImage).not.toHaveBeenCalled();
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("unmount에서 Tiptap editor를 destroy한다", async () => {
    const destroy = vi.spyOn(Editor.prototype, "destroy");
    const { unmount } = renderEditor();
    await screen.findByRole("textbox", { name: "메일 본문" });

    unmount();

    expect(destroy).toHaveBeenCalledTimes(1);
  });
});

describe("MailRichTextEditor 이미지 경계", () => {
  it("외부 CID 문서를 resolver의 blob URL로 표시하되 JSON에는 CID만 유지한다", async () => {
    const onChange = vi.fn();
    renderPreviewEditor({
      value: externalImageDoc,
      resolveInlineImageUrl: () => "blob:https://moaworks.invalid/existing",
      onChange,
    });

    const image = await waitFor(() => {
      const element = document.querySelector('img[contentid="mw-existing@example.invalid"]');
      expect(element).toBeTruthy();
      expect(element?.getAttribute("src")).toBe("blob:https://moaworks.invalid/existing");
      return element as HTMLImageElement;
    });
    await userEvent.click(screen.getByRole("button", { name: "가로 구분선" }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const emitted = JSON.stringify(onChange.mock.calls[onChange.mock.calls.length - 1][0]);
    expect(emitted).toContain("cid:mw-existing@example.invalid");
    expect(emitted).not.toContain("blob:");
    expect(image.getAttribute("src")).toBe("blob:https://moaworks.invalid/existing");
  });

  it("resolver 결과가 mount 후 준비되거나 바뀌면 표시만 갱신하고 onChange를 호출하지 않는다", async () => {
    const onChange = vi.fn();
    let previewUrl: string | undefined;
    const { rerender, props } = renderPreviewEditor({
      value: externalImageDoc,
      resolveInlineImageUrl: () => previewUrl,
      onChange,
    });
    const image = await waitFor(() => document.querySelector('img[contentid="mw-existing@example.invalid"]') as HTMLImageElement);
    expect(image.getAttribute("src")).toBe("cid:mw-existing@example.invalid");

    previewUrl = "blob:https://moaworks.invalid/first";
    rerender(<PreviewEditor {...props} resolveInlineImageUrl={() => previewUrl} />);
    await waitFor(() => expect(image.getAttribute("src")).toBe("blob:https://moaworks.invalid/first"));

    previewUrl = "blob:https://moaworks.invalid/second";
    rerender(<PreviewEditor {...props} resolveInlineImageUrl={() => previewUrl} />);
    await waitFor(() => expect(image.getAttribute("src")).toBe("blob:https://moaworks.invalid/second"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("외부 value 교체 시 새 CID의 resolver 표시를 갱신하고 feedback을 만들지 않는다", async () => {
    const onChange = vi.fn();
    const resolveInlineImageUrl = (contentId: string) => `blob:https://moaworks.invalid/${contentId}`;
    const { rerender, props } = renderPreviewEditor({
      value: externalImageDoc,
      resolveInlineImageUrl,
      onChange,
    });
    await waitFor(() => expect(document.querySelector("img")?.getAttribute("src")).toContain("mw-existing"));

    rerender(<PreviewEditor {...props} value={replacementImageDoc} />);

    await waitFor(() => {
      const replacement = document.querySelector('img[contentid="mw-replacement@example.invalid"]');
      expect(replacement?.getAttribute("src")).toBe(
        "blob:https://moaworks.invalid/mw-replacement@example.invalid",
      );
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each([
    "https://tracker.example/x",
    "http://tracker.example/x",
    "data:image/png;base64,AAAA",
    "file:///secret.png",
    "//tracker.example/x",
    "",
    "blob:https://moaworks.invalid/good\nhttps://tracker.example/x",
  ])("안전하지 않은 resolver 결과를 표시하거나 저장하지 않는다: %s", async (resolvedUrl) => {
    const onChange = vi.fn();
    renderPreviewEditor({
      value: externalImageDoc,
      resolveInlineImageUrl: () => resolvedUrl,
      onChange,
    });

    const image = await waitFor(() => document.querySelector('img[contentid="mw-existing@example.invalid"]') as HTMLImageElement);
    expect(image.getAttribute("src")).toBe("cid:mw-existing@example.invalid");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("외부 resolver URL은 문서 교체와 unmount에서 revoke하지 않는다", async () => {
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL");
    const { rerender, unmount, props } = renderPreviewEditor({
      value: externalImageDoc,
      resolveInlineImageUrl: () => "blob:https://moaworks.invalid/parent-owned",
    });
    await waitFor(() => expect(document.querySelector("img")?.getAttribute("src")).toContain("parent-owned"));

    rerender(<PreviewEditor {...props} value={emptyDoc} />);
    unmount();

    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it.each([
    ["image/png", "a.png"],
    ["image/jpeg", "a.jpg"],
    ["image/webp", "a.webp"],
  ])("%s 파일을 paste에서 한 번만 업로드하고 alt 확인 후 CID node를 삽입한다", async (type, name) => {
    const file = new File(["image"], name, { type });
    const onUploadImage = vi.fn(async () => draftFor(file));
    const onChange = vi.fn();
    renderEditor({ onUploadImage, onChange });
    const textbox = await screen.findByRole("textbox", { name: "메일 본문" });

    fireEvent.paste(textbox, { clipboardData: { files: [file, file], getData: () => "" } });
    await waitFor(() => expect(onUploadImage).toHaveBeenCalledTimes(1));
    const alt = await screen.findByRole("textbox", { name: "이미지 대체 텍스트" });
    expect((alt as HTMLInputElement).value).toBe(name.replace(/\.[^.]+$/, ""));
    await userEvent.clear(alt);
    await userEvent.type(alt, "영수증 이미지");
    await userEvent.click(screen.getByRole("button", { name: "이미지 삽입" }));

    await waitFor(() => {
      const last = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as JSONContent | undefined;
      const image = last?.content?.flatMap((node) => node.content ?? []).find((node) => node.type === "image");
      expect(image?.attrs).toEqual({
        src: `cid:${draftFor(file).contentId}`,
        contentId: draftFor(file).contentId,
        alt: "영수증 이미지",
        width: null,
        height: null,
      });
    });
  });

  it.each([
    ["image/gif", "a.gif", "PNG, JPEG, WebP"],
    ["image/svg+xml", "a.svg", "PNG, JPEG, WebP"],
    ["text/plain", "a.txt", "PNG, JPEG, WebP"],
  ])("지원하지 않는 %s 파일은 upload 없이 거부한다", async (type, name, message) => {
    const onUploadImage = vi.fn();
    const onError = vi.fn();
    renderEditor({ onUploadImage, onError });
    const textbox = await screen.findByRole("textbox", { name: "메일 본문" });

    fireEvent.drop(textbox, { dataTransfer: { files: [new File(["x"], name, { type })] } });

    expect(onUploadImage).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining(message));
  });

  it("5 MiB 초과 파일을 upload 없이 거부한다", async () => {
    const onUploadImage = vi.fn();
    const onError = vi.fn();
    renderEditor({ onUploadImage, onError });
    const file = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.png", { type: "image/png" });

    fireEvent.change(await screen.findByLabelText("본문 이미지 선택"), { target: { files: [file] } });

    expect(onUploadImage).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("5 MiB"));
  });

  it("정확히 5 MiB인 PNG는 허용한다", async () => {
    const file = new File([new Uint8Array(5 * 1024 * 1024)], "boundary.png", { type: "image/png" });
    const onUploadImage = vi.fn(async () => draftFor(file));
    renderEditor({ onUploadImage });

    fireEvent.change(await screen.findByLabelText("본문 이미지 선택"), { target: { files: [file] } });

    await waitFor(() => expect(onUploadImage).toHaveBeenCalledTimes(1));
  });

  it("문서의 이미지가 이미 5개면 추가 upload를 거부하고 본문을 보존한다", async () => {
    const value: JSONContent = {
      type: "doc",
      content: [{
        type: "paragraph",
        content: Array.from({ length: 5 }, (_, index) => ({
          type: "image",
          attrs: { contentId: `mw-${index}@example.invalid`, src: `cid:mw-${index}@example.invalid`, alt: `이미지 ${index}` },
        })),
      }],
    };
    const onUploadImage = vi.fn();
    const onError = vi.fn();
    const onChange = vi.fn();
    renderEditor({ value, onUploadImage, onError, onChange });

    fireEvent.change(await screen.findByLabelText("본문 이미지 선택"), {
      target: { files: [new File(["x"], "sixth.png", { type: "image/png" })] },
    });

    expect(onUploadImage).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("최대 5개"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("upload 실패는 오류만 알리고 기존 문서를 유지한다", async () => {
    const onError = vi.fn();
    const onChange = vi.fn();
    renderEditor({ onChange, onError, onUploadImage: vi.fn(async () => { throw new Error("network"); }) });

    fireEvent.change(await screen.findByLabelText("본문 이미지 선택"), {
      target: { files: [new File(["x"], "failed.png", { type: "image/png" })] },
    });

    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.stringContaining("업로드")));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: "이미지 대체 텍스트" })).toBeNull();
  });

  it("unmount 뒤 완료된 upload는 node를 삽입하거나 오류를 내지 않는다", async () => {
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL");
    let resolveUpload!: (draft: InlineImageDraft) => void;
    const onUploadImage = vi.fn(() => new Promise<InlineImageDraft>((resolve) => { resolveUpload = resolve; }));
    const onChange = vi.fn();
    const onError = vi.fn();
    const file = new File(["x"], "late.png", { type: "image/png" });
    const { unmount } = renderEditor({ onUploadImage, onChange, onError });
    fireEvent.change(await screen.findByLabelText("본문 이미지 선택"), { target: { files: [file] } });
    await waitFor(() => expect(onUploadImage).toHaveBeenCalledTimes(1));

    unmount();
    await act(async () => resolveUpload(draftFor(file)));

    expect(onChange).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(revokeObjectURL.mock.calls).toEqual([["blob:late.png"]]);
  });

  it("외부 document 교체 뒤 완료된 이전 upload를 무시한다", async () => {
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL");
    let resolveUpload!: (draft: InlineImageDraft) => void;
    const onUploadImage = vi.fn(() => new Promise<InlineImageDraft>((resolve) => { resolveUpload = resolve; }));
    const onChange = vi.fn();
    const onError = vi.fn();
    const file = new File(["x"], "stale.png", { type: "image/png" });
    const { rerender, props } = renderEditor({ onUploadImage, onChange, onError });
    fireEvent.change(await screen.findByLabelText("본문 이미지 선택"), { target: { files: [file] } });
    await waitFor(() => expect(onUploadImage).toHaveBeenCalledTimes(1));

    const replacement: JSONContent = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "새 문서" }] }] };
    rerender(<MailRichTextEditor {...props} value={replacement} />);
    await act(async () => resolveUpload(draftFor(file)));

    expect(screen.queryByRole("textbox", { name: "이미지 대체 텍스트" })).toBeNull();
    expect(onError).not.toHaveBeenCalled();
    expect(revokeObjectURL.mock.calls).toEqual([["blob:stale.png"]]);
  });

  it("내부 이미지를 undo로 삭제하면 owned object URL을 정확히 한 번 revoke한다", async () => {
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL");
    const file = new File(["x"], "owned.png", { type: "image/png" });
    renderEditor({ onUploadImage: vi.fn(async () => draftFor(file)) });
    fireEvent.change(await screen.findByLabelText("본문 이미지 선택"), { target: { files: [file] } });
    await userEvent.click(await screen.findByRole("button", { name: "이미지 삽입" }));
    await waitFor(() => expect(document.querySelector('img[contentid="mw-owned-png@example.invalid"]')).toBeTruthy());

    await userEvent.click(screen.getByRole("button", { name: "실행 취소" }));

    await waitFor(() => expect(document.querySelector('img[contentid="mw-owned-png@example.invalid"]')).toBeNull());
    expect(revokeObjectURL.mock.calls).toEqual([["blob:owned.png"]]);
  });

  it("내부 이미지가 남은 component unmount에서 owned URL을 정확히 한 번 revoke한다", async () => {
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL");
    const file = new File(["x"], "unmount-owned.png", { type: "image/png" });
    const { unmount } = renderEditor({ onUploadImage: vi.fn(async () => draftFor(file)) });
    fireEvent.change(await screen.findByLabelText("본문 이미지 선택"), { target: { files: [file] } });
    await userEvent.click(await screen.findByRole("button", { name: "이미지 삽입" }));
    await waitFor(() => expect(document.querySelector('img[contentid="mw-unmount-owned-png@example.invalid"]')).toBeTruthy());

    unmount();

    expect(revokeObjectURL.mock.calls).toEqual([["blob:unmount-owned.png"]]);
  });

  it("server contentId나 blob URL이 없는 upload 결과를 fail closed한다", async () => {
    const onError = vi.fn();
    const invalidDraft = { ...draftFor(new File(["x"], "bad.png", { type: "image/png" })), contentId: "", objectUrl: "https://tracker.example/x" };
    renderEditor({ onError, onUploadImage: vi.fn(async () => invalidDraft) });

    fireEvent.change(await screen.findByLabelText("본문 이미지 선택"), {
      target: { files: [new File(["x"], "bad.png", { type: "image/png" })] },
    });

    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.stringContaining("올바르지 않습니다")));
    expect(screen.queryByRole("textbox", { name: "이미지 대체 텍스트" })).toBeNull();
  });

  it("외부/data 이미지 HTML paste를 제거하고 upload callback을 호출하지 않는다", async () => {
    const onUploadImage = vi.fn();
    renderEditor({ onUploadImage });
    const textbox = await screen.findByRole("textbox", { name: "메일 본문" });

    fireEvent.paste(textbox, {
      clipboardData: {
        files: [],
        getData: (kind: string) => kind === "text/html" ? '<p>안전한 글</p><img src="https://tracker.example/x"><img src="data:image/png;base64,AAAA">' : "",
      },
    });

    expect(onUploadImage).not.toHaveBeenCalled();
    expect(textbox.querySelector("img")).toBeNull();
  });
});

describe("MailRichTextEditor 표와 responsive 계약", () => {
  it("기본 3x3 표를 삽입하고 table action을 활성화한다", async () => {
    const onChange = vi.fn();
    renderEditor({ onChange });
    await screen.findByRole("textbox", { name: "메일 본문" });

    await userEvent.click(screen.getByRole("button", { name: "표 삽입" }));

    await waitFor(() => {
      const last = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as JSONContent | undefined;
      const table = last?.content?.find((node) => node.type === "table");
      expect(table?.content).toHaveLength(3);
      expect(table?.content?.[0].content).toHaveLength(3);
    });
    expect((screen.getByRole("button", { name: "행 뒤에 추가" }) as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "행 뒤에 추가" }));
    await waitFor(() => {
      const last = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as JSONContent;
      expect(last.content?.find((node) => node.type === "table")?.content).toHaveLength(4);
    });
  });

  it("scoped responsive class hooks를 노출한다", async () => {
    const { container } = renderEditor();
    await screen.findByRole("textbox", { name: "메일 본문" });

    const editorRoot = container.querySelector(".mail-rich-text-editor") as HTMLElement;
    expect(editorRoot).toBeTruthy();
    expect(editorRoot.style.containerType).toBe("inline-size");
    expect(container.querySelector(".mail-rich-text-editor__toolbar")).toBeTruthy();
    expect(container.querySelector(".mail-rich-text-editor__surface")).toBeTruthy();
  });

  it("숨은 file input의 keyboard focus를 visible label hook으로 전달한다", async () => {
    const { container } = renderEditor();
    const input = await screen.findByLabelText("본문 이미지 선택");
    const label = container.querySelector(".mail-rich-text-editor__file-button") as HTMLLabelElement;

    input.focus();

    expect(document.activeElement).toBe(input);
    expect(label.matches(":has(input:focus)")).toBe(true);
  });
});
