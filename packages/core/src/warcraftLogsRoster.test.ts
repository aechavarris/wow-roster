import type { WarcraftLogsProfile } from "@wow/blizzard";
import { resolveProfile } from "@wow/config";
import { describe, expect, it } from "vitest";
import { buildRosterLogs, type RosterLogCharacter } from "./warcraftLogs";

const era = resolveProfile("classic-era");

const wcl = (kills: WarcraftLogsProfile["kills"]): WarcraftLogsProfile => ({ url: "https://vanilla.warcraftlogs.com/character/eu/x/y", fetchedAt: new Date().toISOString(), kills });

describe("buildRosterLogs", () => {
  it("groups kills into reports, lists every roster member in each and tells raids from dungeons", () => {
    const characters: RosterLogCharacter[] = [
      {
        characterId: "c1",
        name: "Thrall",
        classId: 7,
        warcraftLogs: wcl([
          { report: "ABC", zoneId: 2000, zoneName: { en: "Molten Core" }, encounterId: 663, name: "Lucifron", killedAt: "2026-10-01T20:10:00.000Z" },
          { report: "ABC", zoneId: 2000, zoneName: { en: "Molten Core" }, encounterId: 664, name: "Magmadar", killedAt: "2026-10-01T20:40:00.000Z" },
          { report: "ZZZ", zoneId: 9999, zoneName: { en: "Deadmines" }, encounterId: 1, name: "VanCleef", killedAt: "2026-10-03T19:00:00.000Z" },
        ]),
      },
      {
        characterId: "c2",
        name: "Garrosh",
        classId: 1,
        // Same raid report as Thrall, plus one boss Thrall also killed (deduped, latest kept).
        warcraftLogs: wcl([
          { report: "ABC", zoneId: 2000, zoneName: { en: "Molten Core" }, encounterId: 663, name: "Lucifron", killedAt: "2026-10-01T20:12:00.000Z" },
        ]),
      },
    ];

    const logs = buildRosterLogs(era, characters, "vanilla.warcraftlogs.com");
    expect(logs.map((l) => l.report)).toEqual(["ZZZ", "ABC"]); // newest first

    const mc = logs.find((l) => l.report === "ABC")!;
    expect(mc).toMatchObject({ type: "raid", zoneKey: "molten-core", url: "https://vanilla.warcraftlogs.com/reports/ABC", date: "2026-10-01T20:10:00.000Z" });
    expect(mc.zoneName.en).toBe("Molten Core"); // the profile raid name (localized), not just the WCL string
    expect(mc.members.map((m) => m.characterId).sort()).toEqual(["c1", "c2"]);
    expect(mc.bosses).toHaveLength(2);
    // The shared boss keeps the latest kill time.
    expect(mc.bosses.find((b) => b.encounterId === 663)!.killedAt).toBe("2026-10-01T20:12:00.000Z");

    const dm = logs.find((l) => l.report === "ZZZ")!;
    expect(dm).toMatchObject({ type: "dungeon", zoneName: { en: "Deadmines" } });
    expect(dm.zoneKey).toBeUndefined();
    expect(dm.members.map((m) => m.name)).toEqual(["Thrall"]);
  });

  it("returns nothing when no character has logs", () => {
    expect(buildRosterLogs(era, [{ characterId: "c1", name: "A", classId: 1, warcraftLogs: null }], "vanilla.warcraftlogs.com")).toEqual([]);
  });
});
