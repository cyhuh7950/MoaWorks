export type InlineImageDraft = {
  uploadId: string;
  contentId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  previewPath: string;
  objectUrl: string;
  alt: string;
};

export class InlineImageRegistry {
  private readonly urlsByContentId = new Map<string, string>();

  get(contentId: string): string | undefined {
    return this.urlsByContentId.get(contentId);
  }

  set(contentId: string, url: string): void {
    if (!contentId.trim() || !url.trim()) {
      throw new Error("CID와 object URL은 비어 있을 수 없습니다.");
    }
    const previous = this.urlsByContentId.get(contentId);
    if (previous === url) {
      return;
    }
    this.urlsByContentId.set(contentId, url);
    if (previous !== undefined) {
      this.revokeWhenUnreferenced(previous);
    }
  }

  delete(contentId: string): boolean {
    const url = this.urlsByContentId.get(contentId);
    if (url === undefined) {
      return false;
    }
    this.urlsByContentId.delete(contentId);
    this.revokeWhenUnreferenced(url);
    return true;
  }

  clear(): void {
    const urls = [...new Set(this.urlsByContentId.values())];
    this.urlsByContentId.clear();
    let firstError: unknown;
    for (const url of urls) {
      try {
        URL.revokeObjectURL(url);
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError !== undefined) {
      throw firstError;
    }
  }

  private revokeWhenUnreferenced(url: string): void {
    if (![...this.urlsByContentId.values()].includes(url)) {
      URL.revokeObjectURL(url);
    }
  }
}
