"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { useRouter } from "@/i18n/routing";
import { tr } from "@/lib/text";
import type { GameVersion, WeekInstance, WeeklyResponse } from "@/lib/types";
import { Card, CardGrid, DetailRow, ExpandAllButton, ExpandProvider, Facts, LG, MD, SM, Table, Td, Th, useExpandedRows, type CharacterRow } from "./ui/CharacterTable";

export type WeeklyRow = CharacterRow;

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
  const { value: expand, allOpen, toggleAll } = useExpandedRows(shown);
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
          <ExpandAllButton allOpen={allOpen} onClick={toggleAll} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showAlts} onChange={(e) => setShowAlts(e.target.checked)} />
            {t("showAlts")}
          </label>
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="card text-sm text-muted">{t("empty")}</p>
      ) : (
        <ExpandProvider value={expand}>
          <div className="card p-0">
            {tab === "week" ? <WeekTable version={version} rows={shown} weekly={weekly} /> : <HistoryTable version={version} rows={shown} weekly={weekly} weekLabel={weekLabel} />}
          </div>
        </ExpandProvider>
      )}
    </div>
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

/** This week's Mythic+ runs, highest first; over-time runs in grey. */
function Runs({ runs }: { runs: WeeklyResponse["characters"][string]["activity"]["mythicPlus"] }) {
  const locale = useLocale();
  if (runs.length === 0) return <span className="text-muted">—</span>;
  return (
    <span className="flex flex-wrap gap-x-2">
      {[...runs]
        .sort((a, b) => b.level - a.level)
        .map((run, i) => (
          <span key={i} className={`whitespace-nowrap ${run.timed ? "" : "text-muted"}`}>
            +{run.level} {tr(run.dungeon, locale)}
            {run.timed ? " ✓" : ""}
          </span>
        ))}
    </span>
  );
}

function WeekTable({ version, rows, weekly }: { version: GameVersion; rows: WeeklyRow[]; weekly: WeeklyResponse }) {
  const t = useTranslations("weekly");
  const format = useFormatter();
  const has = (e: string) => version.characterEndpoints.includes(e) && !version.hiddenDetails.includes(e);
  const vaultDungeons = weekly.vault && has("mythicPlus");
  const span = 1 + 1 + (weekly.vault ? 1 : 0) + (vaultDungeons ? 1 : 0) + (has("raids") ? 1 : 0) + (has("mythicPlus") ? 1 : 0) + (has("dungeons") ? 1 : 0) + 1;
  return (
    <Table
      head={
        <>
          <Th>{t("character")}</Th>
          <Th className={SM}>{t("itemLevel")}</Th>
          {weekly.vault && <Th>{t("vaultRaid")}</Th>}
          {vaultDungeons && <Th>{t("vaultDungeons")}</Th>}
          {has("raids") && <Th className={MD}>{t("raidBosses")}</Th>}
          {has("mythicPlus") && <Th className={LG}>{t("mythicPlus")}</Th>}
          {has("dungeons") && <Th className={LG}>{t("dungeonBosses")}</Th>}
          <Th className={LG}>{t("updated")}</Th>
        </>
      }
      footer={t(weekly.vault ? "legendVault" : "legend")}
    >
      {rows.map((row) => {
        const week = row.character.characterId ? weekly.characters[row.character.characterId] : undefined;
        const noData = <span className="text-muted">{t("noData")}</span>;
        const raidVault = week?.vault && weekly.vault ? <Vault unlocked={week.vault.raid} thresholds={weekly.vault.raid} count={week.vault.bosses} /> : "—";
        const dungeonVault =
          week?.vault && weekly.vault ? <Vault unlocked={week.vault.dungeons} thresholds={weekly.vault.dungeons} count={week.vault.runs} /> : "—";
        const updated = week ? format.relativeTime(new Date(week.updatedAt)) : "—";
        return (
          <DetailRow
            key={row.character.entryId}
            version={version}
            row={row}
            span={span}
            cells={
              <>
                <Td className={`${SM} tabular-nums`}>{week?.itemLevel ?? "—"}</Td>
                {weekly.vault && <Td>{raidVault}</Td>}
                {vaultDungeons && <Td>{dungeonVault}</Td>}
                {has("raids") && <Td className={MD}>{week ? <Instances list={week.activity.raids} /> : noData}</Td>}
                {has("mythicPlus") && <Td className={`${LG} text-xs`}>{week ? <Runs runs={week.activity.mythicPlus} /> : "—"}</Td>}
                {has("dungeons") && <Td className={LG}>{week ? <Instances list={week.activity.dungeons} /> : "—"}</Td>}
                <Td className={`${LG} text-muted`}>{updated}</Td>
              </>
            }
            detail={
              !week ? (
                noData
              ) : (
                <Facts
                  items={[
                    [t("itemLevel"), week.itemLevel ?? "—"],
                    ...(weekly.vault ? ([[t("vaultRaid"), raidVault]] as [ReactNode, ReactNode][]) : []),
                    ...(vaultDungeons ? ([[t("vaultDungeons"), dungeonVault]] as [ReactNode, ReactNode][]) : []),
                    ...(has("raids") ? ([[t("raidBosses"), <Instances key="r" list={week.activity.raids} />]] as [ReactNode, ReactNode][]) : []),
                    ...(has("mythicPlus") ? ([[t("mythicPlus"), <Runs key="m" runs={week.activity.mythicPlus} />]] as [ReactNode, ReactNode][]) : []),
                    ...(has("dungeons") ? ([[t("dungeonBosses"), <Instances key="d" list={week.activity.dungeons} />]] as [ReactNode, ReactNode][]) : []),
                    [t("updated"), updated],
                  ]}
                />
              )
            }
          />
        );
      })}
    </Table>
  );
}

/** Columns for the latest weeks only (more on wider screens); every stored week is in the character's panel. */
const HISTORY_COLUMNS = ["", SM, MD, LG];

function HistoryTable({ version, rows, weekly, weekLabel }: { version: GameVersion; rows: WeeklyRow[]; weekly: WeeklyResponse; weekLabel: (iso: string) => string }) {
  const t = useTranslations("weekly");
  const has = (e: string) => version.characterEndpoints.includes(e) && !version.hiddenDetails.includes(e);
  const columns = weekly.weeks.slice(0, HISTORY_COLUMNS.length);
  const summary = (h: WeeklyResponse["history"][string][number] | undefined) =>
    h ? (
      <>
        {has("raids") && <span className="mr-2">{t("bossesShort", { count: h.bosses })}</span>}
        {has("mythicPlus") && <span className="mr-2">{t("runsShort", { count: h.runs })}</span>}
        {h.itemLevel != null && <span className="text-xs text-muted">{t("ilvlShort", { value: Math.round(h.itemLevel) })}</span>}
      </>
    ) : (
      <span className="text-muted">—</span>
    );
  return (
    <Table
      head={
        <>
          <Th>{t("character")}</Th>
          {columns.map((w, i) => (
            <Th key={w} className={HISTORY_COLUMNS[i]}>
              {weekLabel(w)}
            </Th>
          ))}
        </>
      }
      footer={t("historyLegend")}
    >
      {rows.map((row) => {
        const byWeek = new Map((weekly.history[row.character.characterId ?? ""] ?? []).map((h) => [h.weekStart, h]));
        return (
          <DetailRow
            key={row.character.entryId}
            version={version}
            row={row}
            span={1 + columns.length}
            cells={columns.map((w, i) => (
              <Td key={w} className={`${HISTORY_COLUMNS[i]} tabular-nums`}>
                {summary(byWeek.get(w))}
              </Td>
            ))}
            detail={
              <CardGrid>
                {weekly.weeks.map((w) => (
                  <Card key={w} title={weekLabel(w)}>
                    {summary(byWeek.get(w))}
                  </Card>
                ))}
              </CardGrid>
            }
          />
        );
      })}
    </Table>
  );
}
