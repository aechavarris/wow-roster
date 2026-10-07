import { describe, expect, it } from "vitest";
import { RaiderIoClient, RaiderIoError, normalizeRaiderIo } from "./raiderio";

/** Trimmed from a real /characters/profile response (eu, Sanguino, October 2026). */
const PROFILE = {
  name: "Dracatxi",
  profile_url: "https://raider.io/characters/eu/sanguino/Dracatxi",
  mythic_plus_scores_by_season: [{ season: "season-mn-2", scores: { all: 2687.1 }, segments: { all: { score: 2687.1, color: "#589dad" } } }],
  mythic_plus_recent_runs: [
    { dungeon: "Voidscar Arena", short_name: "VSA", mythic_level: 10, completed_at: "2026-09-28T16:14:51.000Z", num_keystone_upgrades: 2, score: 331.5 },
    { dungeon: "The Blinding Vale", short_name: "BV", mythic_level: 12, completed_at: "2026-09-15T15:43:16.000Z", num_keystone_upgrades: 0, score: 316.5 },
  ],
  mythic_plus_best_runs: [{ dungeon: "Kings' Rest", mythic_level: 10, num_keystone_upgrades: 1, score: 327.4, url: "https://raider.io/mythic-plus-runs/x" }],
  mythic_plus_weekly_highest_level_runs: [],
};

describe("normalizeRaiderIo", () => {
  it("keeps the season score and every run, depleted keys as not timed", () => {
    const rio = normalizeRaiderIo(PROFILE);
    expect(rio).toMatchObject({ season: "season-mn-2", score: 2687.1, color: "#589dad", profileUrl: PROFILE.profile_url, weeklyRuns: [] });
    expect(rio.recentRuns.map((r) => [r.dungeon, r.level, r.timed, r.upgrades])).toEqual([
      ["Voidscar Arena", 10, true, 2],
      ["The Blinding Vale", 12, false, 0],
    ]);
    expect(rio.bestRuns[0]).toMatchObject({ dungeon: "Kings' Rest", level: 10, timed: true, score: 327.4 });
    expect(normalizeRaiderIo({})).toEqual({ profileUrl: undefined, season: undefined, score: undefined, color: undefined, weeklyRuns: [], recentRuns: [], bestRuns: [] });
  });
});

describe("RaiderIoClient", () => {
  it("asks for the Mythic+ fields of one character", async () => {
    const urls: URL[] = [];
    const client = new RaiderIoClient({
      fetch: (async (input: string | URL) => {
        urls.push(new URL(input.toString()));
        return Response.json(PROFILE);
      }) as typeof fetch,
    });
    const rio = await client.getProfile("EU", "sanguino", "Dracatxi");
    expect(rio.score).toBe(2687.1);
    expect(urls[0]!.pathname).toBe("/api/v1/characters/profile");
    expect(Object.fromEntries(urls[0]!.searchParams)).toMatchObject({ region: "eu", realm: "sanguino", name: "Dracatxi" });
    expect(urls[0]!.searchParams.get("fields")).toContain("mythic_plus_weekly_highest_level_runs");
  });

  it("reports unknown characters as not found", async () => {
    const client = new RaiderIoClient({ fetch: (async () => new Response(null, { status: 400 })) as unknown as typeof fetch });
    const error = await client.getProfile("eu", "sanguino", "Nobody").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RaiderIoError);
    expect((error as RaiderIoError).notFound).toBe(true);
  });
});
