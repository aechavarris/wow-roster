"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { API_ACTIVITY_EVENT, type ApiActivity } from "@/lib/client-api";

interface Notice {
  id: number;
  ok: boolean;
  text: string;
}

/**
 * A call that starts this long after a click or submit is not attributed to it. Generous because a `confirm()`
 * dialog between the click and the request also counts.
 */
const TRIGGER_WINDOW_MS = 10_000;
const SUCCESS_MS = 2500;
const ERROR_MS = 6000;

/**
 * Feedback for every API action without wiring each form: the control the user clicked, submitted or changed gets
 * `aria-busy` (a spinner on buttons, a pulse on selects and checkboxes) while its request runs, a thin bar at the
 * top shows that something is in flight, and a notice confirms the result or explains the error. It listens to the
 * events `apiSend` announces, so new components get it for free.
 */
export function ActionFeedback() {
  const t = useTranslations("feedback");
  const tErrors = useTranslations("errors");
  const [inFlight, setInFlight] = useState(0);
  const [notices, setNotices] = useState<Notice[]>([]);
  const trigger = useRef<{ el: HTMLElement; at: number } | null>(null);
  const busy = useRef(new Map<number, HTMLElement>());

  useEffect(() => {
    const remember = (el: Element | null | undefined) => {
      if (el instanceof HTMLElement) trigger.current = { el, at: performance.now() };
    };
    const onClick = (e: MouseEvent) => remember((e.target as Element | null)?.closest?.("button, [role='button'], a"));
    const onSubmit = (e: SubmitEvent) =>
      remember(e.submitter ?? (e.target as HTMLFormElement).querySelector<HTMLElement>("[type='submit'], button:not([type])"));
    const onChange = (e: Event) => remember(e.target as Element | null);

    const setBusy = (el: HTMLElement) => {
      const count = Number(el.dataset.busyCount ?? 0) + 1;
      el.dataset.busyCount = String(count);
      el.setAttribute("aria-busy", "true");
    };
    const clearBusy = (el: HTMLElement) => {
      const count = Number(el.dataset.busyCount ?? 1) - 1;
      if (count > 0) {
        el.dataset.busyCount = String(count);
        return;
      }
      delete el.dataset.busyCount;
      el.removeAttribute("aria-busy");
    };

    const onActivity = (e: Event) => {
      const detail = (e as CustomEvent<ApiActivity>).detail;
      if (detail.phase === "start") {
        setInFlight((n) => n + 1);
        const recent = trigger.current;
        if (recent && performance.now() - recent.at < TRIGGER_WINDOW_MS && recent.el.isConnected) {
          busy.current.set(detail.id, recent.el);
          setBusy(recent.el);
        }
        return;
      }
      setInFlight((n) => Math.max(0, n - 1));
      const el = busy.current.get(detail.id);
      if (el) {
        busy.current.delete(detail.id);
        clearBusy(el);
      }
      if (detail.ok && detail.quiet) return;
      const text = detail.ok
        ? t(detail.method === "DELETE" ? "deleted" : detail.method === "POST" ? "done" : "saved")
        : tErrors.has(detail.code ?? "unknown_error")
          ? tErrors(detail.code ?? "unknown_error")
          : tErrors("unknown_error");
      const notice = { id: detail.id, ok: detail.ok, text };
      setNotices((list) => [...list.filter((n) => n.text !== text).slice(-2), notice]);
      setTimeout(() => setNotices((list) => list.filter((n) => n.id !== notice.id)), detail.ok ? SUCCESS_MS : ERROR_MS);
    };

    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    document.addEventListener("change", onChange, true);
    window.addEventListener(API_ACTIVITY_EVENT, onActivity);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
      document.removeEventListener("change", onChange, true);
      window.removeEventListener(API_ACTIVITY_EVENT, onActivity);
    };
  }, [t, tErrors]);

  return (
    <>
      {inFlight > 0 && <div className="activity-bar" role="progressbar" aria-label={t("working")} />}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 sm:items-end">
        {notices.map((n) => (
          <div
            key={n.id}
            role={n.ok ? "status" : "alert"}
            className={`toast pointer-events-auto ${n.ok ? "toast-ok" : "toast-error"}`}
            onClick={() => setNotices((list) => list.filter((x) => x.id !== n.id))}
          >
            <span aria-hidden="true">{n.ok ? "✓" : "✕"}</span>
            {n.text}
          </div>
        ))}
      </div>
    </>
  );
}
