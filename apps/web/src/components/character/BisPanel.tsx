"use client";

import { BIS_SLOTS, bisSlot, localize } from "@wow/config";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useRouter } from "@/i18n/routing";
import { ApiError, apiSend } from "@/lib/client-api";
import { QUALITY_COLORS, wowheadItemUrl } from "@/lib/game";
import { tr } from "@/lib/text";
import { loadWowheadTooltips, refreshWowheadLinks } from "@/lib/wowhead";
import type { BisItem, BisSource, GameVersion } from "@/lib/types";

interface Props {
  version: GameVersion;
  bis: BisItem[];
  canEdit: boolean;
  /** API path the whole list is PUT to (character or planned entry). */
  endpoint: string;
  /** Item ids the character currently has equipped, to mark each BiS item obtained (✓) or missing (✗). Omit for
   *  planned entries and unsynced characters, where there is no equipment to compare against. */
  equippedItemIds?: number[];
}

/**
 * The readable zone an item comes from: a profile raid/dungeon name when its key matches, otherwise the source's
 * own zone name (e.g. "Scarlet Monastery: Armory"). Null when the source is generic (quest/vendor…) or unknown.
 */
function sourceZoneName(version: GameVersion, source: BisSource | null | undefined, locale: string): string | null {
  if (!source) return null;
  const raid = version.raids.find((r) => r.key === source.zoneKey);
  if (raid) return localize(raid.name, locale);
  const dungeon = version.dungeons.find((d) => d.key === source.zoneKey);
  if (dungeon) return localize(dungeon.name, locale);
  return source.zoneName ? tr(source.zoneName, locale) : null;
}

/**
 * One line describing where an item drops: the zone (instance, quest zone…) and, after a dot, the detail — the
 * boss for a raid/dungeon drop, or the quest name for a quest reward. Falls back to the generic source type.
 */
function sourceSummary(
  version: GameVersion,
  source: BisSource | null | undefined,
  locale: string,
  t: (key: string) => string,
): string | null {
  if (!source) return null;
  const zone = sourceZoneName(version, source, locale);
  const detail = source.bossName ? tr(source.bossName, locale) : null;
  const where = zone ?? t(`sourceType.${source.type}`);
  return detail ? `${where} · ${detail}` : where;
}

/** Best-in-slot list with two groupings (slot, zone) and a Wowhead link per item. The list is filled by import. */
export function BisPanel({ version, bis, canEdit, endpoint, equippedItemIds }: Props) {
  const t = useTranslations("bis");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const router = useRouter();
  // Wowhead tooltips power the saved list; load the widget once and rescan when the list changes.
  useEffect(() => loadWowheadTooltips(), []);
  const [list, setList] = useState<BisItem[]>(bis);
  // Which BiS items the character already has equipped. Only compared when the caller passes the equipped ids
  // (a real, synced character); planned entries and unsynced characters show no obtained/missing marker.
  const equipped = equippedItemIds ? new Set(equippedItemIds) : null;
  const obtainedCount = equipped ? list.filter((i) => equipped.has(i.itemId)).length : 0;
  const [mode, setMode] = useState<"slot" | "zone">("slot");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => refreshWowheadLinks(), [list, mode]);

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
          {equipped && list.length > 0 && (
            <p className="mt-1 text-xs font-medium text-muted">{t("obtainedCount", { have: obtainedCount, total: list.length })}</p>
          )}
        </div>
        <div className="flex rounded-md border border-border text-sm">
          <button type="button" className={`px-3 py-1 ${mode === "slot" ? "bg-white/10" : ""}`} onClick={() => setMode("slot")}>
            {t("bySlot")}
          </button>
          <button type="button" className={`px-3 py-1 ${mode === "zone" ? "bg-white/10" : ""}`} onClick={() => setMode("zone")}>
            {t("byZone")}
          </button>
        </div>
      </div>

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
                    {/* Obtained marker: a green ✓ when the character has this item equipped, else a muted ✗. */}
                    {equipped &&
                      (equipped.has(item.itemId) ? (
                        <span className="badge border border-success/60 text-success" title={t("obtained")}>
                          ✓ {t("obtained")}
                        </span>
                      ) : (
                        <span className="badge bg-surface-2 text-muted" title={t("missing")}>
                          {t("missing")}
                        </span>
                      ))}
                    {/* By slot: the obtained-from zone (+ boss). By zone: the slot, since the zone is the group header. */}
                    {mode === "slot" && (
                      <span className="text-xs text-muted">{sourceSummary(version, item.source, locale, t) ?? t("sourceType.other")}</span>
                    )}
                    {mode === "zone" && <span className="text-xs text-muted">{localize(bisSlot(item.slot)?.name ?? {}, locale)}</span>}
                    {mode === "zone" && item.source?.bossName && <span className="text-xs text-muted">· {tr(item.source.bossName, locale)}</span>}
                    {item.itemLevel ? <span className="text-xs text-muted">{t("ilvl", { level: item.itemLevel })}</span> : null}
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
