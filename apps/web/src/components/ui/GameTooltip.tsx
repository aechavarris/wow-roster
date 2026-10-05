"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface Props {
  content: ReactNode;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Accessible name for the trigger button. */
  label: string;
}

const GAP = 10;

/**
 * In-game style tooltip. Opens on hover and keyboard focus, toggles on tap for touch
 * screens, and renders in a portal so scrolling containers never clip it.
 */
export function GameTooltip({ content, children, className = "", style, label }: Props) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  // Touch browsers emulate mouseenter right before click; that click must not close what it just opened.
  const openedAt = useRef(0);
  const show = () => {
    openedAt.current = Date.now();
    setOpen(true);
  };

  const place = useCallback(() => {
    const trigger = triggerRef.current?.getBoundingClientRect();
    const tooltip = tooltipRef.current?.getBoundingClientRect();
    if (!trigger || !tooltip) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Prefer the right side like the game; flip left, then clamp into the viewport.
    let left = trigger.right + GAP;
    if (left + tooltip.width > vw - GAP) left = trigger.left - tooltip.width - GAP;
    left = Math.max(GAP, Math.min(left, vw - tooltip.width - GAP));
    let top = trigger.top;
    if (top + tooltip.height > vh - GAP) top = vh - tooltip.height - GAP;
    setPosition({ left, top: Math.max(GAP, top) });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event.type === "keydown" && (event as KeyboardEvent).key !== "Escape") return;
      if (event.type === "pointerdown" && triggerRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        className={className}
        style={style}
        onMouseEnter={show}
        onMouseLeave={() => setOpen(false)}
        onFocus={show}
        onBlur={() => setOpen(false)}
        onClick={() => {
          if (Date.now() - openedAt.current < 400) return;
          setOpen((o) => !o);
        }}
      >
        {children}
      </button>
      {open &&
        createPortal(
          <div
            ref={tooltipRef}
            id={id}
            role="tooltip"
            className="game-tooltip"
            style={{ left: position?.left ?? -9999, top: position?.top ?? -9999 }}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
