"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "@/i18n/routing";
import { ApiError, apiSend } from "@/lib/client-api";
import type { Guild } from "@/lib/types";

/** Owner-only: deletes the roster after typing its name, since it cannot be undone. */
export function DeleteRosterForm({ guild }: { guild: Guild }) {
  const t = useTranslations("deleteRoster");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = name.trim() === guild.name;

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await apiSend("DELETE", `/guilds/${guild.id}`, { confirmName: name.trim() });
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError && tErrors.has(err.code) ? tErrors(err.code) : tErrors("unknown_error"));
      setBusy(false);
    }
  }

  return (
    <form
      className="card space-y-3 border-danger/60"
      onSubmit={(e) => {
        e.preventDefault();
        if (matches) void remove();
      }}
    >
      <div>
        <h2 className="heading text-lg text-danger">{t("title")}</h2>
        <p className="text-xs text-muted">{t(guild.kind === "guild" ? "helpGuild" : "help")}</p>
      </div>
      <div>
        {/* Not the uppercase .label style: the name must be typed exactly as written. */}
        <label className="mb-1 block text-sm" htmlFor="delete-roster-name">
          {t("confirmLabel", { name: guild.name })}
        </label>
        <input
          id="delete-roster-name"
          className="input"
          autoComplete="off"
          value={name}
          placeholder={guild.name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn border-danger text-danger" disabled={!matches || busy}>
        {busy ? t("deleting") : t("submit")}
      </button>
    </form>
  );
}
