"use client";

import { localize } from "@wow/config";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "@/i18n/routing";
import { ApiError, apiSend } from "@/lib/client-api";
import type { Guild, GuildRank, PublicConfig } from "@/lib/types";

interface Props {
  guild: Guild;
  ranks: GuildRank[];
  profile: PublicConfig["profile"];
}

export function GuildSettingsForm({ guild, ranks: initialRanks, profile }: Props) {
  const t = useTranslations("settings");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const router = useRouter();
  const [ranks, setRanks] = useState(initialRanks);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  // Ranks, level threshold and officer rank only exist for rosters linked to an in-game guild.
  const linked = guild.kind === "guild";

  async function save(action: () => Promise<unknown>) {
    setPending(true);
    setMessage(null);
    try {
      await action();
      setMessage({ kind: "ok", text: t("saved") });
      router.refresh();
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof ApiError && tErrors.has(err.code) ? tErrors(err.code) : tErrors("unknown_error") });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <form
        className="card grid gap-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void save(() =>
            apiSend(
              "PATCH",
              `/guilds/${guild.id}`,
              linked
                ? {
                    public: data.get("public") === "on",
                    syncIntervalMinutes: Number(data.get("syncIntervalMinutes")),
                    minLevel: Number(data.get("minLevel")),
                    officerMaxRank: Number(data.get("officerMaxRank")),
                  }
                : {
                    name: String(data.get("name")),
                    public: data.get("public") === "on",
                    syncIntervalMinutes: Number(data.get("syncIntervalMinutes")),
                  },
            ),
          );
        }}
      >
        <h2 className="heading text-lg sm:col-span-2">{t("general")}</h2>
        {!linked && (
          <div className="sm:col-span-2">
            <label className="label" htmlFor="roster-name">{t("name")}</label>
            <input id="roster-name" name="name" required maxLength={60} defaultValue={guild.name} className="input" />
          </div>
        )}
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" name="public" defaultChecked={guild.public} />
          {t("public")}
        </label>
        <div>
          <label className="label" htmlFor="syncIntervalMinutes">{t("syncInterval")}</label>
          <input
            id="syncIntervalMinutes"
            name="syncIntervalMinutes"
            type="number"
            min={profile.sync.minIntervalMinutes}
            max={1440}
            defaultValue={guild.syncIntervalMinutes}
            className="input"
          />
          <p className="mt-1 text-xs text-muted">{t("syncIntervalHelp", { min: profile.sync.minIntervalMinutes })}</p>
        </div>
        {linked && (
          <>
            <div>
              <label className="label" htmlFor="minLevel">{t("minLevel")}</label>
              <input id="minLevel" name="minLevel" type="number" min={1} max={profile.maxLevel} defaultValue={guild.minLevel} className="input" />
              <p className="mt-1 text-xs text-muted">{t("minLevelHelp")}</p>
            </div>
            <div>
              <label className="label" htmlFor="officerMaxRank">{t("officerMaxRank")}</label>
              <input id="officerMaxRank" name="officerMaxRank" type="number" min={0} max={9} defaultValue={guild.officerMaxRank} className="input" />
              <p className="mt-1 text-xs text-muted">{t("officerMaxRankHelp")}</p>
            </div>
          </>
        )}
        <div className="flex items-end sm:col-span-2">
          <button type="submit" className="btn btn-primary" disabled={pending}>{t("save")}</button>
        </div>
      </form>

      {linked && (
      <div className="card space-y-3">
        <h2 className="heading text-lg">{t("ranks")}</h2>
        <p className="text-xs text-muted">{t("ranksHelp")}</p>
        {ranks.length === 0 ? (
          <p className="text-sm text-muted">{t("noRanks")}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="py-1">{t("rank")}</th>
                <th className="py-1">{t("rankLabel")}</th>
                <th className="py-1">{t("rankStatus")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {ranks.map((rank, index) => (
                <tr key={rank.rank}>
                  <td className="py-1.5 tabular-nums">{rank.rank === 0 ? t("guildMaster") : rank.rank}</td>
                  <td className="py-1.5 pr-2">
                    <input
                      aria-label={t("rankLabel")}
                      className="input"
                      value={rank.label ?? ""}
                      maxLength={40}
                      onChange={(e) => setRanks((rs) => rs.map((r, i) => (i === index ? { ...r, label: e.target.value } : r)))}
                    />
                  </td>
                  <td className="py-1.5">
                    <select
                      aria-label={t("rankStatus")}
                      className="input"
                      value={rank.status}
                      onChange={(e) => setRanks((rs) => rs.map((r, i) => (i === index ? { ...r, status: e.target.value } : r)))}
                    >
                      {profile.rosterStatuses.map((s) => (
                        <option key={s.key} value={s.key}>{localize(s.name, locale)}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending || ranks.length === 0}
          onClick={() =>
            void save(() =>
              apiSend("PUT", `/guilds/${guild.id}/ranks`, ranks.map((r) => ({ rank: r.rank, label: r.label || null, status: r.status }))),
            )
          }
        >
          {t("saveRanks")}
        </button>
      </div>
      )}

      {message && (
        <p className={`text-sm ${message.kind === "ok" ? "text-success" : "text-danger"}`} role="status">
          {message.text}
        </p>
      )}
    </div>
  );
}
