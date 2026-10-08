import type { BlizzardClient } from "@wow/blizzard";
import type { GameProfile, Localized } from "@wow/config";
import { Prisma } from "@wow/db";
import { gameVersion, type CoreContext } from "./context";
import type { GameTarget } from "./static";

/**
 * BiS source index: maps an item id to the content it drops from, so a BiS list can group items by zone without a
 * per-item lookup (the Blizzard API has no reverse "where does this drop" endpoint). It is built by crawling the
 * Blizzard journal (the in-game Adventure Guide): every raid/dungeon, its bosses and their loot. Each item maps to
 * its instance name, and to a profile raid/dungeon key when the names match (so a zone can link to the profile).
 *
 * The crawl is heavy, so the index is cached for two weeks and built in the background (never on a user request).
 * Classic namespaces 404 the journal and Forever has no API, so there the index is empty (`available: false`) and
 * zones are set by hand — the "hybrid" approach.
 */

/** One item's origin, as stored in the cached index. */
export interface BisSourceEntry {
  type: "raid" | "dungeon";
  /** Display name of the instance, per locale. */
  zoneName: Localized;
  /** Profile raid/dungeon key, when the instance name matches one of the version's. */
  zoneKey?: string;
  /** Boss/encounter the item drops from. */
  bossName?: Localized;
}

export interface BisSourceIndex {
  /** Keyed by item id (as a string, since it is stored as JSON). */
  items: Record<string, BisSourceEntry>;
  /** Whether the journal answered for this version (false = Classic/Forever: auto-detection unavailable). */
  available: boolean;
}

const TTL_MS = 14 * 86_400_000;
const CONCURRENCY = 6;
const cacheKey = (target: GameTarget) => `${target.version}:${target.region.toLowerCase()}:bis-source-index`;
const englishName = (name: Localized | undefined) => (name?.en ?? Object.values(name ?? {})[0] ?? "").trim().toLowerCase();

/** In-flight builds per cache key, so a background warm-up is not started twice in the same process. */
const building = new Set<string>();

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Crawls the whole journal and builds the item -> zone index, tagging each item with the profile raid/dungeon key
 * when the instance name matches one. Returns `available: false` (empty map) when the version's journal is missing
 * (Classic namespaces 404, Forever has no API) so callers fall back to manual zones.
 */
export async function buildBisSourceIndex(client: BlizzardClient, profile: GameProfile): Promise<BisSourceIndex> {
  let instances;
  try {
    instances = await client.getJournalInstances();
  } catch {
    return { items: {}, available: false };
  }
  if (instances.length === 0) return { items: {}, available: false };

  // Match a journal instance name to a profile raid/dungeon key, so a zone can link back to the profile.
  const zoneKeyByName = new Map<string, string>();
  for (const raid of profile.raids) zoneKeyByName.set(englishName(raid.name), raid.key);
  for (const dungeon of profile.dungeons) zoneKeyByName.set(englishName(dungeon.name), dungeon.key);

  const items: Record<string, BisSourceEntry> = {};
  await mapLimit(instances, CONCURRENCY, async (ref) => {
    const instance = await client.getJournalInstance(ref.id).catch(() => undefined);
    if (!instance) return;
    const type = (instance.type ?? "").toUpperCase() === "RAID" ? "raid" : "dungeon";
    const zoneKey = zoneKeyByName.get(englishName(instance.name));
    const encounters = await mapLimit(instance.encounterIds, CONCURRENCY, (id) =>
      client.getJournalEncounter(id).catch(() => undefined),
    );
    for (const encounter of encounters) {
      if (!encounter) continue;
      for (const itemId of encounter.itemIds) {
        // First zone wins so a shared item keeps a stable source.
        if (items[itemId]) continue;
        items[itemId] = { type, zoneName: instance.name, ...(zoneKey ? { zoneKey } : {}), bossName: encounter.name };
      }
    }
  });
  return { items, available: true };
}

/**
 * The cached BiS source index for a version/region. `fetchIfMissing` defaults to false so user requests never wait
 * on the crawl; pass true (or use `warmBisSourceIndex`) to build it in the background.
 */
export async function getBisSourceIndex(
  ctx: CoreContext,
  target: GameTarget,
  options: { fetchIfMissing?: boolean } = {},
): Promise<BisSourceIndex | null> {
  const key = cacheKey(target);
  const row = await ctx.prisma.staticCache.findUnique({ where: { key } });
  const fresh = row?.data && Date.now() - row.fetchedAt.getTime() < TTL_MS;
  if (fresh) return row!.data as unknown as BisSourceIndex;
  if (!options.fetchIfMissing) return (row?.data as unknown as BisSourceIndex) ?? null;

  const profile = gameVersion(ctx, target.version);
  const index = await buildBisSourceIndex(ctx.blizzard(target.version, target.region), profile);
  const json = JSON.parse(JSON.stringify(index)) as Prisma.InputJsonValue;
  await ctx.prisma.staticCache.upsert({ where: { key }, create: { key, data: json }, update: { data: json, fetchedAt: new Date() } });
  return index;
}

/**
 * Builds the index in the background if it is cold, deduping concurrent warm-ups. Fire-and-forget: callers should
 * not await it (the crawl is slow). Does nothing for versions without an API.
 */
export function warmBisSourceIndex(ctx: CoreContext, target: GameTarget): void {
  const key = cacheKey(target);
  if (building.has(key) || !gameVersion(ctx, target.version).api.available) return;
  building.add(key);
  void getBisSourceIndex(ctx, target, { fetchIfMissing: true })
    .catch(() => undefined)
    .finally(() => building.delete(key));
}

/** Looks an item up in the index, returning a BiS `source` object (auto = true) or undefined when not found. */
export function lookupBisSource(index: BisSourceIndex | null, itemId: number) {
  const entry = index?.items[String(itemId)];
  if (!entry) return undefined;
  return { type: entry.type, zoneKey: entry.zoneKey, zoneName: entry.zoneName, bossName: entry.bossName, auto: true as const };
}
