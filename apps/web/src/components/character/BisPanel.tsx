"use client";

import { BIS_SLOTS, bisSlot, localize } from "@wow/config";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "@/i18n/routing";
import { ApiError, apiSend } from "@/lib/client-api";
import { QUALITY_COLORS, wowheadItemUrl } from "@/lib/game";
import { tr } from "@/lib/text";
import type { BisItem, BisSource, GameVersion, ItemSearchResult } from "@/lib/types";

interface Props {
  version: GameVersion;
  region: string;
  bis: BisItem[];
  canEdit: boolean;
  /** API path the whole list is PUT to (character or planned entry). */
  endpoint: string;
  /** Character level, to default the search bracket; planned entries pass the version cap. */
  level?: number | null;
}

/** 10-level brackets up to the version cap, e.g. [1,10],[11,20]… The last one ends at the cap. */
function brackets(maxLevel: number): { min: number; max: number }[] {
  const out: { min: number; max: number }[] = [];
  for (let min = 1; min <= maxLevel; min += 10) out.push({ min, max: Math.min(min + 9, maxLevel) });
  return out;
}

/** Best-in-slot list with two groupings (slot, zone), a Wowhead link per item and a Raidbots-style item search. */
export function BisPanel({ version, region, bis, canEdit, endpoint, level }: Props) {
  const t = useTranslations("bis");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const router = useRouter();
  const [list, setList] = useState<BisItem[]>(bis);
  const [mode, setMode] = useState<"slot" | "zone">("slot");
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: BisItem[]) {
    const previous = list;
    setList(next);
    setError(null);
    try {
      await apiSend("PUT", endpoint, { bis: next });
      router.refresh();
    } catch (err) {
      setList(previous);
      setError(err instanceof ApiError && tErrors.has(err.code) ? tErrors(err.code) : tErrors("unknown_error"));
    }
  }

  const add = (item: BisItem) => save([...list, item]);
  const remove = (index: number) => save(list.filter((_, i) => i !== index));
  const setSource = (index: number, source: BisSource | undefined) =>
    save(list.map((item, i) => (i === index ? { ...item, source } : item)));

  // The zone label and a stable group key for the "by zone" grouping.
  const zoneOf = (item: BisItem): { key: string; label: string } => {
    const s = item.source;
    if (!s) return { key: "~none", label: t("unassigned") };
    const raid = version.raids.find((r) => r.key === s.zoneKey);
    const dungeon = version.dungeons.find((d) => d.key === s.zoneKey);
    if (raid) return { key: s.zoneKey!, label: localize(raid.name, locale) };
    if (dungeon) return { key: s.zoneKey!, label: localize(dungeon.name, locale) };
    if (s.zoneName) return { key: tr(s.zoneName, locale), label: tr(s.zoneName, locale) };
    return { key: s.type, label: t(`sourceType.${s.type}`) };
  };

  // Group entries (with their original index so edits target the right item), ordered per mode.
  const withIndex = list.map((item, index) => ({ item, index }));
  const groups =
    mode === "slot"
      ? BIS_SLOTS.map((slot) => ({
          key: slot.key,
          label: localize(slot.name, locale),
          entries: withIndex.filter((e) => e.item.slot === slot.key),
        })).filter((g) => g.entries.length > 0)
      : Object.values(
          withIndex.reduce<Record<string, { key: string; label: string; entries: typeof withIndex }>>((acc, e) => {
            const { key, label } = zoneOf(e.item);
            (acc[key] ??= { key, label, entries: [] }).entries.push(e);
            return acc;
          }, {}),
        ).sort((a, b) => (a.key === "~none" ? 1 : b.key === "~none" ? -1 : a.label.localeCompare(b.label)));

  return (
    <section className="card space-y-3" aria-labelledby="bis-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="bis-title" className="heading text-lg">
            {t("title")}
          </h2>
          <p className="text-xs text-muted">{t("help")}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border text-sm">
            <button type="button" className={`px-3 py-1 ${mode === "slot" ? "bg-white/10" : ""}`} onClick={() => setMode("slot")}>
              {t("bySlot")}
            </button>
            <button type="button" className={`px-3 py-1 ${mode === "zone" ? "bg-white/10" : ""}`} onClick={() => setMode("zone")}>
              {t("byZone")}
            </button>
          </div>
          {canEdit && version.apiAvailable && (
            <button type="button" className="btn btn-primary" onClick={() => setPicking(true)}>
              {t("add")}
            </button>
          )}
        </div>
      </div>

      {canEdit && !version.apiAvailable && <p className="text-xs text-muted">{t("noApi")}</p>}
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      {list.length === 0 ? (
        <p className="text-sm text-muted">{t("empty")}</p>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <div key={group.key}>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{group.label}</h3>
              <ul className="divide-y divide-border">
                {group.entries.map(({ item, index }) => (
                  <li key={index} className="flex flex-wrap items-center gap-2 py-1.5">
                    {item.icon ? (
                      // eslint-disable-next-line @next/next/no-img-element -- Blizzard icon CDN, already sized.
                      <img src={item.icon} alt="" width={28} height={28} className="rounded border border-border" />
                    ) : (
                      <span className="h-7 w-7 rounded border border-border bg-white/5" />
                    )}
                    <a
                      href={wowheadItemUrl(version, locale, { itemId: item.itemId })}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium hover:underline"
                      style={{ color: QUALITY_COLORS[item.quality ?? "COMMON"] ?? "inherit" }}
                    >
                      {item.name}
                    </a>
                    {mode === "slot" && <span className="text-xs text-muted">{t(`sourceType.${item.source?.type ?? "other"}`)}</span>}
                    {mode === "zone" && <span className="text-xs text-muted">{localize(bisSlot(item.slot)?.name ?? {}, locale)}</span>}
                    {item.itemLevel ? <span className="text-xs text-muted">{t("ilvl", { level: item.itemLevel })}</span> : null}
                    {item.source?.bossName && <span className="text-xs text-muted">· {tr(item.source.bossName, locale)}</span>}
                    {canEdit && (
                      <span className="ml-auto flex items-center gap-2">
                        <ZoneSelect version={version} value={item.source} onChange={(s) => setSource(index, s)} />
                        <button type="button" className="text-xs text-danger hover:underline" onClick={() => remove(index)}>
                          {t("remove")}
                        </button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {picking && (
        <ItemSearch
          version={version}
          region={region}
          defaultLevel={level ?? version.maxLevel}
          onClose={() => setPicking(false)}
          onAdd={(item) => add(item)}
        />
      )}
    </section>
  );
}

/** Compact manual zone override: profile raids and dungeons, then generic sources. */
function ZoneSelect({ version, value, onChange }: { version: GameVersion; value: BisSource | undefined; onChange: (s: BisSource | undefined) => void }) {
  const t = useTranslations("bis");
  const locale = useLocale();
  const current = value?.zoneKey ?? (value ? `type:${value.type}` : "");
  const generic: BisSource["type"][] = ["quest", "vendor", "crafted", "pvp", "world", "other"];

  return (
    <select
      className="input !w-auto !py-0.5 text-xs"
      value={current}
      onChange={(e) => {
        const v = e.target.value;
        if (!v) return onChange(undefined);
        if (v.startsWith("type:")) return onChange({ type: v.slice(5) as BisSource["type"] });
        const raid = version.raids.find((r) => r.key === v);
        const dungeon = version.dungeons.find((d) => d.key === v);
        if (raid) return onChange({ type: "raid", zoneKey: raid.key, zoneName: raid.name });
        if (dungeon) return onChange({ type: "dungeon", zoneKey: dungeon.key, zoneName: dungeon.name });
      }}
      aria-label={t("zoneLabel")}
    >
      <option value="">{t("unassigned")}</option>
      {version.raids.map((r) => (
        <option key={`r-${r.key}`} value={r.key}>
          {localize(r.name, locale)}
        </option>
      ))}
      {version.dungeons.map((d) => (
        <option key={`d-${d.key}`} value={d.key}>
          {localize(d.name, locale)}
        </option>
      ))}
      {generic.map((type) => (
        <option key={type} value={`type:${type}`}>
          {t(`sourceType.${type}`)}
        </option>
      ))}
    </select>
  );
}

/** Raidbots-style item picker: a name search bounded to a 10-level bracket, the character's bracket preselected. */
function ItemSearch({
  version,
  region,
  defaultLevel,
  onClose,
  onAdd,
}: {
  version: GameVersion;
  region: string;
  defaultLevel: number;
  onClose: () => void;
  onAdd: (item: BisItem) => void;
}) {
  const t = useTranslations("bis");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const ranges = brackets(version.maxLevel);
  const defaultIndex = Math.max(0, ranges.findIndex((r) => defaultLevel >= r.min && defaultLevel <= r.max));
  const [bracket, setBracket] = useState(defaultIndex);
  const [query, setQuery] = useState("");
  const [slot, setSlot] = useState("");
  const [sort, setSort] = useState<"level" | "rarity" | "type">("level");
  const [results, setResults] = useState<ItemSearchResult[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<number>>(new Set());

  async function run() {
    const range = ranges[bracket]!;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ version: version.id, region, minLevel: String(range.min), maxLevel: String(range.max), sort });
      if (query.trim()) params.set("q", query.trim());
      if (slot) params.set("slot", slot);
      const res = await fetch(`/api/items/search?${params}`, { credentials: "same-origin" });
      const data = (await res.json().catch(() => ({}))) as { items?: ItemSearchResult[]; truncated?: boolean; error?: string };
      if (!res.ok) throw new ApiError(res.status, data.error ?? "unknown_error");
      setResults(data.items ?? []);
      setTruncated(data.truncated ?? false);
    } catch (err) {
      setError(err instanceof ApiError && tErrors.has(err.code) ? tErrors(err.code) : tErrors("unknown_error"));
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  const addResult = (r: ItemSearchResult) => {
    onAdd({
      slot: r.slot,
      itemId: r.id,
      name: tr(r.name, locale),
      icon: r.icon ?? undefined,
      quality: r.quality ?? undefined,
      itemLevel: r.itemLevel ?? undefined,
      requiredLevel: r.requiredLevel ?? undefined,
      source: r.source ?? undefined,
    });
    setAdded((prev) => new Set(prev).add(r.id));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="card my-8 w-full max-w-2xl space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="heading text-lg">{t("search")}</h3>
          <button type="button" className="btn" onClick={onClose}>
            {t("close")}
          </button>
        </div>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <div className="grow">
            <label className="label" htmlFor="bis-q">
              {t("searchPlaceholder")}
            </label>
            <input id="bis-q" className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("searchPlaceholder")} />
          </div>
          <div>
            <label className="label" htmlFor="bis-bracket">
              {t("levelRange")}
            </label>
            <select id="bis-bracket" className="input !w-auto" value={bracket} onChange={(e) => setBracket(Number(e.target.value))}>
              {ranges.map((r, i) => (
                <option key={i} value={i}>
                  {t("bracket", { min: r.min, max: r.max })}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="bis-slot">
              {t("slotFilter")}
            </label>
            <select id="bis-slot" className="input !w-auto" value={slot} onChange={(e) => setSlot(e.target.value)}>
              <option value="">{t("slotAll")}</option>
              {BIS_SLOTS.filter((s) => s.key !== "other").map((s) => (
                <option key={s.key} value={s.key}>
                  {localize(s.name, locale)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="bis-sort">
              {t("sortBy")}
            </label>
            <select id="bis-sort" className="input !w-auto" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
              <option value="level">{t("sortLevel")}</option>
              <option value="rarity">{t("sortRarity")}</option>
              <option value="type">{t("sortType")}</option>
            </select>
          </div>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? t("searching") : t("searchButton")}
          </button>
        </form>
        <p className="text-xs text-muted">{t("searchHint")}</p>
        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}

        {results && (
          <>
            {results.length === 0 ? (
              <p className="text-sm text-muted">{t("noResults")}</p>
            ) : (
              <ul className="max-h-80 divide-y divide-border overflow-y-auto">
                {results.map((r) => (
                  <li key={r.id} className="flex items-center gap-2 py-1.5">
                    {r.icon ? (
                      // eslint-disable-next-line @next/next/no-img-element -- Blizzard icon CDN, already sized.
                      <img src={r.icon} alt="" width={28} height={28} className="rounded border border-border" />
                    ) : (
                      <span className="h-7 w-7 rounded border border-border bg-white/5" />
                    )}
                    <a
                      href={wowheadItemUrl(version, locale, { itemId: r.id })}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium hover:underline"
                      style={{ color: QUALITY_COLORS[r.quality ?? "COMMON"] ?? "inherit" }}
                    >
                      {tr(r.name, locale)}
                    </a>
                    <span className="text-xs text-muted">{localize(bisSlot(r.slot)?.name ?? {}, locale)}</span>
                    {r.subclass ? <span className="text-xs text-muted">{tr(r.subclass, locale)}</span> : null}
                    {r.itemLevel ? <span className="text-xs text-muted">{t("ilvl", { level: r.itemLevel })}</span> : null}
                    <button type="button" className="btn ml-auto" disabled={added.has(r.id)} onClick={() => addResult(r)}>
                      {added.has(r.id) ? t("addedLabel") : t("addLabel")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {truncated && <p className="text-xs text-muted">{t("truncated")}</p>}
          </>
        )}
      </div>
    </div>
  );
}
