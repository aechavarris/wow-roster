"use client";

import type { EquippedItem, InstanceMode, InstanceProgress } from "@wow/blizzard";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { classColor, GAME_QUALITY_COLORS, specName, wowheadItemUrl } from "@/lib/game";
import { tr } from "@/lib/text";
import { ItemTooltip } from "./character/ItemTooltip";
import { Card, CardGrid, DetailRow, ExpandAllButton, ExpandProvider, Facts, LG, MD, SM, Table, Td, Th, useExpandedRows, XL } from "./ui/CharacterTable";
import { GameTooltip } from "./ui/GameTooltip";
import type { CharacterDetails, GameVersion, TalentSummary } from "@/lib/types";
import type { CharacterRow } from "./ui/CharacterTable";
import { computeStatPanel, type Localized } from "@wow/config";

export interface DetailsRow extends CharacterRow {
  details?: CharacterDetails;
}

/** Gear columns in paper-doll order; shirt and tabard carry no stats. */
const GEAR_SLOTS = [
  "HEAD", "NECK", "SHOULDER", "BACK", "CHEST", "WRIST", "HANDS", "WAIST", "LEGS", "FEET",
  "FINGER_1", "FINGER_2", "TRINKET_1", "TRINKET_2", "MAIN_HAND", "OFF_HAND", "RANGED",
];
const DIFFICULTY_ORDER = ["LFR", "NORMAL", "HEROIC", "MYTHIC", "MYTHIC_KEYSTONE"];
const difficultyRank = (d: string) => {
  const i = DIFFICULTY_ORDER.indexOf(d);
  return i === -1 ? DIFFICULTY_ORDER.length : i;
};

type TabKey = "summary" | "mythicPlus" | "dungeons" | "raids" | "professions" | "reputations" | "requirements";

/**
 * Tabs come from the game version: each one appears only when the version's API provides that data
 * (its profile's characterEndpoints) and the profile does not hide it (hiddenDetails), so Classic, retail and later
 * Forever each show what makes sense for them.
 */
function tabsFor(version: GameVersion): TabKey[] {
  const has = (endpoint: string) => version.characterEndpoints.includes(endpoint) && !version.hiddenDetails.includes(endpoint);
  const tabs: TabKey[] = ["summary"];
  if (has("mythicPlus")) tabs.push("mythicPlus");
  if (has("dungeons")) tabs.push("dungeons");
  if (has("raids")) tabs.push("raids");
  if (version.apiProfessions || version.professions.length > 0) tabs.push("professions");
  if (has("reputations")) tabs.push("reputations");
  if (version.requirements.length > 0) tabs.push("requirements");
  return tabs;
}

/** The instance of the newest expansion seen in the roster, last in the API's order: the current tier. */
function latestInstances(all: InstanceProgress[]): InstanceProgress[] {
  const maxExpansion = Math.max(...all.map((i) => i.expansionId ?? 0));
  const seen = new Map<number | string, InstanceProgress>();
  for (const i of all.filter((i) => (i.expansionId ?? 0) === maxExpansion)) seen.set(i.id ?? tr(i.name, "en"), i);
  return [...seen.values()];
}

function bestMode(instance: InstanceProgress | undefined): InstanceMode | undefined {
  return [...(instance?.modes ?? [])]
    // Profiles synced before the normalizer dropped retail's difficulty-less duplicate mode still carry it.
    .filter((m) => m.completed > 0 && m.difficulty !== "UNKNOWN")
    .sort((a, b) => difficultyRank(b.difficulty) - difficultyRank(a.difficulty))[0];
}

export function RosterDetails({ version, rows, weekStart }: { version: GameVersion; rows: DetailsRow[]; weekStart: string | null }) {
  const t = useTranslations("details");
  const locale = useLocale();
  const tabs = tabsFor(version);
  const [tab, setTab] = useState<TabKey>("summary");
  const [showAlts, setShowAlts] = useState(true);
  const shown = rows.filter((r) => showAlts || !r.alt);
  const { value: expand, allOpen, toggleAll } = useExpandedRows(shown);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" className="flex flex-wrap gap-2">
          {tabs.map((key) => (
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
          {/* No sideways scrolling: tables keep a few columns and the rest opens under each character. */}
          <div className="card p-0">
            {tab === "summary" && <SummaryTable version={version} rows={shown} />}
            {tab === "mythicPlus" && <MythicPlusTable version={version} rows={shown} weekStart={weekStart} />}
            {tab === "dungeons" && <InstanceTable version={version} rows={shown} kind="dungeons" />}
            {tab === "raids" && <InstanceTable version={version} rows={shown} kind="raids" />}
            {tab === "professions" && <ProfessionsTable version={version} rows={shown} />}
            {tab === "reputations" && <ReputationsTable version={version} rows={shown} />}
            {tab === "requirements" && <RequirementsTable version={version} rows={shown} />}
          </div>
        </ExpandProvider>
      )}
    </div>
  );
}

const Missing = ({ reason }: { reason?: string }) => {
  const t = useTranslations("details");
  return <span className="text-muted" title={reason ? t("missingReason", { reason }) : undefined}>—</span>;
};

/** Best difficulty cleared in an instance, as "6/8 Heroic". */
function modeLabel(mode: InstanceMode | undefined, locale: string) {
  return mode ? `${mode.completed}/${mode.total} ${tr(mode.difficultyName, locale) || mode.difficulty}` : "—";
}

/** Every difficulty with kills in an instance, highest first, for detail cards. */
function modeLines(instance: InstanceProgress | undefined, locale: string) {
  return [...(instance?.modes ?? [])]
    .filter((m) => m.completed > 0 && m.difficulty !== "UNKNOWN")
    .sort((a, b) => difficultyRank(b.difficulty) - difficultyRank(a.difficulty))
    .map((m) => <div key={m.difficulty}>{modeLabel(m, locale)}</div>);
}

/** Value bar like Warcraft Logs': the fill is the value relative to the roster's best, in the character's class color. */
function ValueBar({ value, max, color, label }: { value: number | null | undefined; max: number; color: string; label?: ReactNode }) {
  if (value == null) return <span className="text-muted">—</span>;
  const width = max > 0 ? Math.max(4, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="relative h-6 min-w-20 overflow-hidden rounded bg-surface-2">
      <div className="absolute inset-y-0 left-0 rounded opacity-60" style={{ width: `${width}%`, background: color }} />
      <span className="relative flex h-full items-center px-2 text-xs font-semibold tabular-nums text-text">{label ?? value}</span>
    </div>
  );
}

/** Roster rows grouped by the main's role, in the version's role order; alts stay under their main. */
function groupByRole(version: GameVersion, rows: DetailsRow[], score: (row: DetailsRow) => number) {
  const blocks: DetailsRow[][] = [];
  for (const row of rows) {
    if (row.alt && blocks.length > 0) blocks[blocks.length - 1]!.push(row);
    else blocks.push([row]);
  }
  const order = version.roles.map((r) => r.key);
  const groups = new Map<string, DetailsRow[][]>();
  for (const block of blocks) {
    const role = block[0]!.character.role;
    const key = role && order.includes(role) ? role : "";
    groups.set(key, [...(groups.get(key) ?? []), block]);
  }
  return [...order, ""]
    .filter((key) => groups.has(key))
    .map((key) => ({
      role: version.roles.find((r) => r.key === key),
      // Best first inside each role, as Warcraft Logs ranks players.
      rows: groups.get(key)!.sort((a, b) => score(b[0]!) - score(a[0]!)).flat(),
    }));
}

/** Percent stats of the version's stat panel (crit, haste…), the ones worth comparing between players. */
/**
 * The stats worth comparing for a character: the ones its spec or class lists in the profile (spell hit and crit
 * for a mage, defense for a protection warrior), or every percent stat when the profile lists none (retail).
 */
function keyStats(version: GameVersion, stats: CharacterDetails["statistics"], classId: number | null, specKey: string | null) {
  if (!stats) return [];
  const rows = computeStatPanel(version.statPanel, stats).flatMap((section) => section.rows);
  const gameClass = version.classes.find((c) => c.id === classId);
  const wanted = gameClass?.specs.find((s) => s.key === specKey)?.summaryStats ?? gameClass?.summaryStats;
  if (!wanted) return rows.filter((row) => row.format === "percent");
  return wanted.flatMap((key) => rows.find((row) => row.key === key) ?? []);
}

/** The version's resistances column (Classic): each configured resistance and its value. */
function resistances(version: GameVersion, stats: CharacterDetails["statistics"]) {
  if (!stats || version.details.resistances.length === 0) return [];
  const rows = computeStatPanel(version.statPanel, stats).flatMap((section) => section.rows);
  return version.details.resistances.flatMap((key) => rows.find((row) => row.key === key) ?? []);
}

/** Talent setup in one line: spec and points per tree (Classic) or the active spec (retail loadouts). */
function talentLine(setup: TalentSummary) {
  const points = setup.trees.some((tree) => tree.points != null) ? setup.trees.map((tree) => tree.points ?? 0).join("/") : null;
  return [setup.specName, points].filter(Boolean).join(" · ") || "—";
}

/**
 * The roster at a glance, as Warcraft Logs shows players: grouped by role with a colored stripe and tint per role,
 * the best item level first, bars to compare item level and Mythic+ rating, current raid progress, key stats and
 * talents. Everything else (all stats, every talent setup, gear with tooltips) opens under each character.
 */
function SummaryTable({ version, rows }: { version: GameVersion; rows: DetailsRow[] }) {
  const t = useTranslations("details");
  const tSlots = useTranslations("slots");
  const locale = useLocale();
  const format = useFormatter();
  const shows = (e: string) => version.characterEndpoints.includes(e) && !version.hiddenDetails.includes(e);
  const hasRaids = shows("raids");
  const hasMythic = shows("mythicPlus");
  const hasStats = version.characterEndpoints.includes("statistics");
  const hasTalents = version.characterEndpoints.includes("specializations");
  const hasResistances = hasStats && version.details.resistances.length > 0;
  const current = latestInstances(rows.flatMap((r) => r.details?.raids ?? []));
  const when = (iso: string | null | undefined) => (iso ? format.relativeTime(new Date(iso)) : "—");
  const ilvl = (row: DetailsRow) => row.details?.equippedItemLevel ?? row.character.itemLevel ?? null;
  const rating = (row: DetailsRow) => row.details?.mythicPlus?.rating ?? row.details?.raiderIo?.score ?? null;
  const maxIlvl = Math.max(0, ...rows.map((r) => ilvl(r) ?? 0));
  const maxRating = Math.max(0, ...rows.map((r) => rating(r) ?? 0));
  const groups = groupByRole(version, rows, (r) => ilvl(r) ?? 0);
  const percent = (value: number) => `${format.number(value, { maximumFractionDigits: 1 })}%`;
  const span = 3 + (hasMythic ? 1 : 0) + (hasRaids ? 1 : 0) + (hasStats ? 1 : 0) + (hasResistances ? 1 : 0) + (hasTalents ? 1 : 0);
  const statValue = (s: { value: number; format: "number" | "percent" }) => (s.format === "percent" ? percent(s.value) : format.number(s.value));
  return (
    <Table
      head={
        <>
          <Th>{t("character")}</Th>
          <Th className="w-32 sm:w-40">{t("itemLevel")}</Th>
          {hasMythic && <Th className={`${SM} w-40`}>{t("mythicRating")}</Th>}
          {hasRaids && <Th className={MD}>{t("currentRaid")}</Th>}
          {hasStats && <Th className={LG}>{t("stats")}</Th>}
          {hasResistances && <Th className={LG}>{t("resistances")}</Th>}
          {hasTalents && <Th className={LG}>{t("talents")}</Th>}
          <Th className={LG}>{t("lastLogin")}</Th>
        </>
      }
      footer={t("summaryLegend")}
    >
      {groups.map(({ role, rows: groupRows }) => {
        const accent = role?.color ?? "var(--border)";
        return (
          <Fragment key={role?.key ?? "none"}>
            {/* Light separation between roles: a header strip tinted with the role color. */}
            <tr className="hover:bg-transparent">
              <td
                colSpan={span}
                className="px-3 py-1 text-xs font-semibold uppercase tracking-wide"
                style={{ boxShadow: `inset 3px 0 0 ${accent}`, background: `color-mix(in oklab, ${accent} 14%, transparent)` }}
              >
                {role ? tr(role.name, locale) : t("noRole")} <span className="font-normal text-muted">({groupRows.filter((r) => !r.alt).length})</span>
              </td>
            </tr>
            {groupRows.map((row) => {
              const c = row.character;
              const d = row.details;
              const color = classColor(version, c.classId) ?? "var(--accent)";
              const raids = current.map((instance) => ({ instance, mode: bestMode(d?.raids?.find((r) => r.id === instance.id)) }));
              const stats = keyStats(version, d?.statistics ?? null, c.classId, c.specKey);
              const resists = resistances(version, d?.statistics ?? null);
              const active = d?.talents?.find((s) => s.active) ?? d?.talents?.[0];
              const items = GEAR_SLOTS.flatMap((slot) => d?.equipment?.find((i) => i.slot === slot) ?? []);
              // The roster's spec comes from the summary; the active talent setup names it when that is missing.
              const spec = specName(version, c.classId, c.specKey, locale) || active?.specName || "";
              const synced = d?.syncError === "not_found" ? t("notFound") : when(d?.lastSyncedAt ?? c.lastSyncedAt);
              const ratingValue = rating(row);
              const ratingBar = (
                <ValueBar
                  value={ratingValue != null ? Math.round(ratingValue) : null}
                  max={maxRating}
                  color={d?.mythicPlus?.color ?? d?.raiderIo?.color ?? color}
                />
              );
              return (
                <DetailRow
                  key={c.entryId}
                  version={version}
                  row={row}
                  span={span}
                  accent={accent}
                  subtitle={[spec, d?.level ?? c.level].filter(Boolean).join(" · ")}
                  cells={
                    <>
                      <Td>
                        <ValueBar value={ilvl(row)} max={maxIlvl} color={color} />
                      </Td>
                      {hasMythic && <Td className={SM}>{ratingBar}</Td>}
                      {hasRaids && (
                        <Td className={`${MD} tabular-nums`}>
                          {raids.map(({ instance, mode }) => (
                            <div key={instance.id ?? tr(instance.name, locale)} className="whitespace-nowrap">
                              {modeLabel(mode, locale)}
                            </div>
                          ))}
                        </Td>
                      )}
                      {hasStats && (
                        <Td className={`${LG} text-xs tabular-nums`}>
                          {stats.length === 0 ? (
                            <Missing reason={d?.missing.statistics} />
                          ) : (
                            <div className="grid grid-cols-2 gap-x-3">
                              {stats.map((s) => (
                                <span key={s.key} className="whitespace-nowrap">
                                  <span className="text-muted">{tr(s.short ?? s.label, locale)}</span> {statValue(s)}
                                </span>
                              ))}
                            </div>
                          )}
                        </Td>
                      )}
                      {hasResistances && (
                        <Td className={`${LG} text-xs tabular-nums`}>
                          <div className="grid grid-cols-2 gap-x-3">
                            {resists.map((r) => (
                              <span key={r.key} className={`whitespace-nowrap ${r.value > 0 ? "" : "text-muted"}`}>
                                <span className="text-muted">{tr(r.short ?? r.label, locale)}</span> {format.number(r.value)}
                              </span>
                            ))}
                          </div>
                        </Td>
                      )}
                      {hasTalents && <Td className={`${LG} text-xs`}>{active ? talentLine(active) : <Missing reason={d?.missing.specializations} />}</Td>}
                      <Td className={`${LG} text-xs text-muted`}>{when(d?.lastLoginAt)}</Td>
                    </>
                  }
                  detail={
                    <div className="space-y-4">
                      <Facts
                        items={[
                          [t("spec"), spec || "—"],
                          [t("level"), d?.level ?? c.level ?? "—"],
                          [t("itemLevel"), ilvl(row) ?? "—"],
                          ...(hasMythic ? ([[t("mythicRating"), ratingValue != null ? Math.round(ratingValue) : "—"]] as [ReactNode, ReactNode][]) : []),
                          ...(hasRaids
                            ? raids.map(({ instance, mode }): [ReactNode, ReactNode] => [tr(instance.name, locale), modeLabel(mode, locale)])
                            : []),
                          [t("lastLogin"), when(d?.lastLoginAt)],
                          [t("synced"), synced],
                        ]}
                      />
                      {hasStats && d?.statistics && (
                        <div>
                          <h4 className="label">{t("stats")}</h4>
                          <Facts
                            items={computeStatPanel(version.statPanel, d.statistics).flatMap((section) =>
                              section.rows.map((s): [ReactNode, ReactNode] => [
                                tr(s.label, locale),
                                s.format === "percent" ? percent(s.value) : format.number(s.value),
                              ]),
                            )}
                          />
                        </div>
                      )}
                      {hasTalents && d?.talents && d.talents.length > 0 && (
                        <div>
                          <h4 className="label">{t("talents")}</h4>
                          <CardGrid>
                            {d.talents.map((setup, i) => (
                              <Card key={i} title={`${talentLine(setup)}${setup.active ? ` · ${t("activeSpec")}` : ""}`}>
                                {setup.trees.some((tree) => tree.points != null) && (
                                  <div>{setup.trees.map((tree) => `${tree.name} ${tree.points ?? 0}`).join(" · ")}</div>
                                )}
                                {setup.loadoutCode && (
                                  <button
                                    type="button"
                                    className="mt-1 text-accent hover:underline"
                                    onClick={() => void navigator.clipboard?.writeText(setup.loadoutCode!)}
                                    title={setup.loadoutCode}
                                  >
                                    {t("copyLoadout")}
                                  </button>
                                )}
                              </Card>
                            ))}
                          </CardGrid>
                        </div>
                      )}
                      {items.length > 0 && (
                        <div>
                          <h4 className="label">{t("gear")}</h4>
                          <div className="flex flex-wrap gap-x-3 gap-y-1">
                            {items.map((item) => (
                              <GearPiece
                                key={item.slot}
                                version={version}
                                item={item}
                                locale={locale}
                                slotName={tSlots.has(item.slot) ? tSlots(item.slot) : item.slot}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  }
                />
              );
            })}
          </Fragment>
        );
      })}
    </Table>
  );
}

/** One gear piece: icon and item level with the in-game tooltip, plus the Wowhead link. */
function GearPiece({ version, item, locale, slotName, wide }: { version: GameVersion; item: EquippedItem; locale: string; slotName: string; wide?: boolean }) {
  const t = useTranslations("details");
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      {/* Same in-game tooltip as the character sheet; the arrow opens the item on Wowhead. */}
      <GameTooltip
        label={`${slotName}: ${tr(item.name, locale)}`}
        content={<ItemTooltip item={item} />}
        className="inline-flex min-w-0 items-center gap-1 rounded text-left tabular-nums hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        style={{ color: GAME_QUALITY_COLORS[item.quality ?? ""] }}
      >
        {item.icon && (
          // eslint-disable-next-line @next/next/no-img-element -- Blizzard icon CDN, already sized.
          <img src={item.icon} alt="" width={wide ? 28 : 22} height={wide ? 28 : 22} className="shrink-0 rounded-sm" />
        )}
        {wide ? (
          <span className="min-w-0">
            <span className="block truncate">{tr(item.name, locale)}</span>
            <span className="block text-xs text-muted">
              {slotName} · {item.itemLevel ?? "?"}
            </span>
          </span>
        ) : (
          item.itemLevel ?? "?"
        )}
        {item.enchantments.length > 0 && <span className="text-success" aria-label={t("enchanted")}>✦</span>}
        {item.gems.length > 0 && <span className="text-accent">◆{item.gems.length > 1 ? item.gems.length : ""}</span>}
      </GameTooltip>
      <a
        href={wowheadItemUrl(version, locale, item)}
        target="_blank"
        rel="noreferrer"
        className="text-xs text-muted hover:text-accent"
        aria-label={t("wowhead", { name: tr(item.name, locale) })}
        title={t("wowhead", { name: tr(item.name, locale) })}
      >
        ↗
      </a>
    </span>
  );
}

/** Dungeon names differ in punctuation between Blizzard and Raider.IO ("Kings' Rest"), so columns match on letters only. */
const dungeonKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

interface KeyRun {
  level: number;
  timed: boolean;
  rating?: number;
}

interface MythicPlusCells {
  rating?: number;
  color?: string;
  profileUrl?: string;
  season: Map<string, KeyRun>;
  week: Map<string, KeyRun[]>;
  weekRuns: number;
  /** Lifetime Mythic clears (Mythic 0 and keys) from Blizzard's final boss kill counter. */
  total: Map<string, number>;
}

/**
 * One character's Mythic+ data by dungeon. Raider.IO, where the version enables it, lists every run of the week and
 * the current season's bests; Blizzard gives the rating, the best run per dungeon (season and week) and, through
 * the dungeons endpoint, how many times each dungeon was cleared on Mythic.
 */
function mythicPlusCells(details: CharacterDetails | undefined, weekStart: number, names: Map<string, Localized>): MythicPlusCells {
  const m = details?.mythicPlus;
  const rio = details?.raiderIo;
  const thisWeek = (completedAt?: string) => completedAt !== undefined && Date.parse(completedAt) >= weekStart;
  const season = new Map<string, KeyRun>();
  const week = new Map<string, KeyRun[]>();
  const addBest = (key: string, run: KeyRun) => {
    const old = season.get(key);
    if (!old || run.level > old.level || (run.level === old.level && run.timed && !old.timed)) season.set(key, run);
  };
  if (rio) {
    for (const run of rio.bestRuns) addBest(dungeonKey(run.dungeon), { level: run.level, timed: run.timed, rating: run.score });
    for (const run of rio.weeklyRuns.filter((r) => thisWeek(r.completedAt))) {
      const key = dungeonKey(run.dungeon);
      week.set(key, [...(week.get(key) ?? []), { level: run.level, timed: run.timed }]);
      if (!names.has(key)) names.set(key, { en: run.dungeon });
    }
    for (const run of rio.bestRuns) if (!names.has(dungeonKey(run.dungeon))) names.set(dungeonKey(run.dungeon), { en: run.dungeon });
  } else {
    for (const run of m?.seasonRuns ?? []) {
      const key = dungeonKey(tr(run.dungeon, "en"));
      addBest(key, { level: run.level, timed: run.timed, rating: run.rating });
      if (!names.has(key)) names.set(key, run.dungeon);
    }
    for (const run of (m?.weeklyRuns ?? []).filter((r) => thisWeek(r.completedAt))) {
      const key = dungeonKey(tr(run.dungeon, "en"));
      week.set(key, [...(week.get(key) ?? []), { level: run.level, timed: run.timed }]);
      if (!names.has(key)) names.set(key, run.dungeon);
    }
  }
  const total = new Map<string, number>();
  for (const instance of details?.dungeons ?? []) {
    const mythic = instance.modes.find((mode) => mode.difficulty === "MYTHIC");
    const kills = Math.max(0, ...(mythic?.encounters.map((e) => e.kills) ?? []));
    if (kills > 0) total.set(dungeonKey(tr(instance.name, "en")), kills);
  }
  // Blizzard's localized dungeon names win over Raider.IO's English ones.
  for (const instance of details?.dungeons ?? []) {
    const key = dungeonKey(tr(instance.name, "en"));
    if (names.has(key)) names.set(key, instance.name);
  }
  return {
    rating: m?.rating ?? rio?.score,
    color: m?.color ?? rio?.color,
    profileUrl: rio?.profileUrl,
    season,
    week,
    weekRuns: [...week.values()].reduce((sum, runs) => sum + runs.length, 0),
    total,
  };
}

/**
 * Mythic+: rating, best key, timed dungeons and keys this week per character; the detail panel has one card per
 * dungeon with its season best key, this week's keys and how many times it was cleared on Mythic overall.
 */
function MythicPlusTable({ version, rows, weekStart }: { version: GameVersion; rows: DetailsRow[]; weekStart: string | null }) {
  const t = useTranslations("details");
  const locale = useLocale();
  const { cells, dungeons, names } = useMemo(() => {
    const names = new Map<string, Localized>();
    const start = weekStart ? Date.parse(weekStart) : 0;
    const cells = new Map(rows.map((row) => [row.character.entryId, mythicPlusCells(row.details, start, names)]));
    // Dungeons with a key this season or this week, in any character.
    const keys = new Set([...cells.values()].flatMap((c) => [...c.season.keys(), ...c.week.keys()]));
    const dungeons = [...keys].sort((a, b) => tr(names.get(a), locale).localeCompare(tr(names.get(b), locale)));
    return { cells, dungeons, names };
  }, [rows, weekStart, locale]);
  const key = (run: KeyRun | undefined) => (run ? `+${run.level}${run.timed ? " ✓" : ""}` : null);
  const hasRaiderIo = rows.some((row) => row.details?.raiderIo);
  return (
    <Table
      head={
        <>
          <Th>{t("character")}</Th>
          <Th>{t("mythicRating")}</Th>
          <Th className={SM}>{t("seasonBest")}</Th>
          <Th className={MD}>{t("dungeonsTimed")}</Th>
          <Th>{t("weeklyKeys")}</Th>
        </>
      }
      footer={
        <>
          {t("mythicLegend")}
          {hasRaiderIo && <> {t("raiderIoCredit")}</>}
        </>
      }
    >
      {rows.map((row) => {
        const c = cells.get(row.character.entryId)!;
        const best = [...c.season.entries()].sort((a, b) => b[1].level - a[1].level)[0];
        return (
          <DetailRow
            key={row.character.entryId}
            version={version}
            row={row}
            span={5}
            cells={
              <>
                <Td className="tabular-nums">
                  {c.rating != null ? <span style={{ color: c.color }}>{Math.round(c.rating)}</span> : <Missing reason={row.details?.missing.mythicPlus} />}
                  {c.profileUrl && (
                    <a href={c.profileUrl} target="_blank" rel="noreferrer" className="ml-1 text-xs text-muted" title="Raider.IO">
                      ↗
                    </a>
                  )}
                </Td>
                <Td className={`${SM} tabular-nums`}>{best ? `${key(best[1])} ${tr(names.get(best[0]), locale)}` : "—"}</Td>
                <Td className={`${MD} tabular-nums`}>
                  {c.season.size > 0 ? `${[...c.season.values()].filter((r) => r.timed).length}/${dungeons.length}` : "—"}
                </Td>
                <Td className="tabular-nums">{row.details?.mythicPlus || row.details?.raiderIo ? c.weekRuns : "—"}</Td>
              </>
            }
            detail={
              dungeons.length === 0 ? (
                <p className="text-sm text-muted">{t("noMythicPlus")}</p>
              ) : (
                <CardGrid>
                  {dungeons.map((d) => {
                    const s = c.season.get(d);
                    const w = c.week.get(d) ?? [];
                    const total = c.total.get(d);
                    const top = [...w].sort((a, b) => b.level - a.level)[0];
                    return (
                      <Card key={d} title={tr(names.get(d), locale)}>
                        <div className={s && !s.timed ? "" : "text-text"}>
                          {t("seasonBest")}: {key(s) ?? "—"}
                          {s?.rating != null && ` (${t("runRating", { rating: Math.round(s.rating) })})`}
                        </div>
                        <div>{top ? t("thisWeek", { count: w.length, key: key(top)! }) : t("noKeysThisWeek")}</div>
                        {total !== undefined && <div>{t("totalClears", { count: total })}</div>}
                      </Card>
                    );
                  })}
                </CardGrid>
              )
            }
          />
        );
      })}
    </Table>
  );
}

/**
 * Raids or dungeons of one expansion: the best difficulty cleared in each instance, listed in one wrapping cell;
 * the detail panel has a card per instance with every difficulty.
 */
function InstanceTable({ version, rows, kind }: { version: GameVersion; rows: DetailsRow[]; kind: "raids" | "dungeons" }) {
  const t = useTranslations("details");
  const locale = useLocale();
  const all = useMemo(() => rows.flatMap((r) => r.details?.[kind] ?? []), [rows, kind]);
  const expansions = useMemo(() => {
    const byId = new Map<number, string>();
    for (const i of all) if (i.expansionId != null) byId.set(i.expansionId, tr(i.expansion, locale) || String(i.expansionId));
    return [...byId.entries()].sort((a, b) => b[0] - a[0]);
  }, [all, locale]);
  const [expansion, setExpansion] = useState<number | undefined>(expansions[0]?.[0]);
  const instances = useMemo(() => {
    const seen = new Map<number | string, InstanceProgress>();
    for (const i of all.filter((i) => i.expansionId === expansion)) seen.set(i.id ?? tr(i.name, "en"), i);
    return [...seen.values()];
  }, [all, expansion]);

  if (all.length === 0) {
    return <p className="p-4 text-sm text-muted">{t(kind === "raids" ? "noRaids" : "noDungeons")}</p>;
  }
  return (
    <div>
      {/* Raids read from Warcraft Logs have no expansion to choose. */}
      {expansions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <label className="text-sm" htmlFor={`${kind}-expansion`}>{t("expansion")}</label>
          <select
            id={`${kind}-expansion`}
            className="input w-auto max-w-full"
            value={expansion ?? ""}
            onChange={(e) => setExpansion(Number(e.target.value))}
          >
            {expansions.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        </div>
      )}
      <Table
        head={
          <>
            <Th>{t("character")}</Th>
            <Th>{t("cleared", { total: instances.length })}</Th>
            <Th className={SM}>{t(kind === "raids" ? "bestPerRaid" : "bestPerDungeon")}</Th>
          </>
        }
        footer={
          kind === "raids" && version.warcraftLogsHost
            ? `${t("instanceLegend")} ${t("fromWarcraftLogs", { host: version.warcraftLogsHost })}`
            : t("instanceLegend")
        }
      >
        {rows.map((row) => {
          const own = (instance: InstanceProgress) => row.details?.[kind]?.find((i) => i.id === instance.id);
          const best = instances.map((instance) => ({ instance, mode: bestMode(own(instance)) }));
          const missing = row.details?.[kind] == null ? <Missing reason={row.details?.missing[kind]} /> : null;
          return (
            <DetailRow
              key={row.character.entryId}
              version={version}
              row={row}
              span={3}
              cells={
                <>
                  <Td className="tabular-nums">{missing ?? `${best.filter((b) => b.mode).length}/${instances.length}`}</Td>
                  <Td className={SM}>
                    {missing ?? (
                      <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                        {best
                          .filter((b) => b.mode)
                          .map(({ instance, mode }) => (
                            <span key={instance.id ?? tr(instance.name, locale)} className="tabular-nums">
                              <span className="text-muted">{tr(instance.name, locale)}:</span> {modeLabel(mode, locale)}
                            </span>
                          ))}
                      </div>
                    )}
                  </Td>
                </>
              }
              detail={
                missing ?? (
                  <CardGrid>
                    {instances.map((instance) => {
                      const lines = modeLines(own(instance), locale);
                      return (
                        <Card key={instance.id ?? tr(instance.name, locale)} title={tr(instance.name, locale)}>
                          {lines.length > 0 ? lines : "—"}
                        </Card>
                      );
                    })}
                  </CardGrid>
                )
              }
            />
          );
        })}
      </Table>
    </div>
  );
}

function ProfessionsTable({ version, rows }: { version: GameVersion; rows: DetailsRow[] }) {
  const t = useTranslations("details");
  const locale = useLocale();
  const nameOf = (id: number) => tr(version.professions.find((p) => p.id === id)?.name, locale);
  const kindOf = (id: number) => version.professions.find((p) => p.id === id)?.kind;
  return (
    <Table
      head={
        <>
          <Th>{t("character")}</Th>
          <Th>{t("primaries")}</Th>
          <Th className={SM}>{t("secondary")}</Th>
        </>
      }
      footer={version.apiProfessions ? undefined : t("manualProfessions")}
    >
      {rows.map((row) => {
        // Retail reads professions from the API; Classic versions use what the owner entered.
        const list = version.apiProfessions
          ? (row.details?.professions ?? []).map((p) => ({
              name: tr(p.name, locale) || nameOf(p.id),
              secondary: p.secondary,
              skill: p.skill,
              max: p.maxSkill,
              tier: p.tiers.length > 1 ? tr(p.tiers[0]?.name, locale) : undefined,
              tiers: p.tiers.map((tier) => `${tr(tier.name, locale)}: ${tier.skill ?? "?"}/${tier.maxSkill ?? "?"}`),
            }))
          : (row.details?.manualProfessions ?? []).map((m) => ({
              name: nameOf(m.id),
              secondary: kindOf(m.id) === "secondary",
              skill: m.skill ?? undefined,
              max: version.professions.find((p) => p.id === m.id)?.maxSkill,
              tier: undefined,
              tiers: [] as string[],
            }));
        const primaries = list.filter((p) => !p.secondary);
        const secondaries = list.filter((p) => p.secondary);
        const label = (p: (typeof list)[number]) => `${p.name}${p.skill != null ? ` ${p.skill}/${p.max ?? "?"}` : ""}`;
        return (
          <DetailRow
            key={row.character.entryId}
            version={version}
            row={row}
            span={3}
            cells={
              <>
                <Td>{primaries.map(label).join(" · ") || "—"}</Td>
                <Td className={`${SM} text-muted`}>{secondaries.map(label).join(" · ") || "—"}</Td>
              </>
            }
            detail={
              list.length === 0 ? (
                <p className="text-sm text-muted">—</p>
              ) : (
                <CardGrid>
                  {list.map((p) => (
                    <Card key={p.name} title={label(p)}>
                      {p.secondary && <div>{t("secondary")}</div>}
                      {p.tiers.map((line) => (
                        <div key={line}>{line}</div>
                      ))}
                    </Card>
                  ))}
                </CardGrid>
              )
            }
          />
        );
      })}
    </Table>
  );
}

/** Reputation standing in a cell: the standing name (or renown level) and the progress within it. */
function Standing({ rep }: { rep: NonNullable<CharacterDetails["reputations"]>[number] | undefined }) {
  const t = useTranslations("details");
  const locale = useLocale();
  if (!rep) return <span className="text-muted">—</span>;
  return (
    <>
      <span className="block">{tr(rep.standing, locale) || (rep.renownLevel != null ? t("renown", { level: rep.renownLevel }) : "—")}</span>
      {rep.value != null && rep.max ? <span className="block text-xs text-muted tabular-nums">{`${rep.value}/${rep.max}`}</span> : null}
    </>
  );
}

/**
 * Reputations: the version's key factions (the ones its raids depend on) as fixed columns, plus one more faction
 * picked from a list of every faction in the roster; the panel under each character lists all of them.
 */
function ReputationsTable({ version, rows }: { version: GameVersion; rows: DetailsRow[] }) {
  const t = useTranslations("details");
  const locale = useLocale();
  // Factions the most characters have come first: those are the ones a roster compares.
  const factions = useMemo(() => {
    const counts = new Map<number, { name: string; count: number }>();
    for (const r of rows) {
      for (const rep of r.details?.reputations ?? []) {
        const entry = counts.get(rep.factionId) ?? { name: tr(rep.name, locale), count: 0 };
        entry.count++;
        counts.set(rep.factionId, entry);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1].count - a[1].count || a[1].name.localeCompare(b[1].name));
  }, [rows, locale]);
  const keyFactions = version.details.keyReputations.flatMap((id) => {
    const found = factions.find(([fid]) => fid === id);
    return found ? [found] : [];
  });
  const others = factions.filter(([id]) => !version.details.keyReputations.includes(id));
  const [faction, setFaction] = useState<number | undefined>(others[0]?.[0]);
  // Key columns hide progressively on narrow screens; every faction is in the panel anyway.
  const keyClass = (i: number) => (i === 0 ? "" : i === 1 ? SM : i === 2 ? MD : LG);

  if (factions.length === 0) return <p className="p-4 text-sm text-muted">{t("noReputations")}</p>;
  return (
    <div>
      {others.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <label className="text-sm" htmlFor="rep-faction">{t(keyFactions.length > 0 ? "otherFaction" : "faction")}</label>
          <select id="rep-faction" className="input w-auto max-w-full" value={faction ?? ""} onChange={(e) => setFaction(Number(e.target.value))}>
            {others.map(([id, { name, count }]) => (
              <option key={id} value={id}>
                {name} ({count})
              </option>
            ))}
          </select>
        </div>
      )}
      <Table
        head={
          <>
            <Th>{t("character")}</Th>
            {keyFactions.map(([id, { name }], i) => (
              <Th key={id} className={keyClass(i)}>
                {name}
              </Th>
            ))}
            {faction !== undefined && <Th className={keyFactions.length > 0 ? XL : ""}>{others.find(([id]) => id === faction)?.[1].name}</Th>}
          </>
        }
        footer={t("reputationsLegend")}
      >
        {rows.map((row) => {
          const reps = row.details?.reputations;
          const of = (id: number | undefined) => reps?.find((r) => r.factionId === id);
          const missing = reps == null ? <Missing reason={row.details?.missing.reputations} /> : null;
          return (
            <DetailRow
              key={row.character.entryId}
              version={version}
              row={row}
              span={1 + keyFactions.length + (faction !== undefined ? 1 : 0)}
              cells={
                <>
                  {keyFactions.map(([id], i) => (
                    <Td key={id} className={keyClass(i)}>
                      {missing ?? <Standing rep={of(id)} />}
                    </Td>
                  ))}
                  {faction !== undefined && <Td className={keyFactions.length > 0 ? XL : ""}>{missing ?? <Standing rep={of(faction)} />}</Td>}
                </>
              }
              detail={
                reps == null || reps.length === 0 ? (
                  <p className="text-sm text-muted">—</p>
                ) : (
                  <CardGrid>
                    {[...reps]
                      .sort(
                        (a, b) =>
                          Number(version.details.keyReputations.includes(b.factionId)) - Number(version.details.keyReputations.includes(a.factionId)) ||
                          tr(a.name, locale).localeCompare(tr(b.name, locale)),
                      )
                      .map((r) => (
                        <Card key={r.factionId} title={tr(r.name, locale)}>
                          <Standing rep={r} />
                        </Card>
                      ))}
                  </CardGrid>
                )
              }
            />
          );
        })}
      </Table>
    </div>
  );
}

/** Attunements the owners ticked on their characters' sheets: one column per requirement of the version. */
function RequirementsTable({ version, rows }: { version: GameVersion; rows: DetailsRow[] }) {
  const t = useTranslations("details");
  const locale = useLocale();
  const reqs = version.requirements;
  const raidName = (key?: string) => tr(version.raids.find((r) => r.key === key)?.name, locale);
  const label = (r: (typeof reqs)[number]) => (r.raid ? raidName(r.raid) : tr(r.name, locale));
  const mark = (has: boolean) => (
    <span className={has ? "text-success" : "text-muted"} aria-label={t(has ? "requirementDone" : "requirementMissing")}>
      {has ? "✓" : "✗"}
    </span>
  );
  return (
    <Table
      head={
        <>
          <Th>{t("character")}</Th>
          <Th>{t("requirementsDone")}</Th>
          {reqs.map((r) => (
            <Th key={r.key} className={SM}>
              <span title={tr(r.name, locale)}>{label(r)}</span>
            </Th>
          ))}
        </>
      }
      footer={t("requirementsLegend")}
    >
      {rows.map((row) => {
        const done = new Set(row.details?.manualRequirements ?? []);
        return (
          <DetailRow
            key={row.character.entryId}
            version={version}
            row={row}
            span={2 + reqs.length}
            cells={
              <>
                <Td className="tabular-nums">{`${reqs.filter((r) => done.has(r.key)).length}/${reqs.length}`}</Td>
                {reqs.map((r) => (
                  <Td key={r.key} className={SM}>
                    {mark(done.has(r.key))}
                  </Td>
                ))}
              </>
            }
            detail={
              <ul className="space-y-1 text-sm">
                {reqs.map((r) => (
                  <li key={r.key} className="flex items-center gap-2">
                    {mark(done.has(r.key))} {tr(r.name, locale)}
                  </li>
                ))}
              </ul>
            }
          />
        );
      })}
    </Table>
  );
}
