"use client";

import type { InstanceMode, InstanceProgress } from "@wow/blizzard";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "@/i18n/routing";
import { characterPath, classColor, classText, GAME_QUALITY_COLORS, specName, wowheadItemUrl } from "@/lib/game";
import { tr } from "@/lib/text";
import { ItemTooltip } from "./character/ItemTooltip";
import { GameTooltip } from "./ui/GameTooltip";
import type { CharacterDetails, GameVersion, RosterCharacter } from "@/lib/types";
import type { Localized } from "@wow/config";

export interface DetailsRow {
  character: RosterCharacter;
  alt: boolean;
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

type TabKey = "summary" | "gear" | "mythicPlus" | "dungeons" | "raids" | "professions" | "reputations";

/**
 * Tabs come from the game version: each one appears only when the version's API provides that data
 * (its profile's characterEndpoints), so Classic, retail and later Forever each show what they have.
 */
function tabsFor(version: GameVersion): TabKey[] {
  const has = (endpoint: string) => version.characterEndpoints.includes(endpoint);
  const tabs: TabKey[] = ["summary"];
  if (has("equipment")) tabs.push("gear");
  if (has("mythicPlus")) tabs.push("mythicPlus");
  if (has("dungeons")) tabs.push("dungeons");
  if (has("raids")) tabs.push("raids");
  if (version.apiProfessions || version.professions.length > 0) tabs.push("professions");
  if (has("reputations")) tabs.push("reputations");
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
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showAlts} onChange={(e) => setShowAlts(e.target.checked)} />
          {t("showAlts")}
        </label>
      </div>
      {shown.length === 0 ? (
        <p className="card text-sm text-muted">{t("empty")}</p>
      ) : (
        <div className="card overflow-x-auto p-0">
          {tab === "summary" && <SummaryTable version={version} rows={shown} />}
          {tab === "gear" && <GearTable version={version} rows={shown} locale={locale} />}
          {tab === "mythicPlus" && <MythicPlusTable version={version} rows={shown} weekStart={weekStart} />}
          {tab === "dungeons" && <InstanceTable version={version} rows={shown} kind="dungeons" />}
          {tab === "raids" && <InstanceTable version={version} rows={shown} kind="raids" />}
          {tab === "professions" && <ProfessionsTable version={version} rows={shown} />}
          {tab === "reputations" && <ReputationsTable version={version} rows={shown} />}
        </div>
      )}
    </div>
  );
}

function Table({ head, children, footer }: { head: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <>
      <table className="w-full min-w-max border-collapse text-sm">
        <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
          <tr>{head}</tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
      {footer && <div className="border-t border-border px-3 py-2 text-xs text-muted">{footer}</div>}
    </>
  );
}

const Th = ({ children, className = "" }: { children?: ReactNode; className?: string }) => (
  <th className={`whitespace-nowrap px-3 py-2 font-medium ${className}`}>{children}</th>
);
const Td = ({ children, className = "", title, colSpan }: { children?: ReactNode; className?: string; title?: string; colSpan?: number }) => (
  <td className={`whitespace-nowrap px-3 py-1.5 ${className}`} title={title} colSpan={colSpan}>
    {children}
  </td>
);

/** First column: the character, linked to its sheet, sticky while the table scrolls sideways. */
function NameCell({ version, row }: { version: GameVersion; row: DetailsRow }) {
  const c = row.character;
  const name = (
    <span className="text-class font-medium" style={classText(classColor(version, c.classId))}>
      {c.name}
    </span>
  );
  return (
    <td className="sticky left-0 z-10 whitespace-nowrap bg-surface px-3 py-1.5">
      {row.alt && <span className="mr-1 text-muted">↳</span>}
      {c.gameVersion && c.region && c.realm ? (
        <Link
          href={characterPath({ gameVersion: c.gameVersion, region: c.region, realm: c.realm, name: c.name })}
          className="hover:underline"
        >
          {name}
        </Link>
      ) : (
        name
      )}
    </td>
  );
}

const Missing = ({ reason }: { reason?: string }) => {
  const t = useTranslations("details");
  return <span className="text-muted" title={reason ? t("missingReason", { reason }) : undefined}>—</span>;
};

function SummaryTable({ version, rows }: { version: GameVersion; rows: DetailsRow[] }) {
  const t = useTranslations("details");
  const locale = useLocale();
  const format = useFormatter();
  const hasRaids = version.characterEndpoints.includes("raids");
  const hasMythic = version.characterEndpoints.includes("mythicPlus");
  const current = latestInstances(rows.flatMap((r) => r.details?.raids ?? []));
  const when = (iso: string | null | undefined) => (iso ? format.relativeTime(new Date(iso)) : "—");
  return (
    <Table
      head={
        <>
          <Th className="sticky left-0 z-10 bg-surface-2">{t("character")}</Th>
          <Th>{t("level")}</Th>
          <Th>{t("spec")}</Th>
          <Th>{t("itemLevel")}</Th>
          {hasMythic && <Th>{t("mythicRating")}</Th>}
          {hasRaids && current.map((i) => <Th key={i.id ?? tr(i.name, locale)}>{tr(i.name, locale)}</Th>)}
          <Th>{t("lastLogin")}</Th>
          <Th>{t("synced")}</Th>
        </>
      }
    >
      {rows.map((row) => {
        const c = row.character;
        const d = row.details;
        return (
          <tr key={c.entryId}>
            <NameCell version={version} row={row} />
            <Td>{d?.level ?? c.level}</Td>
            <Td>{specName(version, c.classId, c.specKey, locale)}</Td>
            <Td className="tabular-nums">{d?.equippedItemLevel ?? c.itemLevel ?? "—"}</Td>
            {hasMythic && (
              <Td className="tabular-nums">
                {d?.mythicPlus?.rating != null ? (
                  <span style={{ color: d.mythicPlus.color }}>{Math.round(d.mythicPlus.rating)}</span>
                ) : (
                  <Missing reason={d?.missing.mythicPlus} />
                )}
              </Td>
            )}
            {hasRaids &&
              current.map((instance) => {
                const mode = bestMode(d?.raids?.find((r) => r.id === instance.id));
                return (
                  <Td key={instance.id ?? tr(instance.name, locale)} className="tabular-nums">
                    {mode ? `${mode.completed}/${mode.total} ${tr(mode.difficultyName, locale) || mode.difficulty}` : "—"}
                  </Td>
                );
              })}
            <Td className="text-muted">{when(d?.lastLoginAt)}</Td>
            <Td className="text-muted">{d?.syncError === "not_found" ? t("notFound") : when(d?.lastSyncedAt ?? c.lastSyncedAt)}</Td>
          </tr>
        );
      })}
    </Table>
  );
}

function GearTable({ version, rows, locale }: { version: GameVersion; rows: DetailsRow[]; locale: string }) {
  const t = useTranslations("details");
  const tSlots = useTranslations("slots");
  const slots = GEAR_SLOTS.filter((slot) => rows.some((r) => r.details?.equipment?.some((i) => i.slot === slot)));
  return (
    <Table
      head={
        <>
          <Th className="sticky left-0 z-10 bg-surface-2">{t("character")}</Th>
          <Th>{t("itemLevel")}</Th>
          {slots.map((slot) => (
            <Th key={slot}>{tSlots.has(slot) ? tSlots(slot) : slot}</Th>
          ))}
        </>
      }
      footer={t("gearLegend")}
    >
      {rows.map((row) => {
        const items = new Map((row.details?.equipment ?? []).map((i) => [i.slot, i]));
        return (
          <tr key={row.character.entryId}>
            <NameCell version={version} row={row} />
            <Td className="tabular-nums font-medium">{row.details?.equippedItemLevel ?? "—"}</Td>
            {row.details?.equipment == null ? (
              <Td className="text-muted" colSpan={slots.length}>
                <Missing reason={row.details?.missing.equipment} />
              </Td>
            ) : (
              slots.map((slot) => {
                const item = items.get(slot);
                if (!item) return <Td key={slot} className="text-muted">—</Td>;
                return (
                  <Td key={slot}>
                    <span className="inline-flex items-center gap-1">
                      {/* Same in-game tooltip as the character sheet; the arrow opens the item on Wowhead. */}
                      <GameTooltip
                        label={`${tSlots.has(slot) ? tSlots(slot) : slot}: ${tr(item.name, locale)}`}
                        content={<ItemTooltip item={item} />}
                        className="inline-flex items-center gap-1 rounded tabular-nums hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                        style={{ color: GAME_QUALITY_COLORS[item.quality ?? ""] }}
                      >
                        {item.icon && (
                          // eslint-disable-next-line @next/next/no-img-element -- Blizzard icon CDN, already sized.
                          <img src={item.icon} alt="" width={18} height={18} className="h-[18px] w-[18px] rounded-sm" />
                        )}
                        {item.itemLevel ?? "?"}
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
                  </Td>
                );
              })
            )}
          </tr>
        );
      })}
    </Table>
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
 * One column per Mythic+ dungeon of the season: the character's best key there, this week's runs (count and
 * highest) and how many times the dungeon was cleared on Mythic overall.
 */
function MythicPlusTable({ version, rows, weekStart }: { version: GameVersion; rows: DetailsRow[]; weekStart: string | null }) {
  const t = useTranslations("details");
  const locale = useLocale();
  const { cells, dungeons, names } = useMemo(() => {
    const names = new Map<string, Localized>();
    const start = weekStart ? Date.parse(weekStart) : 0;
    const cells = new Map(rows.map((row) => [row.character.entryId, mythicPlusCells(row.details, start, names)]));
    // Columns: dungeons with a key this season or this week, in any character.
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
          <Th className="sticky left-0 z-10 bg-surface-2">{t("character")}</Th>
          <Th>{t("mythicRating")}</Th>
          <Th>{t("seasonBest")}</Th>
          <Th>{t("dungeonsTimed")}</Th>
          <Th>{t("weeklyKeys")}</Th>
          {dungeons.map((d) => (
            <Th key={d}>{tr(names.get(d), locale)}</Th>
          ))}
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
          <tr key={row.character.entryId}>
            <NameCell version={version} row={row} />
            <Td className="tabular-nums">
              {c.rating != null ? <span style={{ color: c.color }}>{Math.round(c.rating)}</span> : <Missing reason={row.details?.missing.mythicPlus} />}
              {c.profileUrl && (
                <a href={c.profileUrl} target="_blank" rel="noreferrer" className="ml-1 text-xs text-muted" title="Raider.IO">
                  ↗
                </a>
              )}
            </Td>
            <Td className="tabular-nums">{best ? `${key(best[1])} ${tr(names.get(best[0]), locale)}` : "—"}</Td>
            <Td className="tabular-nums">{c.season.size > 0 ? `${[...c.season.values()].filter((r) => r.timed).length}/${dungeons.length}` : "—"}</Td>
            <Td className="tabular-nums">{row.details?.mythicPlus || row.details?.raiderIo ? c.weekRuns : "—"}</Td>
            {dungeons.map((d) => {
              const s = c.season.get(d);
              const w = c.week.get(d) ?? [];
              const total = c.total.get(d);
              const top = [...w].sort((a, b) => b.level - a.level)[0];
              return (
                <Td key={d} className="tabular-nums" title={s?.rating != null ? t("runRating", { rating: Math.round(s.rating) }) : undefined}>
                  <span className={s && !s.timed ? "text-muted" : ""}>{key(s) ?? "—"}</span>
                  {top && <span className="block text-xs">{t("thisWeek", { count: w.length, key: key(top)! })}</span>}
                  {total !== undefined && <span className="block text-xs text-muted">{t("totalClears", { count: total })}</span>}
                </Td>
              );
            })}
          </tr>
        );
      })}
    </Table>
  );
}

/** Raids or dungeons: pick an instance (raids) or see every dungeon of an expansion, best difficulty cleared. */
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
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <label className="text-sm" htmlFor={`${kind}-expansion`}>{t("expansion")}</label>
        <select
          id={`${kind}-expansion`}
          className="input w-auto"
          value={expansion ?? ""}
          onChange={(e) => setExpansion(Number(e.target.value))}
        >
          {expansions.map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
      </div>
      <Table
        head={
          <>
            <Th className="sticky left-0 z-10 bg-surface-2">{t("character")}</Th>
            {instances.map((i) => (
              <Th key={i.id ?? tr(i.name, locale)}>{tr(i.name, locale)}</Th>
            ))}
          </>
        }
        footer={t("instanceLegend")}
      >
        {rows.map((row) => (
          <tr key={row.character.entryId}>
            <NameCell version={version} row={row} />
            {row.details?.[kind] == null ? (
              <Td className="text-muted" colSpan={instances.length}>
                <Missing reason={row.details?.missing[kind]} />
              </Td>
            ) : (
              instances.map((instance) => {
                const own = row.details?.[kind]?.find((i) => i.id === instance.id);
                const mode = bestMode(own);
                const title = own?.modes
                  .filter((m) => m.completed > 0 && m.difficulty !== "UNKNOWN")
                  .map((m) => `${tr(m.difficultyName, locale) || m.difficulty}: ${m.completed}/${m.total}`)
                  .join("\n");
                return (
                  <Td key={instance.id ?? tr(instance.name, locale)} className="tabular-nums" title={title}>
                    {mode ? `${mode.completed}/${mode.total} ${tr(mode.difficultyName, locale) || mode.difficulty}` : "—"}
                  </Td>
                );
              })
            )}
          </tr>
        ))}
      </Table>
    </div>
  );
}

function ProfessionsTable({ version, rows }: { version: GameVersion; rows: DetailsRow[] }) {
  const t = useTranslations("details");
  const locale = useLocale();
  const nameOf = (id: number) => tr(version.professions.find((p) => p.id === id)?.name, locale);
  const kindOf = (id: number) => version.professions.find((p) => p.id === id)?.kind;
  const slots = Array.from({ length: version.maxPrimaryProfessions }, (_, i) => i);
  return (
    <Table
      head={
        <>
          <Th className="sticky left-0 z-10 bg-surface-2">{t("character")}</Th>
          {slots.map((i) => (
            <Th key={i}>{t("primary", { number: i + 1 })}</Th>
          ))}
          <Th>{t("secondary")}</Th>
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
            }))
          : (row.details?.manualProfessions ?? []).map((m) => ({
              name: nameOf(m.id),
              secondary: kindOf(m.id) === "secondary",
              skill: m.skill ?? undefined,
              max: version.professions.find((p) => p.id === m.id)?.maxSkill,
              tier: undefined,
            }));
        const primaries = list.filter((p) => !p.secondary);
        const secondaries = list.filter((p) => p.secondary);
        const label = (p: (typeof list)[number]) => `${p.name}${p.skill != null ? ` ${p.skill}/${p.max ?? "?"}` : ""}`;
        return (
          <tr key={row.character.entryId}>
            <NameCell version={version} row={row} />
            {slots.map((i) => (
              <Td key={i} title={primaries[i]?.tier}>
                {primaries[i] ? label(primaries[i]) : "—"}
              </Td>
            ))}
            <Td className="text-muted">{secondaries.map(label).join(" · ") || "—"}</Td>
          </tr>
        );
      })}
    </Table>
  );
}

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
  const [faction, setFaction] = useState<number | undefined>(factions[0]?.[0]);

  if (factions.length === 0) return <p className="p-4 text-sm text-muted">{t("noReputations")}</p>;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <label className="text-sm" htmlFor="rep-faction">{t("faction")}</label>
        <select id="rep-faction" className="input w-auto max-w-full" value={faction ?? ""} onChange={(e) => setFaction(Number(e.target.value))}>
          {factions.map(([id, { name, count }]) => (
            <option key={id} value={id}>
              {name} ({count})
            </option>
          ))}
        </select>
      </div>
      <Table
        head={
          <>
            <Th className="sticky left-0 z-10 bg-surface-2">{t("character")}</Th>
            <Th>{t("standing")}</Th>
            <Th>{t("progress")}</Th>
          </>
        }
      >
        {rows.map((row) => {
          const rep = row.details?.reputations?.find((r) => r.factionId === faction);
          return (
            <tr key={row.character.entryId}>
              <NameCell version={version} row={row} />
              <Td>
                {rep ? (
                  tr(rep.standing, locale) || (rep.renownLevel != null ? t("renown", { level: rep.renownLevel }) : "—")
                ) : row.details?.reputations == null ? (
                  <Missing reason={row.details?.missing.reputations} />
                ) : (
                  "—"
                )}
              </Td>
              <Td className="tabular-nums text-muted">{rep?.value != null && rep.max ? `${rep.value}/${rep.max}` : ""}</Td>
            </tr>
          );
        })}
      </Table>
    </div>
  );
}
