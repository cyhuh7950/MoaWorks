import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Icon } from "@phosphor-icons/react";

export const MAIL_PAGE_SIZES = [10, 25, 50, 100] as const;
export type MailDisplay = { mode: "icons" | "text"; pageSize: number };
const storageKey = (userId: string) => `moaworks.mail.display.v1:${userId}`;

export function readMailDisplay(userId: string): MailDisplay {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(userId)) || "{}");
    return {
      mode: value.mode === "text" ? "text" : "icons",
      pageSize: MAIL_PAGE_SIZES.includes(value.pageSize) ? value.pageSize : 50,
    };
  } catch {
    return { mode: "icons", pageSize: 50 };
  }
}

export function saveMailDisplay(userId: string, value: MailDisplay) {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(value));
  } catch {
    // Browser privacy mode: keep the in-memory choice.
  }
}

type ToolProps = { label: string; icon: Icon; mode: MailDisplay["mode"] };

export function MailToolButton({ label, icon: Glyph, mode, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & ToolProps) {
  return (
    <button type="button" {...props} aria-label={label} title={label} className={`mail-tool-button ${mode}`}>
      {mode === "icons" ? <Glyph size={18} aria-hidden="true" /> : <span>{label}</span>}
    </button>
  );
}

export function MailToolMenu({ label, icon: Glyph, mode, children }: ToolProps & { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const bounds = trigger.current?.getBoundingClientRect();
      if (!bounds) return;
      const height = popover.current?.offsetHeight ?? 300;
      setPosition({
        left: Math.max(8, Math.min(bounds.left, window.innerWidth - 244)),
        top: Math.max(8, Math.min(bounds.bottom + 6, window.innerHeight - height - 8)),
      });
    };
    place();
    popover.current?.querySelector<HTMLElement>('select, button, input')?.focus();
    window.addEventListener("resize", place);
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node) && !popover.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => { document.removeEventListener("pointerdown", closeOutside); window.removeEventListener("resize", place); };
  }, [open]);

  return (
    <div
      className="mail-tool-menu"
      ref={root}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget) && !popover.current?.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className={`mail-tool-button ${mode}`}
        title={label}
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        {mode === "icons" ? <Glyph size={18} aria-hidden="true" /> : <span>{label}</span>}
      </button>
      {open ? createPortal(
        <div ref={popover} id={id} role="dialog" aria-label={label} className="mail-tool-popover" style={{ position: "fixed", left: position.left, top: position.top, right: "auto", maxHeight: "calc(100dvh - 16px)" }}>
          <strong>{label}</strong>
          {children}
        </div>, document.body
      ) : null}
    </div>
  );
}

type PaginationProps = {
  total: number;
  limit: number;
  offset: number;
  loading: boolean;
  onPage: (offset: number) => void;
  onSize: (size: number) => void;
};

export function MailPagination({ total, limit, offset, loading, onPage, onSize }: PaginationProps) {
  const count = Math.max(1, Math.ceil(total / limit));
  const current = Math.min(count, Math.floor(offset / limit) + 1);
  const nearbyPages = Array.from({ length: 5 }, (_, index) => current - 2 + index).filter((page) => page > 1 && page < count);
  const pages = Array.from(new Set([1, ...nearbyPages, count])).sort((a, b) => a - b);

  return (
    <footer className="mail-pagination">
      <nav aria-label="메일 페이지">
        <button type="button" aria-label="첫 페이지" disabled={loading || current === 1} onClick={() => onPage(0)}>«</button>
        <button type="button" aria-label="이전 페이지" disabled={loading || current === 1} onClick={() => onPage((current - 2) * limit)}>‹</button>
        {pages.map((page, index) => (
          <span key={page}>
            {index > 0 && page - pages[index - 1] > 1 ? <span aria-hidden="true">…</span> : null}
            <button
              type="button"
              aria-label={`${page}페이지`}
              aria-current={page === current ? "page" : undefined}
              disabled={loading || total === 0}
              onClick={() => onPage((page - 1) * limit)}
            >{page}</button>
          </span>
        ))}
        <button type="button" aria-label="다음 페이지" disabled={loading || current === count} onClick={() => onPage(current * limit)}>›</button>
        <button type="button" aria-label="마지막 페이지" disabled={loading || current === count} onClick={() => onPage((count - 1) * limit)}>»</button>
      </nav>
      <select aria-label="페이지당 메일 수" value={limit} disabled={loading} onChange={(event) => onSize(Number(event.target.value))}>
        {MAIL_PAGE_SIZES.map((size) => <option key={size} value={size}>{size}개씩 보기</option>)}
      </select>
    </footer>
  );
}
