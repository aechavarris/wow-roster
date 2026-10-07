import { resolveProfile } from "@wow/config";
import { describe, expect, it } from "vitest";
import { vaultSlots, weekActivity, weekStart } from "./weekly";

const retail = resolveProfile("retail");

describe("weekStart", () => {
  it("goes back to the region's last weekly reset", () => {
    // Thursday 8 Oct 2026, 12:00 UTC: EU reset was Wednesday 04:00, US reset Tuesday 15:00.
    const thursday = new Date("2026-10-08T12:00:00Z");
    expect(weekStart(retail.weekly, "eu", thursday).toISOString()).toBe("2026-10-07T04:00:00.000Z");
    expect(weekStart(retail.weekly, "us", thursday).toISOString()).toBe("2026-10-06T15:00:00.000Z");
  });

  it("treats the hours before the reset as the previous week", () => {
    expect(weekStart(retail.weekly, "eu", new Date("2026-10-07T03:59:00Z")).toISOString()).toBe("2026-09-30T04:00:00.000Z");
    expect(weekStart(retail.weekly, "eu", new Date("2026-10-07T04:00:00Z")).toISOString()).toBe("2026-10-07T04:00:00.000Z");
  });

  it("falls back to Monday 00:00 UTC without rules", () => {
    expect(weekStart(undefined, "eu", new Date("2026-10-08T12:00:00Z")).toISOString()).toBe("2026-10-05T00:00:00.000Z");
  });
});

describe("weekActivity", () => {
  const start = new Date("2026-10-07T04:00:00Z");
  const kill = (name: string, at?: string) => ({ id: name.length, name: { en: name }, kills: 1, lastKillAt: at });
  const profile = {
    raids: [
      {
        id: 1273,
        name: { en: "Nerub-ar Palace" },
        modes: [
          { difficulty: "HEROIC", completed: 3, total: 8, encounters: [kill("Ulgrax", "2026-10-07T20:00:00Z"), kill("Bloodbound", "2026-10-08T20:00:00Z"), kill("Sikran", "2026-10-01T20:00:00Z")] },
          { difficulty: "MYTHIC", completed: 1, total: 8, encounters: [kill("Ulgrax", "2026-10-02T20:00:00Z")] },
        ],
      },
    ],
    mythicPlus: {
      weeklyRuns: [
        { dungeon: { en: "Ara-Kara" }, level: 12, timed: true, completedAt: "2026-10-07T18:00:00Z" },
        // Last week's period, still in a profile not refreshed since the reset.
        { dungeon: { en: "The Rookery" }, level: 10, timed: true, completedAt: "2026-10-06T18:00:00Z" },
      ],
    },
  };

  it("only counts bosses and runs after the reset", () => {
    const week = weekActivity(profile, start);
    expect(week.raids).toEqual([{ instanceId: 1273, name: { en: "Nerub-ar Palace" }, difficulty: "HEROIC", difficultyName: undefined, bosses: [{ id: 6, name: { en: "Ulgrax" } }, { id: 10, name: { en: "Bloodbound" } }] }]);
    expect(week.mythicPlus.map((r) => r.level)).toEqual([12]);
    expect(week.dungeons).toEqual([]);
    expect(weekActivity(null, start)).toEqual({ raids: [], dungeons: [], mythicPlus: [] });
  });

  it("counts Great Vault slots where the version has a vault", () => {
    const week = weekActivity(profile, start);
    expect(vaultSlots(retail.weekly, week)).toEqual({ raid: 1, dungeons: 1, bosses: 2, runs: 1 });
    expect(vaultSlots(resolveProfile("classic-era").weekly, week)).toBeNull();
  });
});
