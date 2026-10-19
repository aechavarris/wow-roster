import {
  enabledTemplateSources,
  parseWowsimsDatabase,
  parseWowsimsGearSet,
  type BisSource,
  type BisTemplate,
  type BisTemplateSource,
  type GameProfile,
  type WowsimsItemSource,
} from "@wow/config";
import { Prisma } from "@wow/db";
import { gameVersion } from "./context";
import type { CoreContext } from "./context";

/**
 * Imports ready-made best-in-slot sets from the configured third-party sources (see `BIS_TEMPLATE_SOURCES`) so the
 * BiS picker browses curated lists instead of searching items. Each adapter knows one source *format*; the only one
 * so far, `wowsims`, pulls a WoWSims(-fork) repo's gear-set JSON from GitHub raw (reachable server-side, unlike
 * Wowhead's finder). Results are cached per version in StaticCache and refreshed on a slow cadence, since curated
 * lists change rarely. Resolving each item id to a name/icon is left to the by-id Wowhead lookup at display time.
 */

const TTL_MS = 7 * 86_400_000;
const cacheKey = (version: string) => `${version}:bis-templates`;
const rawUrl = (owner: string, repo: string, branch: string, path: string) =>
  `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path.replace(/^\/+/, "")}`;

/** Fetches and parses a source's WoWSims item database, returning an empty map on any failure (never throws). */
async function fetchWowsimsDatabase(owner: string, repo: string, branch: string, dbPath: string, fetchImpl: typeof fetch): Promise<Map<number, WowsimsItemSource>> {
  try {
    const res = await fetchImpl(rawUrl(owner, repo, branch, dbPath));
    if (!res.ok) return new Map();
    return parseWowsimsDatabase(await res.json());
  } catch {
    return new Map();
  }
}

export interface IngestOptions {
  /** Injectable fetch (defaults to the global). Tests pass a fake. */
  fetch?: typeof fetch;
  /** Operator override of which source keys to use; see `enabledTemplateSources`. */
  enabledKeys?: readonly string[];
  /** The source registry to read (defaults to the built-in one). A future admin UI or tests pass their own. */
  sources?: readonly BisTemplateSource[];
}

/**
 * A version-specific mapper from a WoWSims item source to our `BisSource`: a drop whose zone names one of the
 * version's raids/dungeons becomes a `raid`/`dungeon` tied to that key, otherwise a free-text `world` drop; quest,
 * crafted and vendor pass through. Every result is `auto` (filled on import, still editable by hand).
 */
function bisSourceMapper(profile: GameProfile): (ws: WowsimsItemSource) => BisSource {
  const norm = (s: string) => s.trim().toLowerCase();
  const raids = new Map(profile.raids.map((r) => [norm(r.name.en ?? ""), r.key] as const));
  const dungeons = new Map(profile.dungeons.map((d) => [norm(d.name.en ?? ""), d.key] as const));
  const loc = (s: string | undefined) => (s ? { en: s } : undefined);
  return (ws) => {
    const detail = loc(ws.detail);
    if (ws.kind === "drop") {
      const zone = ws.zoneName ? norm(ws.zoneName) : "";
      const raidKey = raids.get(zone);
      if (raidKey) return { type: "raid", zoneKey: raidKey, ...(detail ? { bossName: detail } : {}), auto: true };
      const dungeonKey = dungeons.get(zone);
      if (dungeonKey) return { type: "dungeon", zoneKey: dungeonKey, ...(detail ? { bossName: detail } : {}), auto: true };
      return { type: "world", ...(loc(ws.zoneName) ? { zoneName: loc(ws.zoneName) } : {}), ...(detail ? { bossName: detail } : {}), auto: true };
    }
    if (ws.kind === "quest") return { type: "quest", ...(detail ? { bossName: detail } : {}), auto: true };
    if (ws.kind === "crafted") return { type: "crafted", auto: true };
    return { type: "vendor", ...(loc(ws.zoneName) ? { zoneName: loc(ws.zoneName) } : {}), ...(detail ? { bossName: detail } : {}), auto: true };
  };
}

/** Pulls one WoWSims-format source's gear sets into templates, skipping any set that fails or is empty. */
async function ingestWowsims(source: BisTemplateSource, version: string, fetchImpl: typeof fetch, toSource: (ws: WowsimsItemSource) => BisSource): Promise<BisTemplate[]> {
  const cfg = source.wowsims;
  if (!cfg) return [];
  // The item database (drop/quest/vendor source per id) is fetched once per source; a failure just leaves items
  // unsourced (they fall back to "other" in the UI), never failing the import.
  const sources = await fetchWowsimsDatabase(cfg.owner, cfg.repo, cfg.branch, cfg.dbPath, fetchImpl);
  const templates: BisTemplate[] = [];
  for (const spec of cfg.specs) {
    for (const set of spec.sets) {
      try {
        const res = await fetchImpl(rawUrl(cfg.owner, cfg.repo, cfg.branch, set.path));
        if (!res.ok) continue;
        const items = parseWowsimsGearSet(await res.json()).map(({ slot, itemId }) => {
          const ws = sources.get(itemId);
          return ws ? { slot, itemId, source: toSource(ws) } : { slot, itemId };
        });
        if (items.length === 0) continue;
        templates.push({
          sourceKey: source.key,
          sourceName: source.name,
          sourceUrl: source.url,
          ...(source.popularity !== undefined ? { popularity: source.popularity } : {}),
          gameVersion: version,
          classId: spec.classId,
          spec: spec.spec,
          phase: set.phase,
          label: set.label,
          items,
        });
      } catch {
        // A single bad set (404, bad JSON, network) never fails the whole import.
      }
    }
  }
  return templates;
}

/** Imports every enabled source's templates for a version and caches the result. */
export async function ingestBisTemplates(ctx: CoreContext, version: string, options: IngestOptions = {}): Promise<BisTemplate[]> {
  const fetchImpl = options.fetch ?? fetch;
  const toSource = bisSourceMapper(gameVersion(ctx, version));
  const all: BisTemplate[] = [];
  for (const source of enabledTemplateSources(version, options.enabledKeys, options.sources)) {
    if (source.adapter === "wowsims") all.push(...(await ingestWowsims(source, version, fetchImpl, toSource)));
  }
  const json = JSON.parse(JSON.stringify(all)) as Prisma.InputJsonValue;
  await ctx.prisma.staticCache.upsert({
    where: { key: cacheKey(version) },
    create: { key: cacheKey(version), data: json },
    update: { data: json, fetchedAt: new Date() },
  });
  return all;
}

/** In-flight imports per version, so a background refresh is not started twice in the same process. */
const importing = new Set<string>();

/** Imports templates in the background if the cache is cold/stale, deduping concurrent runs. Fire-and-forget. */
export function warmBisTemplates(ctx: CoreContext, version: string, options: IngestOptions = {}): void {
  if (importing.has(version)) return;
  importing.add(version);
  void ingestBisTemplates(ctx, version, options)
    .catch(() => undefined)
    .finally(() => importing.delete(version));
}

/**
 * The cached BiS templates for a version. `fetchIfMissing` defaults to false so a user request never waits on the
 * GitHub import; pass true (or run `ingestBisTemplates` on a schedule) to refresh. Returns the stale cache, or [],
 * when refreshing is off.
 */
export async function getBisTemplates(ctx: CoreContext, version: string, options: IngestOptions & { fetchIfMissing?: boolean } = {}): Promise<BisTemplate[]> {
  const row = await ctx.prisma.staticCache.findUnique({ where: { key: cacheKey(version) } });
  const fresh = row?.data && Date.now() - row.fetchedAt.getTime() < TTL_MS;
  if (fresh) return row!.data as unknown as BisTemplate[];
  if (!options.fetchIfMissing) return (row?.data as unknown as BisTemplate[]) ?? [];
  return ingestBisTemplates(ctx, version, options);
}
