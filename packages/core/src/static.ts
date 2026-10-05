import type { CharacterProfile, TalentTreeLayout } from "@wow/blizzard";
import { Prisma } from "@wow/db";
import type { CoreContext } from "./context";

/** Static game data only changes with patches; refetch after two weeks. */
const TTL_MS = 14 * 86_400_000;
/** Parallel media requests; Blizzard allows 100/s, the worker's character limiter keeps the hourly budget. */
const CONCURRENCY = 8;

type IconKind = "item" | "spell" | "profession";

/** Where static data comes from: a game version's API in a region. */
export interface GameTarget {
  version: string;
  region: string;
}

const cacheKey = (target: GameTarget, ...parts: (string | number)[]) =>
  [target.version, target.region.toLowerCase(), ...parts].join(":");

const isFresh = (fetchedAt: Date) => Date.now() - fetchedAt.getTime() < TTL_MS;

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

async function store(ctx: CoreContext, key: string, data: unknown) {
  // Round-trip through JSON to drop undefined values; a missing value is stored as SQL NULL.
  const json = data === undefined ? Prisma.DbNull : (JSON.parse(JSON.stringify(data)) as Prisma.InputJsonValue);
  await ctx.prisma.staticCache.upsert({
    where: { key },
    create: { key, data: json },
    update: { data: json, fetchedAt: new Date() },
  });
}

/** Icon URLs by id, fetched once per game version and region. Ids without media are remembered as missing. */
export async function getIcons(ctx: CoreContext, target: GameTarget, kind: IconKind, ids: number[]): Promise<Map<number, string>> {
  const unique = [...new Set(ids.filter((id) => Number.isFinite(id)))];
  const icons = new Map<number, string>();
  if (unique.length === 0) return icons;

  const keyOf = (id: number) => cacheKey(target, "icon", kind, id);
  const rows = await ctx.prisma.staticCache.findMany({ where: { key: { in: unique.map(keyOf) } } });
  const cached = new Map(rows.map((r) => [r.key, r]));
  const missing: number[] = [];
  for (const id of unique) {
    const row = cached.get(keyOf(id));
    if (row && isFresh(row.fetchedAt)) {
      if (typeof row.data === "string") icons.set(id, row.data);
    } else missing.push(id);
  }

  const client = ctx.blizzard(target.version, target.region);
  await mapLimit(missing, CONCURRENCY, async (id) => {
    const icon = await client.getIcon(kind, id);
    await store(ctx, keyOf(id), icon);
    if (icon) icons.set(id, icon);
  });
  return icons;
}

/** Retail talent tree layout for a spec, with spell icons on every option; cached per game version and region. */
export async function getTalentTree(
  ctx: CoreContext,
  target: GameTarget,
  treeId: number,
  specId: number,
  options: { fetchIfMissing?: boolean } = {},
): Promise<TalentTreeLayout | null> {
  const key = cacheKey(target, "talent-tree", treeId, specId);
  const row = await ctx.prisma.staticCache.findUnique({ where: { key } });
  if (row?.data && isFresh(row.fetchedAt)) return row.data as unknown as TalentTreeLayout;
  if (options.fetchIfMissing === false) return (row?.data as unknown as TalentTreeLayout) ?? null;

  const layout = await ctx.blizzard(target.version, target.region).getTalentTree(treeId, specId);
  const allNodes = [...layout.classNodes, ...layout.specNodes, ...layout.heroTrees.flatMap((h) => h.nodes)];
  const spellIds = allNodes.flatMap((n) => n.options.flatMap((o) => (o.spellId ? [o.spellId] : [])));
  const icons = await getIcons(ctx, target, "spell", spellIds);
  for (const node of allNodes) {
    for (const option of node.options) if (option.spellId) option.icon = icons.get(option.spellId);
  }
  await store(ctx, key, layout);
  return layout;
}

/**
 * Adds icons to a freshly fetched character profile and warms the talent tree cache
 * for its loadouts. Failures only cost the visuals, never the sync itself.
 */
export async function enrichProfile(ctx: CoreContext, target: GameTarget, profile: CharacterProfile): Promise<void> {
  const tasks: Promise<unknown>[] = [];
  const equipment = profile.equipment ?? [];
  tasks.push(
    getIcons(ctx, target, "item", [
      ...equipment.map((i) => i.itemId),
      ...equipment.flatMap((i) => i.gems.flatMap((g) => (g.itemId ? [g.itemId] : []))),
    ]).then((icons) => {
      for (const item of equipment) {
        item.icon = icons.get(item.itemId);
        for (const gem of item.gems) if (gem.itemId) gem.icon = icons.get(gem.itemId);
      }
    }),
  );
  const professions = profile.professions ?? [];
  tasks.push(
    getIcons(ctx, target, "profession", professions.map((p) => p.id)).then((icons) => {
      for (const p of professions) p.icon = icons.get(p.id);
    }),
  );
  for (const setup of profile.talents ?? []) {
    if (setup.treeId && setup.specId) tasks.push(getTalentTree(ctx, target, setup.treeId, setup.specId));
  }

  const results = await Promise.allSettled(tasks);
  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) profile.missing.media_static = `${failed}_failed`;
}
