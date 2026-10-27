"use client";

import type { InstanceProgress } from "@wow/blizzard";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { classColor, classText } from "@/lib/game";
import { tr } from "@/lib/text";
import type { GameVersion } from "@/lib/types";
import type { DetailsRow } from "./RosterDetails";

const DIFFICULTY_ORDER = ["LFR", "NORMAL", "HEROIC", "MYTHIC", "MYTHIC_KEYSTONE"];
const rank = (d: string) => {
  const i = DIFFICULTY_ORDER.indexOf(d);
  return i === -1 ? DIFFICULTY_ORDER.length : i;
};
const instanceKey = (i: InstanceProgress) => String(i.id ?? tr(i.name, "en"));
const bossKey = (b: { id?: number; name: Record<string, string> }) => String(b.id ?? tr(b.name, "en"));

/**
 * How many times each character killed each boss of one instance and difficulty, like Raider.IO's and Warcraft
 * Logs' boss tables. Kills come from whatever the version provides (Blizzard encounters, MoP statistics or
 * Warcraft Logs), already normalized into the characters' instance progress.
 */
export function BossKillsTable({ version, rows, instances, kind }: { version: GameVersion; rows: DetailsRow[]; instances: InstanceProgress[]; kind: "raids" | "dungeons" }) {
  const t = useTranslations("details");
  const locale = useLocale();
  const format = useFormatter();
  const [instanceId, setInstanceId] = useState(instances[0] ? instanceKey(instances[0]) : "");
  const own = (row: DetailsRow) => row.details?.[kind]?.find((i) => instanceKey(i) === instanceId);

  // Difficulties anyone in the roster has data for in this instance, highest first.
  const difficulties = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of rows) {
      for (const m of own(row)?.modes ?? []) {
        if (m.difficulty !== "UNKNOWN" && m.encounters.length > 0) seen.set(m.difficulty, tr(m.difficultyName, locale) || m.difficulty);
      }
    }
    return [...seen.entries()].sort((a, b) => rank(b[0]) - rank(a[0]));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- own() only depends on rows, kind and instanceId.
  }, [rows, kind, instanceId, locale]);
  const [difficultyChoice, setDifficulty] = useState<string | undefined>(undefined);
  const difficulty = difficulties.some(([d]) => d === difficultyChoice) ? difficultyChoice! : difficulties[0]?.[0];

  // Bosses in encounter order, merged across characters (one may have data for a boss another lacks).
  const bosses = useMemo(() => {
    const list = new Map<string, Record<string, string>>();
    for (const row of rows) {
      const mode = own(row)?.modes.find((m) => m.difficulty === difficulty);
      for (const b of mode?.encounters ?? []) if (!list.has(bossKey(b))) list.set(bossKey(b), b.name);
    }
    return [...list.entries()];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- own() only depends on rows, kind and instanceId.
  }, [rows, kind, instanceId, difficulty]);

  const killsOf = (row: DetailsRow) => {
    const mode = own(row)?.modes.find((m) => m.difficulty === difficulty);
    return new Map((mode?.encounters ?? []).map((b) => [bossKey(b), b]));
  };
  const maxKills = Math.max(1, ...rows.flatMap((row) => [...killsOf(row).values()].map((b) => b.kills)));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <label className="text-sm" htmlFor={`${kind}-boss-instance`}>{t(kind === "raids" ? "raid" : "dungeon")}</label>
        <select id={`${kind}-boss-instance`} className="input w-auto max-w-full" value={instanceId} onChange={(e) => setInstanceId(e.target.value)}>
          {instances.map((i) => (
            <option key={instanceKey(i)} value={instanceKey(i)}>{tr(i.name, locale)}</option>
          ))}
        </select>
        {difficulties.length > 1 && (
          <>
            <label className="text-sm" htmlFor={`${kind}-boss-difficulty`}>{t("difficulty")}</label>
            <select id={`${kind}-boss-difficulty`} className="input w-auto" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
              {difficulties.map(([d, name]) => (
                <option key={d} value={d}>{name}</option>
              ))}
            </select>
          </>
        )}
      </div>
      {bosses.length === 0 ? (
        <p className="p-4 text-sm text-muted">{t("noBossKills")}</p>
      ) : (
        // A boss matrix needs one column per boss, so this table (unlike the others) scrolls sideways on narrow screens.
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-surface-2 text-xs text-muted">
              <tr>
                <th className="sticky left-0 z-10 bg-surface-2 px-3 py-2 text-left font-medium uppercase tracking-wide">{t("character")}</th>
                <th className="px-2 py-2 text-center font-medium uppercase tracking-wide">{t("bossesKilled")}</th>
                {bosses.map(([key, name]) => (
                  <th key={key} className="min-w-16 px-2 py-2 text-center align-bottom font-medium" title={tr(name, locale)}>
                    <span className="line-clamp-2">{tr(name, locale)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => {
                const kills = killsOf(row);
                const killed = bosses.filter(([key]) => (kills.get(key)?.kills ?? 0) > 0).length;
                const c = row.character;
                return (
                  <tr key={c.entryId}>
                    <td className="sticky left-0 z-10 bg-surface px-3 py-1.5">
                      <span className={`text-class font-medium ${row.alt ? "pl-3 text-xs" : ""}`} style={classText(classColor(version, c.classId))}>
                        {c.name}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-center tabular-nums">
                      {kills.size === 0 ? <span className="text-muted">—</span> : `${killed}/${bosses.length}`}
                    </td>
                    {bosses.map(([key, name]) => {
                      const boss = kills.get(key);
                      const n = boss?.kills ?? 0;
                      const last = boss?.lastKillAt ? format.dateTime(new Date(boss.lastKillAt), { dateStyle: "medium" }) : null;
                      return (
                        <td
                          key={key}
                          className="px-2 py-1.5 text-center tabular-nums"
                          title={n > 0 ? t("bossKillsTitle", { boss: tr(name, locale), count: n, last: last ?? "—" }) : undefined}
                          // The cell's shade grows with the kills, relative to the roster's most-killed boss.
                          style={n > 0 ? { backgroundColor: `color-mix(in oklab, var(--accent) ${Math.round(8 + (n / maxKills) * 32)}%, transparent)` } : undefined}
                        >
                          {n > 0 ? n : <span className="text-muted">·</span>}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
