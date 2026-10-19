import type { BisTemplateSource } from "@wow/config";
import { describe, expect, it, vi } from "vitest";
import type { CoreContext } from "./context";
import { getBisTemplates, ingestBisTemplates } from "./bisTemplates";

/** A fake StaticCache-backed ctx: one row kept in memory, enough for ingest + read. */
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
  return { ctx: { prisma, versions: { byId: new Map(), list: [], defaultId: "forever" } } as unknown as CoreContext, getRow: () => row };
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
      specs: [{ classId: 1, spec: "arms", sets: [{ label: "P1 BiS", phase: 1, path: "ui/warrior/gear_sets/phase_1.gear.json" }] }],
    },
  },
];

describe("ingestBisTemplates", () => {
  it("fetches each source's gear sets from GitHub raw and builds slot-mapped templates", async () => {
    const { ctx } = fakeCtx();
    const fetch = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe("https://raw.githubusercontent.com/acme/forever-sim/forever/ui/warrior/gear_sets/phase_1.gear.json");
      return new Response(JSON.stringify({ items: [{ id: 12640 }, { id: 18404 }] }));
    }) as unknown as typeof globalThis.fetch;

    const templates = await ingestBisTemplates(ctx, "forever", { fetch, sources: SOURCES });
    expect(templates).toHaveLength(1);
    expect(templates[0]).toMatchObject({
      sourceKey: "test-forever",
      sourceName: "Test Forever Sim",
      sourceUrl: "https://example.com/forever",
      popularity: 42,
      gameVersion: "forever",
      classId: 1,
      spec: "arms",
      phase: 1,
      label: "P1 BiS",
      items: [{ slot: "head", itemId: 12640 }, { slot: "neck", itemId: 18404 }],
    });
  });

  it("drops a set whose file is missing (404) without failing the import", async () => {
    const { ctx } = fakeCtx();
    const fetch = vi.fn(async () => new Response("", { status: 404 })) as unknown as typeof globalThis.fetch;
    const templates = await ingestBisTemplates(ctx, "forever", { fetch, sources: SOURCES });
    expect(templates).toEqual([]);
  });

  it("serves the cache and only re-ingests when asked", async () => {
    const { ctx } = fakeCtx();
    const fetch = vi.fn(async () => new Response(JSON.stringify({ items: [{ id: 999 }] }))) as unknown as typeof globalThis.fetch;

    // Cold cache, refresh off: nothing fetched, empty result.
    expect(await getBisTemplates(ctx, "forever", { fetch, sources: SOURCES })).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();

    // With fetchIfMissing it imports and caches; a second read serves the cache without fetching again.
    const first = await getBisTemplates(ctx, "forever", { fetch, sources: SOURCES, fetchIfMissing: true });
    expect(first).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    const second = await getBisTemplates(ctx, "forever", { fetch, sources: SOURCES });
    expect(second).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
