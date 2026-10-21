import type { BisTemplateSource, GameProfile } from "@wow/config";
import { describe, expect, it, vi } from "vitest";
import type { CoreContext } from "./context";
import { getBisTemplates, ingestBisTemplates } from "./bisTemplates";

/** A stub profile with just the raids/dungeons the source mapper needs to tie a drop's zone to a version key. */
const FOREVER = {
  raids: [{ key: "barrow-deeps", name: { en: "Barrow Deeps" } }],
  dungeons: [{ key: "shadowfang", name: { en: "Shadowfang Keep" } }],
} as unknown as GameProfile;

/** A fake StaticCache-backed ctx: one row kept in memory, plus the stub profile for `forever`. */
function fakeCtx() {
  let row: { data: unknown; fetchedAt: Date } | undefined;
  const prisma = {
    staticCache: {
      findUnique: async () => (row ? { ...row } : null),
      upsert: async ({ create, update }: { create?: { data: unknown }; update?: { data: unknown } }) => {
        row = { data: (update?.data ?? create?.data) as unknown, fetchedAt: new Date() };
        return row;
      },
    },
  };
  const versions = { byId: new Map([["forever", FOREVER]]), list: [FOREVER], defaultId: "forever" };
  return { ctx: { prisma, versions } as unknown as CoreContext, getRow: () => row };
}

const SOURCES: BisTemplateSource[] = [
  {
    key: "test-forever",
    name: "Test Forever Sim",
    url: "https://example.com/forever",
    adapter: "wowsims",
    enabled: true,
    gameVersions: ["forever"],
    popularity: 42,
    wowsims: {
      owner: "acme",
      repo: "forever-sim",
      branch: "forever",
      dbPath: "assets/database/db.json",
      specs: [{ classId: 1, spec: "arms", sets: [{ label: "P1 BiS", phase: 1, path: "ui/warrior/gear_sets/phase_1.gear.json" }] }],
    },
  },
];

const DB_URL = "https://raw.githubusercontent.com/acme/forever-sim/forever/assets/database/db.json";
const GEAR_URL = "https://raw.githubusercontent.com/acme/forever-sim/forever/ui/warrior/gear_sets/phase_1.gear.json";

// A tiny item database covering each case: a drop in a profile raid, in a known raid not in the profile, in a
// dungeon not in the profile, a crafted item, and one with no source.
const DB = {
  items: [
    { id: 12640, sources: [{ drop: { npcId: 11583, zoneId: 2159, difficulty: 1 } }] }, // profile raid
    { id: 500, sources: [{ drop: { npcId: 2000, zoneId: 3000, difficulty: 1 } }] }, // known raid, not in profile
    { id: 600, sources: [{ drop: { npcId: 3000, zoneId: 4000, difficulty: 1 } }] }, // dungeon, not in profile
    { id: 18404, sources: [{ crafted: { profession: 8, spellId: 1 } }] },
    { id: 777, sources: [] },
  ],
  zones: [
    { id: 2159, name: "Barrow Deeps" },
    { id: 3000, name: "Molten Core" },
    { id: 4000, name: "Scholomance" },
  ],
  npcs: [
    { id: 11583, name: "Lord Victor Nefarius" },
    { id: 2000, name: "Ragnaros" },
    { id: 3000, name: "Darkmaster Gandling" },
  ],
};

/** Routes the db.json and gear-set URLs; anything else is a 404. */
const routeFetch = (gear: unknown, db: unknown = DB) =>
  vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    if (u === DB_URL) return new Response(JSON.stringify(db));
    if (u === GEAR_URL) return new Response(JSON.stringify(gear));
    return new Response("", { status: 404 });
  }) as unknown as typeof globalThis.fetch;

describe("ingestBisTemplates", () => {
  it("builds slot-mapped templates and shows each item's origin, registered in the profile or not", async () => {
    const { ctx } = fakeCtx();
    const fetch = routeFetch({ items: [{ id: 12640 }, { id: 500 }, { id: 600 }, { id: 18404 }] });

    const templates = await ingestBisTemplates(ctx, "forever", { fetch, sources: SOURCES });
    expect(templates).toHaveLength(1);
    expect(templates[0]).toMatchObject({
      sourceKey: "test-forever",
      popularity: 42,
      gameVersion: "forever",
      classId: 1,
      spec: "arms",
      phase: 1,
      label: "P1 BiS",
      items: [
        // A drop whose zone names a profile raid is tied to that key, with the boss as the detail.
        { slot: "head", itemId: 12640, source: { type: "raid", zoneKey: "barrow-deeps", bossName: { en: "Lord Victor Nefarius" }, auto: true } },
        // A known raid not in the profile: typed raid, instance name kept as free text (no key).
        { slot: "neck", itemId: 500, source: { type: "raid", zoneName: { en: "Molten Core" }, bossName: { en: "Ragnaros" }, auto: true } },
        // Any other named instance is a dungeon, instance name kept.
        { slot: "shoulder", itemId: 600, source: { type: "dungeon", zoneName: { en: "Scholomance" }, bossName: { en: "Darkmaster Gandling" }, auto: true } },
        { slot: "back", itemId: 18404, source: { type: "crafted", auto: true } },
      ],
    });
    // Normal difficulty (1) is not tagged, so no difficulty field is set.
    expect(templates[0]!.items[0]!.source).not.toHaveProperty("difficulty");
  });

  it("leaves items unsourced when the item has no known source", async () => {
    const { ctx } = fakeCtx();
    const fetch = routeFetch({ items: [{ id: 777 }] });
    const templates = await ingestBisTemplates(ctx, "forever", { fetch, sources: SOURCES });
    expect(templates[0]!.items).toEqual([{ slot: "head", itemId: 777 }]);
  });

  it("still imports gear sets when the source database is missing (404)", async () => {
    const { ctx } = fakeCtx();
    // db.json 404s here (routeFetch only answers DB_URL when db is provided); items stay unsourced.
    const fetch = vi.fn(async (url: string | URL | Request) =>
      String(url) === GEAR_URL ? new Response(JSON.stringify({ items: [{ id: 12640 }] })) : new Response("", { status: 404 }),
    ) as unknown as typeof globalThis.fetch;
    const templates = await ingestBisTemplates(ctx, "forever", { fetch, sources: SOURCES });
    expect(templates[0]!.items).toEqual([{ slot: "head", itemId: 12640 }]);
  });

  it("drops a set whose file is missing (404) without failing the import", async () => {
    const { ctx } = fakeCtx();
    const fetch = vi.fn(async () => new Response("", { status: 404 })) as unknown as typeof globalThis.fetch;
    const templates = await ingestBisTemplates(ctx, "forever", { fetch, sources: SOURCES });
    expect(templates).toEqual([]);
  });

  it("serves the cache and only re-ingests when asked", async () => {
    const { ctx } = fakeCtx();
    const fetch = routeFetch({ items: [{ id: 12640 }] });

    // Cold cache, refresh off: nothing fetched, empty result.
    expect(await getBisTemplates(ctx, "forever", { fetch, sources: SOURCES })).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();

    // With fetchIfMissing it imports and caches; a second read serves the cache without fetching again.
    const first = await getBisTemplates(ctx, "forever", { fetch, sources: SOURCES, fetchIfMissing: true });
    expect(first).toHaveLength(1);
    const calls = (fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    const second = await getBisTemplates(ctx, "forever", { fetch, sources: SOURCES });
    expect(second).toHaveLength(1);
    expect((fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(calls);
  });
});
