"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { ApiError } from "@/lib/client-api";

/** Button that fetches the roster's BiS wishlists as Gargul CSV and shows it in a copy box. */
export function GargulExport({ guildId }: { guildId: string }) {
  const t = useTranslations("gargul");
  const tErrors = useTranslations("errors");
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [players, setPlayers] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function load() {
    setOpen(true);
    setLoading(true);
    setError(null);
    setCopied(false);
    try {
      const res = await fetch(`/api/guilds/${guildId}/bis-export`, { credentials: "same-origin" });
      const data = (await res.json().catch(() => ({}))) as { content?: string; players?: number; error?: string };
      if (!res.ok) throw new ApiError(res.status, data.error ?? "unknown_error");
      setContent(data.content ?? "");
      setPlayers(data.players ?? 0);
    } catch (err) {
      setError(err instanceof ApiError && tErrors.has(err.code) ? tErrors(err.code) : tErrors("unknown_error"));
      setContent(null);
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
    } catch {
      // Clipboard can be blocked; the textarea is selectable as a fallback.
    }
  }

  return (
    <>
      <button type="button" className="btn" onClick={load}>
        {t("button")}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4" role="dialog" aria-modal="true" onClick={() => setOpen(false)}>
          <div className="card my-8 w-full max-w-2xl space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="heading text-lg">{t("title")}</h3>
              <button type="button" className="btn" onClick={() => setOpen(false)}>
                {t("close")}
              </button>
            </div>
            <p className="text-sm text-muted">{t("help")}</p>
            {loading && <p className="text-sm text-muted">{t("loading")}</p>}
            {error && (
              <p className="text-sm text-danger" role="alert">
                {error}
              </p>
            )}
            {content !== null && !loading && (
              content === "" ? (
                <p className="text-sm text-muted">{t("empty")}</p>
              ) : (
                <>
                  <textarea readOnly className="input h-48 w-full font-mono text-xs" value={content} onFocus={(e) => e.currentTarget.select()} />
                  <div className="flex items-center gap-3">
                    <button type="button" className="btn btn-primary" onClick={copy}>
                      {copied ? t("copied") : t("copy")}
                    </button>
                    <span className="text-xs text-muted">{t("count", { count: players })}</span>
                  </div>
                </>
              )
            )}
          </div>
        </div>
      )}
    </>
  );
}
