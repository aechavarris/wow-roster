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
  /** Character/entry class, to preselect the matching imported BiS lists. */
  classId?: number | null;
  /** Character/entry spec key, to preselect the matching imported BiS lists. */
  spec?: string | null;
  /** Item ids the character currently has equipped, to mark each BiS item obtained (✓) or missing (✗). Omit for
   *  planned entries and unsynced characters, where there is no equipment to compare against. */
  equippedItemIds?: number[];
}

/** A curated BiS set from a third-party source, as served by GET /api/bis-templates. */
interface BisTemplate {
  sourceKey: string;
  sourceName: string;
  sourceUrl: string;
  popularity?: number;
  classId: number;
  spec: string;
  phase: number;
  label: string;
  items: { slot: string; itemId: number; source?: BisSource }[];
}
interface BisTemplatesResponse {
  templates: BisTemplate[];
  sources: { key: string; name: string; url: string; popularity?: number }[];
}
/** Wowhead by-id entity, used to resolve an imported item id to a name/icon/quality for the saved list. */
interface WowheadEntity {
  name: string;
  quality?: number;
  qualityName?: string;
  itemLevel?: number;
  reqLevel?: number;
  icon?: string;
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
export function BisPanel({ version, bis, canEdit, endpoint, classId, spec, equippedItemIds }: Props) {
  const t = useTranslations("bis");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const router = useRouter();
  // Wowhead tooltips power the saved list; load the widget once and rescan when the list changes.
  useEffect(() => loadWowheadTooltips(), []);
  const [list, setList] = useState<BisItem[]>(bis);
  const [importing, setImporting] = useState(false);
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
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border text-sm">
            <button type="button" className={`px-3 py-1 ${mode === "slot" ? "bg-white/10" : ""}`} onClick={() => setMode("slot")}>
              {t("bySlot")}
            </button>
            <button type="button" className={`px-3 py-1 ${mode === "zone" ? "bg-white/10" : ""}`} onClick={() => setMode("zone")}>
              {t("byZone")}
            </button>
          </div>
          {canEdit && (
            <button type="button" className="btn btn-primary" onClick={() => setImporting(true)}>
              {t("importButton")}
            </button>
          )}
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

      {importing && (
        <ImportBis
          version={version}
          classId={classId ?? null}
          spec={spec ?? null}
          onClose={() => setImporting(false)}
          onImport={(items) => save([...list, ...items].slice(0, 100))}
        />
      )}
    </section>
  );
}

/**
 * Import a ready-made BiS set from a third-party source (GET /api/bis-templates). Lists the curated builds for the
 * character's class/spec, each labelled with its source; previewing or importing one resolves its item ids to
 * names/icons via the Wowhead by-id proxy, then adds the items to the saved list.
 */
function ImportBis({
  version,
  classId,
  spec,
  onClose,
  onImport,
}: {
  version: GameVersion;
  classId: number | null;
  spec: string | null;
  onClose: () => void;
  onImport: (items: BisItem[]) => void;
}) {
  const t = useTranslations("bis");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const [data, setData] = useState<BisTemplatesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ key: string; items: BisItem[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => refreshWowheadLinks(), [preview]);

  useEffect(() => {
    // Browse by class (not spec): the data is sparse, so show every build for the class and just mark the
    // character's own spec, rather than hiding everything when there is no exact spec match.
    const params = new URLSearchParams({ version: version.id });
    if (classId != null) params.set("classId", String(classId));
    fetch(`/api/bis-templates?${params}`, { credentials: "same-origin" })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as BisTemplatesResponse & { error?: string };
        if (!res.ok) throw new ApiError(res.status, body.error ?? "unknown_error");
        setData({ templates: body.templates ?? [], sources: body.sources ?? [] });
      })
      .catch((err) => setError(err instanceof ApiError && tErrors.has(err.code) ? tErrors(err.code) : tErrors("unknown_error")));
  }, [version.id, classId, tErrors]);

  // Resolves a template's item ids to saved-list items (name/icon/quality) via the Wowhead by-id proxy.
  async function resolve(template: BisTemplate): Promise<BisItem[]> {
    const results = await Promise.all(
      template.items.map(async ({ slot, itemId, source }) => {
        try {
          const res = await fetch(`/api/wowhead/item/${itemId}?version=${version.id}`, { credentials: "same-origin" });
          const body = (await res.json().catch(() => ({}))) as { entity?: WowheadEntity };
          const e = res.ok ? body.entity : undefined;
          const item: BisItem = {
            slot,
            itemId,
            name: e?.name && e.name.length > 0 ? e.name : `#${itemId}`,
            quality: e?.qualityName ? e.qualityName.toUpperCase() : undefined,
            itemLevel: e?.itemLevel,
            requiredLevel: e?.reqLevel,
            icon: e?.icon ? `https://wow.zamimg.com/images/wow/icons/large/${e.icon}.jpg` : undefined,
            // Zone/boss filled from the source's item database at ingest; still editable by hand after import.
            ...(source ? { source } : {}),
          };
          return item;
        } catch {
          return { slot, itemId, name: `#${itemId}`, ...(source ? { source } : {}) } satisfies BisItem;
        }
      }),
    );
    return results;
  }

  async function showPreview(template: BisTemplate) {
    const key = templateKey(template);
    setBusy(key);
    setError(null);
    try {
      setPreview({ key, items: await resolve(template) });
    } finally {
      setBusy(null);
    }
  }

  async function doImport(template: BisTemplate) {
    const key = templateKey(template);
    setBusy(key);
    setError(null);
    try {
      const items = preview?.key === key ? preview.items : await resolve(template);
      onImport(items);
      onClose();
    } finally {
      setBusy(null);
    }
  }

  // The character's own spec first, then by phase, so the most relevant builds are on top of a class-wide list.
  const templates = [...(data?.templates ?? [])].sort(
    (a, b) => Number(b.spec === spec) - Number(a.spec === spec) || a.phase - b.phase,
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="card my-8 w-full max-w-2xl space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="heading text-lg">{t("importTitle")}</h3>
            <p className="text-xs text-muted">{t("importHelp")}</p>
          </div>
          <button type="button" className="btn" onClick={onClose}>
            {t("close")}
          </button>
        </div>

        {/* Sources on offer, with attribution links and popularity where the source exposes it. */}
        {data && data.sources.length > 0 && (
          <p className="text-xs text-muted">
            {t("importSources")}:{" "}
            {data.sources.map((s, i) => (
              <span key={s.key}>
                {i > 0 && ", "}
                <a href={s.url} target="_blank" rel="noreferrer" className="hover:underline">
                  {s.name}
                </a>
                {s.popularity !== undefined && ` (${t("importPopularity", { count: s.popularity })})`}
              </span>
            ))}
          </p>
        )}

        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}

        {!data ? (
          <p className="text-sm text-muted">{t("importLoading")}</p>
        ) : templates.length === 0 ? (
          <p className="text-sm text-muted">{t("importEmpty")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {templates.map((template) => {
              const key = templateKey(template);
              const open = preview?.key === key;
              return (
                <li key={key} className="space-y-2 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{template.label}</span>
                    <span className="text-xs text-muted">{template.spec}</span>
                    {spec && template.spec === spec && <span className="badge border border-success/60 text-success">{t("importYourSpec")}</span>}
                    <span className="text-xs text-muted">{template.sourceName}</span>
                    <span className="text-xs text-muted">{t("importItemCount", { count: template.items.length })}</span>
                    <span className="ml-auto flex items-center gap-2">
                      <button type="button" className="btn text-xs" disabled={busy === key} onClick={() => (open ? setPreview(null) : showPreview(template))}>
                        {open ? t("importHide") : t("importPreview")}
                      </button>
                      <button type="button" className="btn btn-primary text-xs" disabled={busy === key} onClick={() => doImport(template)}>
                        {busy === key ? t("importBusy") : t("importDo")}
                      </button>
                    </span>
                  </div>
                  {open && (
                    <ul className="grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-2">
                      {preview!.items.map((item, i) => (
                        <li key={i} className="flex items-center gap-2 py-0.5 text-sm">
                          <span className="w-20 shrink-0 text-xs text-muted">{localize(bisSlot(item.slot)?.name ?? {}, locale)}</span>
                          <a
                            href={wowheadItemUrl(version, locale, { itemId: item.itemId })}
                            target="_blank"
                            rel="noreferrer"
                            className="truncate hover:underline"
                            style={{ color: QUALITY_COLORS[item.quality ?? "COMMON"] ?? "inherit" }}
                          >
                            {item.name}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/** A stable key for a template (source + class + spec + phase + label), to track preview/import state. */
function templateKey(t: BisTemplate): string {
  return `${t.sourceKey}:${t.classId}:${t.spec}:${t.phase}:${t.label}`;
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
