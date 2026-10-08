import type { WarcraftLogsProfile } from "@wow/blizzard";
import { resolveProfile } from "@wow/config";
import { describe, expect, it } from "vitest";
import { WARCRAFT_LOGS_TTL_MS, instancesFromWarcraftLogs, warcraftLogsStale } from "./warcraftLogs";

const kill = (zoneId: number, encounterId: number, name: string, killedAt: string) => ({ report: "r", zoneId, encounterId, name, killedAt });

describe("instancesFromWarcraftLogs", () => {
  it("groups kills by raid zone, counting kills and keeping the last one", () => {
    const logs: WarcraftLogsProfile = {
      url: "u",
      fetchedAt: "2026-10-08T00:00:00.000Z",
      kills: [
        kill(2006, 51118, "Patchwerk", "2026-09-30T20:00:00.000Z"),
        kill(2006, 51118, "Patchwerk", "2026-10-07T20:00:00.000Z"),
        kill(2000, 663, "Lucifron", "2026-10-07T19:00:00.000Z"),
        // A Season of Discovery zone the version does not have.
        kill(2017, 201118, "Patchwerk", "2026-10-07T21:00:00.000Z"),
      ],
    };
    const raids = instancesFromWarcraftLogs(resolveProfile("classic-era"), logs);
    expect(raids.map((r) => r.name.en)).toEqual(["Molten Core", "Naxxramas"]);
    expect(raids[1]!.modes[0]).toMatchObject({
      difficulty: "NORMAL",
      difficultyName: { en: "40-player", es: "40 j." },
      completed: 1,
      total: 15,
      encounters: [{ id: 51118, name: { en: "Patchwerk" }, kills: 2, lastKillAt: "2026-10-07T20:00:00.000Z" }],
    });
  });

  it("splits Warcraft Logs zones that hold two raids by their encounters", () => {
    const logs: WarcraftLogsProfile = {
      url: "u",
      fetchedAt: "2026-10-08T00:00:00.000Z",
      kills: [kill(1011, 601, "High Warlord Naj'entus", "2026-10-07T20:00:00.000Z"), kill(1011, 618, "Rage Winterchill", "2026-10-07T19:00:00.000Z")],
    };
    const raids = instancesFromWarcraftLogs(resolveProfile("anniversary"), logs);
    expect(raids.map((r) => [r.name.en, r.modes[0]!.encounters.map((e) => e.name.en)])).toEqual([
      ["Battle for Mount Hyjal", ["Rage Winterchill"]],
      ["Black Temple", ["High Warlord Naj'entus"]],
    ]);
  });
});

describe("warcraftLogsStale", () => {
  it("refetches missing or old kills only", () => {
    const now = Date.parse("2026-10-08T12:00:00.000Z");
    const at = (ms: number) => ({ warcraftLogs: { url: "u", fetchedAt: new Date(now - ms).toISOString(), kills: [] } });
    expect(warcraftLogsStale(null, now)).toBe(true);
    expect(warcraftLogsStale({}, now)).toBe(true);
    expect(warcraftLogsStale(at(60_000), now)).toBe(false);
    expect(warcraftLogsStale(at(WARCRAFT_LOGS_TTL_MS + 1), now)).toBe(true);
  });
});
