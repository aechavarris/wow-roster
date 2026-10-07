"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { Link, useRouter } from "@/i18n/routing";
import { characterPath, classColor, classText } from "@/lib/game";
import { tr } from "@/lib/text";
import type { GameVersion, RosterCharacter, WeekInstance, WeeklyResponse } from "@/lib/types";

export interface WeeklyRow {
  character: RosterCharacter;
  alt: boolean;
}

const DIFFICULTY_SHORT: Record<string, string> = { LFR: "LFR", NORMAL: "N", HEROIC: "H", MYTHIC: "M", MYTHIC_KEYSTONE: "M+" };

/**
 * Columns come from the game version: raid bosses, Mythic+ runs and dungeon bosses only where its
 * API provides them, and the Great Vault only where its profile defines one.
 */
export function WeeklyAudit({ guildId, version, rows, weekly }: { guildId: string; version: GameVersion; rows: WeeklyRow[]; weekly: WeeklyResponse }) {
  const t = useTranslations("weekly");
  const format = useFormatter();
  const router = useRouter();
  const [tab, setTab] = useState<"week" | "history">("week");
  const [showAlts, setShowAlts] = useState(true);
  const shown = rows.filter((r) => showAlts || !r.alt);
  const weekLabel = (iso: string) =>
    `${format.dateTime(new Date(iso), { day: "numeric", month: "short" })}${iso === weekly.current ? ` · ${t("currentWeek")}` : ""}`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" className="flex flex-wrap gap-2">
          {(["week", "history"] as const).map((key) => (
            <button
              key={key}
              role="tab"
              type="button"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`btn ${tab === key ? "border-accent text-accent" : ""}`}
            >
              {t(`tabs.${key}`)}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {tab === "week" && (
            <label className="flex items-center gap-2 text-sm">
              {t("week")}
              <select
                className="input w-auto"
                value={weekly.week}
                onChange={(e) => router.push(`/guild/${guildId}/weekly${e.target.value === weekly.current ? "" : `?week=${e.target.value}`}`)}
              >
                {weekly.weeks.map((w) => (
                  <option key={w} value={w}>
                    {weekLabel(w)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showAlts} onChange={(e) => setShowAlts(e.target.checked)} />
            {t("showAlts")}
          </label>
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="card text-sm text-muted">{t("empty")}</p>
      ) : (
        <div className="card overflow-x-auto p-0">
          {tab === "week" ? <WeekTable version={version} rows={shown} weekly={weekly} /> : <HistoryTable version={version} rows={shown} weekly={weekly} weekLabel={weekLabel} />}
        </div>
      )}
    </div>
  );
}

const Th = ({ children, className = "" }: { children?: ReactNode; className?: string }) => (
  <th className={`whitespace-nowrap px-3 py-2 font-medium ${className}`}>{children}</th>
);
const Td = ({ children, className = "", title }: { children?: ReactNode; className?: string; title?: string }) => (
  <td className={`px-3 py-1.5 align-top ${className}`} title={title}>
    {children}
  </td>
);

function NameCell({ version, row }: { version: GameVersion; row: WeeklyRow }) {
  const c = row.character;
  const name = (
    <span className="text-class font-medium" style={classText(classColor(version, c.classId))}>
      {c.name}
    </span>
  );
  return (
    <td className="sticky left-0 z-10 whitespace-nowrap bg-surface px-3 py-1.5 align-top">
      {row.alt && <span className="mr-1 text-muted">↳</span>}
      {c.gameVersion && c.region && c.realm ? (
        <Link href={characterPath({ gameVersion: c.gameVersion, region: c.region, realm: c.realm, name: c.name })} className="hover:underline">
          {name}
        </Link>
      ) : (
        name
      )}
    </td>
  );
}

/** "Nerub-ar Palace: 6 H" per instance and difficulty; boss names on hover. */
function Instances({ list }: { list: WeekInstance[] }) {
  const locale = useLocale();
  if (list.length === 0) return <span className="text-muted">—</span>;
  return (
    <ul className="space-y-0.5">
      {list.map((i, n) => (
        <li key={n} title={i.bosses.map((b) => tr(b.name, locale)).join("\n")} className="whitespace-nowrap">
          {tr(i.name, locale)}: <span className="tabular-nums font-medium">{i.bosses.length}</span>{" "}
          <span className="text-muted">{DIFFICULTY_SHORT[i.difficulty] ?? (tr(i.difficultyName, locale) || i.difficulty)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Vault slots as three pips per row: filled when unlocked. */
function Vault({ unlocked, thresholds, count }: { unlocked: number; thresholds: number[]; count: number }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap" title={`${count} / ${thresholds.join(" · ")}`}>
      {thresholds.map((_, i) => (
        <span key={i} className={`inline-block h-3 w-3 rounded-sm border ${i < unlocked ? "border-accent bg-accent" : "border-border bg-surface-2"}`} />
      ))}
      <span className="ml-1 text-xs tabular-nums text-muted">{count}</span>
    </span>
  );
}

function WeekTable({ version, rows, weekly }: { version: GameVersion; rows: WeeklyRow[]; weekly: WeeklyResponse }) {
  const t = useTranslations("weekly");
  const locale = useLocale();
  const format = useFormatter();
  const has = (e: string) => version.characterEndpoints.includes(e);
  return (
    <>
      {/* Not min-w-max: the Mythic+ list wraps so the other columns stay on screen. */}
      <table className="w-full border-collapse text-sm">
        <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <Th className="sticky left-0 z-10 bg-surface-2">{t("character")}</Th>
            <Th>{t("itemLevel")}</Th>
            {weekly.vault && <Th>{t("vaultRaid")}</Th>}
            {weekly.vault && has("mythicPlus") && <Th>{t("vaultDungeons")}</Th>}
            {has("raids") && <Th>{t("raidBosses")}</Th>}
            {has("mythicPlus") && <Th>{t("mythicPlus")}</Th>}
            {has("dungeons") && <Th>{t("dungeonBosses")}</Th>}
            <Th>{t("updated")}</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => {
            const week = row.character.characterId ? weekly.characters[row.character.characterId] : undefined;
            return (
              <tr key={row.character.entryId}>
                <NameCell version={version} row={row} />
                <Td className="tabular-nums">{week?.itemLevel ?? "—"}</Td>
                {weekly.vault && (
                  <Td>{week?.vault ? <Vault unlocked={week.vault.raid} thresholds={weekly.vault.raid} count={week.vault.bosses} /> : "—"}</Td>
                )}
                {weekly.vault && has("mythicPlus") && (
                  <Td>
                    {week?.vault ? <Vault unlocked={week.vault.dungeons} thresholds={weekly.vault.dungeons} count={week.vault.runs} /> : "—"}
                  </Td>
                )}
                {has("raids") && <Td>{week ? <Instances list={week.activity.raids} /> : <span className="text-muted">{t("noData")}</span>}</Td>}
                {has("mythicPlus") && (
                  <Td className="min-w-56 text-xs">
                    {week && week.activity.mythicPlus.length > 0
                      ? week.activity.mythicPlus.map((run, i) => (
                          <span key={i} className={`mr-2 inline-block whitespace-nowrap ${run.timed ? "" : "text-muted"}`}>
                            +{run.level} {tr(run.dungeon, locale)}
                            {run.timed ? " ✓" : ""}
                          </span>
                        ))
                      : "—"}
                  </Td>
                )}
                {has("dungeons") && <Td>{week ? <Instances list={week.activity.dungeons} /> : "—"}</Td>}
                <Td className="whitespace-nowrap text-muted">{week ? format.relativeTime(new Date(week.updatedAt)) : "—"}</Td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t border-border px-3 py-2 text-xs text-muted">{t(weekly.vault ? "legendVault" : "legend")}</p>
    </>
  );
}

function HistoryTable({ version, rows, weekly, weekLabel }: { version: GameVersion; rows: WeeklyRow[]; weekly: WeeklyResponse; weekLabel: (iso: string) => string }) {
  const t = useTranslations("weekly");
  const has = (e: string) => version.characterEndpoints.includes(e);
  return (
    <>
      <table className="w-full min-w-max border-collapse text-sm">
        <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <Th className="sticky left-0 z-10 bg-surface-2">{t("character")}</Th>
            {weekly.weeks.map((w) => (
              <Th key={w}>{weekLabel(w)}</Th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => {
            const byWeek = new Map((weekly.history[row.character.characterId ?? ""] ?? []).map((h) => [h.weekStart, h]));
            return (
              <tr key={row.character.entryId}>
                <NameCell version={version} row={row} />
                {weekly.weeks.map((w) => {
                  const h = byWeek.get(w);
                  return (
                    <Td key={w} className="whitespace-nowrap tabular-nums">
                      {h ? (
                        <>
                          {has("raids") && <span className="mr-2">{t("bossesShort", { count: h.bosses })}</span>}
                          {has("mythicPlus") && <span className="mr-2">{t("runsShort", { count: h.runs })}</span>}
                          {h.itemLevel != null && <span className="text-xs text-muted">{t("ilvlShort", { value: Math.round(h.itemLevel) })}</span>}
                        </>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </Td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t border-border px-3 py-2 text-xs text-muted">{t("historyLegend")}</p>
    </>
  );
}
