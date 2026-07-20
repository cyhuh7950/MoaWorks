import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { CommonPopup } from "./CommonPopup";

export type FeedbackTone = "success" | "info" | "warning" | "error";

export type FeedbackItem = {
  id: string;
  source: string;
  tone: FeedbackTone;
  title: string;
  message?: string;
  details?: string[];
  persistent?: boolean;
  action?: { label: string; onAction: () => void };
};

export function useFeedbackQueue() {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const push = useCallback((item: FeedbackItem) => setItems((current) => {
    const duplicate = current.some((entry) => entry.id === item.id || (
      entry.source === item.source && entry.title === item.title && entry.message === item.message
    ));
    return duplicate ? current : [...current, item];
  }), []);
  const dismiss = useCallback((id: string) => setItems((current) => current.filter((item) => item.id !== id)), []);
  const clearSource = useCallback((source: string) => setItems((current) => current.filter((item) => item.source !== source)), []);
  const clearTransient = useCallback(() => setItems((current) => current.filter((item) => item.persistent)), []);
  return { items, push, dismiss, clearSource, clearTransient };
}

function Toast({ item, onDismiss }: { item: FeedbackItem; onDismiss: (id: string) => void }) {
  useEffect(() => {
    if (item.persistent) return;
    const timer = window.setTimeout(() => onDismiss(item.id), 3600);
    return () => window.clearTimeout(timer);
  }, [item.id, item.persistent, onDismiss]);

  return <article className={`feedback-toast is-${item.tone}`} role={item.tone === "error" ? "alert" : "status"} aria-atomic="true">
    <div className="feedback-toast-copy"><strong>{item.title}</strong>{item.message ? <span>{item.message}</span> : null}</div>
    {item.action ? <button type="button" onClick={item.action.onAction}>{item.action.label}</button> : null}
    <button type="button" className="feedback-toast-close" aria-label={`${item.title} 닫기`} onClick={() => onDismiss(item.id)}>닫기</button>
  </article>;
}

export function ToastViewport({ items, onDismiss }: { items: FeedbackItem[]; onDismiss: (id: string) => void }) {
  return <section className="feedback-toast-viewport" aria-label="업무 처리 결과">
    {items.map((item) => <Toast key={item.id} item={item} onDismiss={onDismiss} />)}
  </section>;
}

export function CompactWarning({ item, onDismiss }: { item: FeedbackItem; onDismiss?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const count = item.details?.length ?? 0;
  return <aside className={`feedback-warning is-${item.tone}`} aria-label={item.title}>
    <button type="button" className="feedback-warning-summary" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>
      <span aria-hidden="true">!</span><strong>{item.title}</strong>{count ? <small>{count}건</small> : null}
    </button>
    {expanded ? <div className="feedback-warning-detail">
      {item.message ? <p>{item.message}</p> : null}
      {item.details?.length ? <ul>{item.details.map((detail) => <li key={detail}>{detail}</li>)}</ul> : null}
      <div>{item.action ? <button type="button" onClick={item.action.onAction}>{item.action.label}</button> : null}{onDismiss ? <button type="button" onClick={onDismiss}>닫기</button> : null}</div>
    </div> : null}
  </aside>;
}

type FeedbackStateProps = {
  state: "loading" | "empty" | "error";
  title: string;
  message?: string;
  action?: { label: string; onAction: () => void };
};

export function FeedbackState({ state, title, message, action }: FeedbackStateProps) {
  return <div className={`feedback-state is-${state}`} role={state === "error" ? "alert" : "status"} aria-live={state === "error" ? "assertive" : "polite"}>
    {state === "loading" ? <span className="feedback-state-spinner" aria-hidden="true" /> : null}
    <strong>{title}</strong>
    {message ? <span>{message}</span> : null}
    {action ? <button type="button" onClick={action.onAction}>{action.label}</button> : null}
  </div>;
}

type ConfirmModalProps = {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
};

export function ConfirmModal({ open, title, message, confirmLabel, busy = false, onCancel, onConfirm }: ConfirmModalProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return <CommonPopup title={title} open={open} onClose={onCancel} saving={busy} initialFocusRef={cancelRef} kind="alertdialog">
    <div className="feedback-confirm-message">{message}</div>
    <div className="feedback-confirm-actions">
      <button ref={cancelRef} type="button" onClick={onCancel} disabled={busy}>취소</button>
      <button type="button" className="is-destructive" onClick={() => void onConfirm()} disabled={busy}>{confirmLabel}</button>
    </div>
  </CommonPopup>;
}


export function FeedbackSystemDemo() {
  const { items, push, dismiss, clearTransient } = useFeedbackQueue();
  const [warningVisible, setWarningVisible] = useState(false);
  const [state, setState] = useState<"loading" | "empty" | "error">("empty");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [popupOpen, setPopupOpen] = useState(false);
  const [popupError, setPopupError] = useState("");
  const [popupValue, setPopupValue] = useState("");
  const [popupSaving, setPopupSaving] = useState(false);

  const showSuccess = () => push({ id: "demo-save", source: "demo", tone: "success", title: "저장이 완료되었습니다." });
  const popupSuccess = () => {
    setPopupSaving(true);
    window.setTimeout(() => {
      setPopupSaving(false);
      setPopupError("");
      setPopupOpen(false);
      push({ id: "demo-popup-success", source: "demo-popup", tone: "success", title: "팝업 작업을 완료했습니다." });
    }, 180);
  };

  return <main className="feedback-demo">
    <h1>UI-007 공통 피드백 검수</h1>
    <div className="feedback-demo-toolbar">
      <button type="button" onClick={showSuccess}>성공 toast</button>
      <button type="button" onClick={showSuccess}>중복 toast</button>
      <button type="button" onClick={() => setWarningVisible((current) => !current)}>compact warning</button>
      <button type="button" onClick={() => setConfirmOpen(true)}>confirm modal</button>
      <button type="button" onClick={() => setPopupOpen(true)}>업무 popup</button>
      <button type="button" onClick={clearTransient}>임시 피드백 정리</button>
    </div>
    {warningVisible ? <CompactWarning item={{ id: "demo-warning", source: "demo", tone: "warning", title: "확인할 항목", message: "현재 업무를 막지 않는 확인 항목입니다.", details: ["첫 번째 확인", "두 번째 확인"] }} onDismiss={() => setWarningVisible(false)} /> : null}
    <section className="feedback-demo-states">
      {(["loading", "empty", "error"] as const).map((next) => <button key={next} type="button" aria-pressed={state === next} onClick={() => setState(next)}>{next}</button>)}
      <FeedbackState state={state} title={state === "loading" ? "데이터를 불러오는 중입니다." : state === "empty" ? "표시할 데이터가 없습니다." : "데이터를 불러오지 못했습니다."} message={state === "error" ? "잠시 후 다시 시도해 주세요." : undefined} action={state === "error" ? { label: "다시 시도", onAction: () => setState("loading") } : undefined} />
    </section>
    <ConfirmModal open={confirmOpen} title="검수 작업 확인" message="영향이 큰 작업을 실행하기 전에 확인합니다." confirmLabel="실행" onCancel={() => setConfirmOpen(false)} onConfirm={() => { setConfirmOpen(false); push({ id: "demo-confirm", source: "demo", tone: "success", title: "확인 작업을 실행했습니다." }); }} />
    <CommonPopup title="업무 처리" open={popupOpen} onClose={() => setPopupOpen(false)} error={popupError} saving={popupSaving} dirty={Boolean(popupValue)}>
      <input aria-label="업무 입력" value={popupValue} onChange={(event) => setPopupValue(event.target.value)} />
      <div className="feedback-confirm-actions"><button type="button" onClick={() => setPopupError("입력 내용을 확인해 주세요.")}>오류 재현</button><button type="button" onClick={popupSuccess} disabled={popupSaving}>성공 처리</button></div>
    </CommonPopup>
    <ToastViewport items={items} onDismiss={dismiss} />
  </main>;
}
