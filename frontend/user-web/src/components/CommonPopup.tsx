import { useEffect, useId, useRef, useState, type MutableRefObject, type ReactNode, type RefObject } from "react";

type Mode = "normal" | "minimized" | "maximized";
type Bounds = { left: number; top: number; width: number; height: number };
type Props = { title: string; children: ReactNode; open: boolean; onClose: () => void; dirty?: boolean; error?: string; saving?: boolean; floating?: boolean; maximizable?: boolean; initialFocusRef?: RefObject<HTMLElement | null>; closeRequestRef?: MutableRefObject<(() => void) | null>; kind?: "dialog" | "alertdialog"; className?: string };
const selector = "button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex='-1'])";
const items = (root: HTMLElement | null) => root ? Array.from(root.querySelectorAll<HTMLElement>(selector)) : [];

export function CommonPopup({ title, children, open, onClose, dirty = false, error = "", saving = false, floating = false, maximizable = false, initialFocusRef, closeRequestRef, kind = "dialog", className = "" }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const confirmPanel = useRef<HTMLDivElement>(null);
  const continueButton = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  const [mode, setMode] = useState<Mode>("normal");
  const [previousMode, setPreviousMode] = useState<Exclude<Mode, "minimized">>("normal");
  const [confirm, setConfirm] = useState(false);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const titleId = useId(), descriptionId = useId(), confirmTitleId = useId(), confirmDescriptionId = useId();

  const saveBounds = () => {
    const rect = panel.current?.getBoundingClientRect();
    if (rect && mode === "normal") setBounds({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
  };
  const closeRequest = () => {
    if (saving) return;
    if (!dirty) return onClose();
    lastFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : close.current;
    setConfirm(true);
  };
  const cancelConfirm = () => {
    setConfirm(false);
    requestAnimationFrame(() => lastFocus.current?.focus());
  };

  useEffect(() => {
    if (!closeRequestRef) return;
    closeRequestRef.current = closeRequest;
    return () => { closeRequestRef.current = null; };
  }, [closeRequestRef, dirty, onClose, saving]);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (maximizable && !floating) setMode("normal");
    setConfirm(false);
    requestAnimationFrame(() => {
      const editable = panel.current?.querySelector<HTMLElement>("input:not([disabled]),textarea:not([disabled]),select:not([disabled])");
      (initialFocusRef?.current ?? editable ?? close.current)?.focus();
    });
    return () => opener.current?.focus();
  }, [floating, initialFocusRef, maximizable, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (!panel.current?.contains(document.activeElement)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        return confirm ? cancelConfirm() : closeRequest();
      }
      if (event.key !== "Tab") return;
      const focusable = items(confirm ? confirmPanel.current : panel.current);
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirm, dirty, open]);

  useEffect(() => { if (confirm) requestAnimationFrame(() => continueButton.current?.focus()); }, [confirm]);

  const drag = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!floating || mode !== "normal" || (event.target as HTMLElement).closest("button")) return;
    const rect = panel.current?.getBoundingClientRect();
    if (!rect) return;
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    const move = (nextEvent: MouseEvent) => {
      const size = panel.current?.getBoundingClientRect() ?? rect;
      setBounds({
        left: Math.min(Math.max(8, nextEvent.clientX - x), Math.max(8, innerWidth - size.width - 8)),
        top: Math.min(Math.max(8, nextEvent.clientY - y), Math.max(8, innerHeight - size.height - 8)),
        width: size.width, height: size.height,
      });
    };
    const stop = () => { removeEventListener("mousemove", move); removeEventListener("mouseup", stop); saveBounds(); };
    addEventListener("mousemove", move);
    addEventListener("mouseup", stop, { once: true });
  };
  const minimize = () => {
    if (mode === "minimized") return setMode(previousMode);
    if (floating && mode === "normal") saveBounds();
    setPreviousMode(mode === "maximized" ? "maximized" : "normal");
    setMode("minimized");
  };
  const maximize = () => {
    if (mode === "maximized") return setMode("normal");
    if (mode === "normal") saveBounds();
    setMode("maximized");
  };
  if (!open) return null;

  const expanded = mode === "maximized";
  const style = !floating ? undefined : expanded
    ? { left: 24, top: 72, right: "auto", bottom: "auto", width: "calc(100vw - 48px)", height: "calc(100vh - 96px)" }
    : bounds ? { left: bounds.left, top: bounds.top, right: "auto", bottom: "auto", width: bounds.width, height: bounds.height } : { right: 24, bottom: 24 };

  return <div className={`common-popup-backdrop ${floating ? "is-floating" : ""}`}><div ref={panel} role={kind} aria-modal={floating ? undefined : true} aria-labelledby={titleId} aria-describedby={descriptionId} className={`common-popup ${className} ${floating ? "is-floating" : ""} is-${mode}`} style={style} onMouseUp={saveBounds}>
    <div className="common-popup-header" onMouseDown={drag}><h2 id={titleId}>{title}</h2><div>
      {floating ? <button type="button" aria-label="최소화" onClick={minimize}>—</button> : null}
      {floating || maximizable ? <button type="button" aria-label={expanded ? "복원" : "확대"} onClick={maximize}>{expanded ? "↙" : "↗"}</button> : null}
      <button ref={close} type="button" aria-label="닫기" disabled={saving} onClick={closeRequest}>×</button>
    </div></div>
    <p id={descriptionId} className="common-popup-description">변경 사항은 저장 또는 닫기 확인 후 반영됩니다.</p>
    {mode !== "minimized" ? <div className="common-popup-body">{error ? <div role="alert" className="common-popup-error">{error}</div> : null}{children}</div> : null}
    {saving ? <div role="status" className="common-popup-saving">저장 중입니다.</div> : null}
    {confirm ? <div ref={confirmPanel} role="alertdialog" aria-modal="true" aria-labelledby={confirmTitleId} aria-describedby={confirmDescriptionId} className="common-popup-confirm" onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancelConfirm(); } }}><strong id={confirmTitleId}>변경사항을 닫을까요?</strong><span id={confirmDescriptionId}>저장하지 않은 입력은 사라집니다.</span><div><button ref={continueButton} type="button" onClick={cancelConfirm}>계속 작성</button><button type="button" onClick={onClose}>닫기</button></div></div> : null}
  </div></div>;
}

export function PopupSystemDemo() {
  const [modal, setModal] = useState(false), [floating, setFloating] = useState(false), [dirty, setDirty] = useState(false), [error, setError] = useState(""), [saving, setSaving] = useState(false);
  const modalInput = useRef<HTMLInputElement>(null);
  const save = () => { setSaving(true); setTimeout(() => { setSaving(false); setError("검수용 오류 상태: 입력값을 확인하세요."); }, 350); };
  return <main className="popup-demo"><h1>UI-004 공통 팝업 검수</h1><p>개발 환경 전용 검수 화면입니다.</p><button onClick={() => setModal(true)}>중앙 모달 열기</button><button onClick={() => setFloating(true)}>Floating 팝업 열기</button><CommonPopup title="중앙 모달" open={modal} onClose={() => setModal(false)} dirty={dirty} error={error} saving={saving} initialFocusRef={modalInput}><input ref={modalInput} aria-label="검수 입력" onChange={() => setDirty(true)} placeholder="변경사항 검수"/><button onClick={save} disabled={saving}>저장</button></CommonPopup><CommonPopup title="Floating 팝업" floating open={floating} onClose={() => setFloating(false)} dirty={dirty} error={error} saving={saving}><textarea aria-label="floating 검수 입력" onChange={() => setDirty(true)} placeholder="크기와 위치를 조절하세요."/><button onClick={save} disabled={saving}>저장</button></CommonPopup></main>;
}
