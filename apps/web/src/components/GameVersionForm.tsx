"use client";

import { localize } from "@wow/config";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "@/i18n/routing";
import { ApiError, apiSend } from "@/lib/client-api";
import type { GameVersion, Guild } from "@/lib/types";
import { VersionSelect } from "./VersionSelect";

interface Props {
  guild: Guild;
  versions: GameVersion[];
  /** Real (non-planned) characters tie the roster to their game version's API. */
  hasRealCharacters: boolean;
}

/**
 * Owner-only: the game version decides the roster's classes, specs, buffs and API. It can only
 * change on custom rosters that hold planned characters alone.
 */
export function GameVersionForm({ guild, versions, hasRealCharacters }: Props) {
  const t = useTranslations("versions");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const router = useRouter();
  const [value, setValue] = useState(guild.gameVersion);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const current = versions.find((v) => v.id === guild.gameVersion);
  const locked = guild.kind === "guild" ? t("lockedGuild") : hasRealCharacters ? t("lockedCharacters") : null;

  return (
    <form
      className="card space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        if (value === guild.gameVersion || !window.confirm(t("confirm"))) return;
        setPending(true);
        setMessage(null);
        try {
          await apiSend("PATCH", `/guilds/${guild.id}`, { gameVersion: value });
          setMessage({ ok: true, text: t("changed") });
          router.refresh();
        } catch (err) {
          setMessage({ ok: false, text: err instanceof ApiError && tErrors.has(err.code) ? tErrors(err.code) : tErrors("unknown_error") });
        } finally {
          setPending(false);
        }
      }}
    >
      <div>
        <h2 className="heading text-lg">{t("title")}</h2>
        <p className="text-xs text-muted">{t("help")}</p>
      </div>
      {locked ? (
        <>
          <p className="font-medium">{current ? localize(current.name, locale) : guild.gameVersion}</p>
          <p className="text-xs text-muted">{locked}</p>
        </>
      ) : (
        <>
          <VersionSelect id="settings-version" versions={versions} value={value} onChange={setValue} />
          <p className="text-xs text-muted">{t("changeHelp")}</p>
          <button type="submit" className="btn btn-primary" disabled={pending || value === guild.gameVersion}>
            {pending ? t("saving") : t("save")}
          </button>
        </>
      )}
      {message && (
        <p role="status" className={`text-sm ${message.ok ? "text-success" : "text-danger"}`}>
          {message.text}
        </p>
      )}
    </form>
  );
}
