"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "@/i18n/routing";
import { ApiError, apiSend } from "@/lib/client-api";
import type { Guild } from "@/lib/types";

/** Owner-only: list the roster for every signed-in user, who can then propose characters. */
export function PublishForm({ guild }: { guild: Guild }) {
  const t = useTranslations("publish");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  // Shown at once and rolled back if the save fails, so the checkbox reacts to the click.
  const [published, setPublished] = useState(guild.published);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(next: boolean) {
    setPublished(next);
    setPending(true);
    setError(null);
    try {
      await apiSend("PATCH", `/guilds/${guild.id}`, { published: next });
      router.refresh();
    } catch (err) {
      setPublished(!next);
      setError(err instanceof ApiError && tErrors.has(err.code) ? tErrors(err.code) : tErrors("unknown_error"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="card space-y-3">
      <div>
        <h2 className="heading text-lg">{t("title")}</h2>
        <p className="text-xs text-muted">{t("help")}</p>
      </div>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={published} disabled={pending} onChange={(e) => toggle(e.target.checked)} />
        {t("label")}
      </label>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
