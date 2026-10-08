"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "@/i18n/routing";
import { ApiError, apiSend } from "@/lib/client-api";
import { classColor, className, classText, specName } from "@/lib/game";
import type { GameVersion, PendingEntry } from "@/lib/types";

interface Props {
  guildId: string;
  profile: GameVersion;
  entries: PendingEntry[];
  /** Owners and officers accept or reject every proposal; a proposer only sees and withdraws their own. */
  canModerate: boolean;
}

/** Proposals sent to a roster open to them, waiting for an officer. */
export function PendingPanel({ guildId, profile, entries, canModerate }: Props) {
  const t = useTranslations("pending");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const format = useFormatter();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (entries.length === 0) return null;

  async function act(entryId: string, action: () => Promise<unknown>) {
    setBusy(entryId);
    setError(null);
    try {
      await action();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError && tErrors.has(err.code) ? tErrors(err.code) : tErrors("unknown_error"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card space-y-3 border-warning/60" aria-labelledby="pending-title">
      <div>
        <h2 id="pending-title" className="heading text-lg">
          {t(canModerate ? "titleOwner" : "titleMine", { count: entries.length })}
        </h2>
        <p className="text-xs text-muted">{t(canModerate ? "helpOwner" : "helpMine", { count: entries.length })}</p>
      </div>
      <ul className="divide-y divide-border">
        {entries.map((e) => (
          <li key={e.entryId} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2">
                <span className="text-class font-medium" style={classText(classColor(profile, e.classId))}>
                  {e.name}
                </span>
                <span className="text-sm text-muted">
                  {specName(profile, e.classId, e.specKey, locale)} {className(profile, e.classId, locale)}
                  {e.planned ? ` · ${t("planned")}` : e.level ? ` · ${t("level", { level: e.level })}` : ""}
                </span>
              </p>
              <p className="text-xs text-muted">
                {/* Logged-in proposers show their battletag; anonymous ones the name they typed. */}
                {canModerate && (e.submittedBy ?? e.playerName) ? `${t("by", { name: (e.submittedBy ?? e.playerName)! })} · ` : ""}
                {format.relativeTime(new Date(e.submittedAt))}
                {e.note ? ` · ${e.note}` : ""}
              </p>
            </div>
            <div className="flex gap-2">
              {canModerate && (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy !== null}
                  onClick={() => act(e.entryId, () => apiSend("POST", `/guilds/${guildId}/roster/${e.entryId}/approve`))}
                >
                  {t("accept")}
                </button>
              )}
              <button
                type="button"
                className="btn"
                disabled={busy !== null}
                onClick={() => {
                  if (window.confirm(t(canModerate ? "confirmReject" : "confirmWithdraw", { name: e.name }))) {
                    void act(e.entryId, () => apiSend("DELETE", `/guilds/${guildId}/roster/${e.entryId}`));
                  }
                }}
              >
                {t(canModerate ? "reject" : "withdraw")}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
