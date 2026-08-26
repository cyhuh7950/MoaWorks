// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchMailInlinePreview, uploadMailAttachment } from "./api";
import { InlineImageRegistry } from "./mailInlineImages";

describe("InlineImageRegistry", () => {
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    revokeObjectURL.mockReset();
    vi.stubGlobal("URL", { ...URL, revokeObjectURL });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("revokes a replaced URL exactly once and keeps same-value set idempotent", () => {
    const registry = new InlineImageRegistry();

    registry.set("cid-a", "blob:a");
    registry.set("cid-a", "blob:a");
    registry.set("cid-a", "blob:b");

    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:a");
    expect(registry.get("cid-a")).toBe("blob:b");
  });

  it("does not revoke a shared URL until its final CID reference is deleted", () => {
    const registry = new InlineImageRegistry();
    registry.set("cid-a", "blob:shared");
    registry.set("cid-b", "blob:shared");

    expect(registry.delete("cid-a")).toBe(true);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(registry.delete("cid-a")).toBe(false);
    expect(registry.delete("cid-b")).toBe(true);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:shared");
  });

  it("clears every still-owned unique URL once and repeated clear is idempotent", () => {
    const registry = new InlineImageRegistry();
    registry.set("cid-a", "blob:shared");
    registry.set("cid-b", "blob:shared");
    registry.set("cid-c", "blob:other");

    registry.clear();
    registry.clear();

    expect(revokeObjectURL.mock.calls).toEqual([["blob:shared"], ["blob:other"]]);
    expect(registry.get("cid-a")).toBeUndefined();
  });
});

describe("mail inline image API", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    "https://tracker.example/x",
    "//tracker.example/x",
    "/api/v1/mail/x",
    "/mail",
    "/mail//tracker.example/x",
    "/mail/../auth/me",
    "/mail/%2e%2e/auth/me",
    "/mail/x?next=https://tracker.example",
    "/mail/x#fragment",
    "/mail/x\\y",
  ])("rejects an invalid preview path before fetch: %s", async (previewPath) => {
    await expect(fetchMailInlinePreview("secret-token", previewPath)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches a valid preview through the authenticated same-origin API base", async () => {
    const blob = new Blob(["png"], { type: "image/png" });
    fetchMock.mockResolvedValue({ ok: true, blob: vi.fn().mockResolvedValue(blob) });

    await expect(fetchMailInlinePreview("secret-token", "/mail/attachments/staged/upload-1/preview")).resolves.toBe(blob);

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/mail/attachments/staged/upload-1/preview", {
      headers: { Authorization: "Bearer secret-token" },
    });
  });

  it("fails closed on a preview response error without creating an object URL", async () => {
    const createObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL });
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: vi.fn().mockResolvedValue({ detail: { code: "FORBIDDEN", userMessage: "권한이 없습니다." } }),
    });

    await expect(fetchMailInlinePreview("secret-token", "/mail/attachments/staged/upload-1/preview")).rejects.toThrow(
      "권한이 없습니다.",
    );
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it.each([
    [undefined, "attachment"],
    ["inline", "inline"],
  ] as const)("uploads with a backward-compatible disposition %s", async (disposition, expected) => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      const form = init?.body as FormData;
      expect(form.get("disposition")).toBe(expected);
      expect(form.get("file")).toBeInstanceOf(File);
      return {
        ok: true,
        json: vi.fn().mockResolvedValue({
          uploadId: "upload-1",
          fileName: "x.png",
          contentType: "image/png",
          sizeBytes: 3,
          disposition: expected,
          ...(expected === "inline"
            ? { contentId: "mw-1@example.invalid", previewPath: "/mail/attachments/staged/upload-1/preview" }
            : {}),
        }),
      };
    });
    const file = new File(["png"], "x.png", { type: "image/png" });

    const result = await uploadMailAttachment("secret-token", file, disposition);

    expect(result.disposition).toBe(expected);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/mail/attachments",
      expect.objectContaining({ method: "POST", headers: { Authorization: "Bearer secret-token" } }),
    );
  });
});
