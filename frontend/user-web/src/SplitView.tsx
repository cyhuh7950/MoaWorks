import { CSSProperties, KeyboardEvent, PointerEvent, ReactNode, useEffect, useRef, useState } from "react";

type SplitViewProps = {
  ariaLabel: string;
  storageKey: string;
  primary: ReactNode;
  secondary: ReactNode;
  secondaryMaximized?: boolean;
  defaultRatio?: number;
  minRatio?: number;
  maxRatio?: number;
};

const clampRatio = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const readStoredRatio = (storageKey: string, fallback: number, min: number, max: number) => {
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (stored === null) return fallback;
    const parsed = Number(stored);
    return Number.isFinite(parsed) ? clampRatio(parsed, min, max) : fallback;
  } catch {
    return fallback;
  }
};

export function SplitView({
  ariaLabel,
  storageKey,
  primary,
  secondary,
  secondaryMaximized = false,
  defaultRatio = 50,
  minRatio = 25,
  maxRatio = 75,
}: SplitViewProps) {
  const safeDefault = clampRatio(defaultRatio, minRatio, maxRatio);
  const [ratio, setRatio] = useState(() => readStoredRatio(storageKey, safeDefault, minRatio, maxRatio));
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setRatio(readStoredRatio(storageKey, safeDefault, minRatio, maxRatio));
  }, [maxRatio, minRatio, safeDefault, storageKey]);

  const updateRatio = (nextRatio: number, persist = false) => {
    const safeRatio = clampRatio(nextRatio, minRatio, maxRatio);
    setRatio(safeRatio);
    if (!persist) return;
    try {
      window.localStorage.setItem(storageKey, String(safeRatio));
    } catch {
      // Storage can be unavailable in privacy-restricted browser contexts.
    }
  };

  const updateFromPointer = (clientX: number, persist = false) => {
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0) return;
    updateRatio(((clientX - bounds.left) / bounds.width) * 100, persist);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFromPointer(event.clientX);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) updateFromPointer(event.clientX);
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    updateFromPointer(event.clientX, true);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      updateRatio(ratio + (event.key === "ArrowLeft" ? -2 : 2), true);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      updateRatio(event.key === "Home" ? minRatio : maxRatio, true);
    }
  };

  return (
    <div
      ref={containerRef}
      className={`user-split-view${secondaryMaximized ? " is-secondary-maximized" : ""}`}
      data-split-ratio={ratio.toFixed(2)}
      style={{ "--split-primary-ratio": `${ratio}%` } as CSSProperties}
    >
      <div className="user-split-view__pane user-split-view__primary">{primary}</div>
      <div
        className="user-split-view__separator"
        role="separator"
        aria-label={ariaLabel}
        aria-orientation="vertical"
        aria-valuemin={minRatio}
        aria-valuemax={maxRatio}
        aria-valuenow={Math.round(ratio)}
        tabIndex={secondaryMaximized ? -1 : 0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={handleKeyDown}
      >
        <span aria-hidden="true" />
      </div>
      <div className="user-split-view__pane user-split-view__secondary">{secondary}</div>
    </div>
  );
}
