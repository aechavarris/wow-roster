import { describe, expect, it } from "vitest";
import { blizzardSlug, enabledRaidSizes, loadGameVersions, resolveProfile, resolveSpec, versionOf, withApiStandIns } from "./index";

describe("resolveProfile", () => {
  it("loads the forever profile with only 10 and 20 player raids enabled", () => {
    const profile = resolveProfile("forever");
    expect(profile.api.available).toBe(false);
    expect(enabledRaidSizes(profile).map((r) => r.size)).toEqual([10, 20]);
    expect(profile.classes).toHaveLength(9);
  });

  it("keeps each game version's own classes, raids and API", () => {
    const era = resolveProfile("classic-era");
    expect(era.api.profileNamespace).toBe("profile-classic1x-{region}");
    expect(era.classes.find((c) => c.key === "rogue")?.specs.map((s) => s.key)).toEqual(["assassination", "combat", "subtlety"]);
    expect(enabledRaidSizes(era).map((r) => r.size)).toEqual([20, 40]);

    const tbc = resolveProfile("anniversary");
    expect(tbc.api.profileNamespace).toBe("profile-classicann-{region}");
    expect(tbc.maxLevel).toBe(70);
    expect(tbc.buffs.some((b) => b.key === "commanding-shout")).toBe(true);

    const mop = resolveProfile("progression");
    expect(mop.classes.map((c) => c.key)).toContain("monk");
    expect(mop.classes.find((c) => c.key === "druid")?.specs.map((s) => s.key)).toContain("guardian");

    const retail = resolveProfile("retail");
    expect(retail.classes).toHaveLength(13);
    expect(retail.classes.find((c) => c.key === "rogue")?.specs.map((s) => s.key)).toContain("outlaw");
    expect(retail.statPanel.map((s) => s.key)).toEqual(["attributes", "enhancements"]);
  });

  it("hides retail's dungeon section only: every dungeon is run on Mythic there", () => {
    expect(resolveProfile("retail").hiddenDetails).toEqual(["dungeons"]);
    for (const id of ["forever", "classic-era", "anniversary", "progression"]) expect(resolveProfile(id).hiddenDetails).toEqual([]);
  });

  it("accepts the old retail-dev id as an alias of retail", () => {
    expect(resolveProfile("retail-dev").id).toBe("retail");
  });

  it("accepts custom profiles that extend a built-in one", () => {
    const profile = resolveProfile("custom", {
      custom: { id: "custom", extends: "forever", raidSizes: [{ size: 40, enabled: true }] },
    });
    expect(enabledRaidSizes(profile).map((r) => r.size)).toEqual([10, 20, 40]);
  });

  it("rejects circular inheritance", () => {
    expect(() =>
      resolveProfile("a", { a: { id: "a", extends: "b" }, b: { id: "b", extends: "a" } }),
    ).toThrow(/Circular/);
  });
});

describe("loadGameVersions", () => {
  const versions = loadGameVersions("retail-dev");

  it("lists every version and resolves the default through aliases", () => {
    expect(versions.list.map((v) => v.id)).toEqual(["forever", "classic-era", "anniversary", "progression", "retail"]);
    expect(versions.defaultId).toBe("retail");
  });

  it("falls back to the default version for missing or unknown ids", () => {
    expect(versionOf(versions, "anniversary").id).toBe("anniversary");
    expect(versionOf(versions, null).id).toBe("retail");
    expect(versionOf(versions, "wotlk").id).toBe("retail");
  });

  it("rejects an unknown default", () => {
    expect(() => loadGameVersions("wotlk")).toThrow(/Unknown default/);
  });
});

describe("resolveSpec", () => {
  it("matches by Blizzard id", () => {
    expect(resolveSpec(resolveProfile("retail"), 1, { id: 73 })?.key).toBe("protection");
  });

  it("falls back to the talent tree name in Classic", () => {
    expect(resolveSpec(resolveProfile("classic-era"), 11, { name: "Feral Combat" })?.key).toBe("feral");
  });

  it("does not translate between versions", () => {
    expect(resolveSpec(resolveProfile("classic-era"), 4, { name: "Outlaw" })).toBeUndefined();
    expect(resolveSpec(resolveProfile("retail"), 4, { name: "Combat" })).toBeUndefined();
  });
});

describe("blizzardSlug", () => {
  it("normalizes realm names", () => {
    expect(blizzardSlug("Los Errantes")).toBe("los-errantes");
    expect(blizzardSlug("Zul'jin")).toBe("zuljin");
  });
});

describe("professions", () => {
  it("lists each version's own professions with unique ids and keys", () => {
    const keys = (id: string) => resolveProfile(id).professions.map((p) => p.key);
    for (const id of ["forever", "classic-era", "anniversary", "progression", "retail"]) {
      const professions = resolveProfile(id).professions;
      expect(new Set(professions.map((p) => p.id)).size).toBe(professions.length);
      expect(new Set(professions.map((p) => p.key)).size).toBe(professions.length);
    }
    expect(keys("classic-era")).not.toContain("jewelcrafting");
    expect(keys("anniversary")).toContain("jewelcrafting");
    expect(keys("anniversary")).not.toContain("inscription");
    expect(keys("progression")).toEqual(expect.arrayContaining(["inscription", "archaeology", "first-aid"]));
    // First Aid was removed in Battle for Azeroth.
    expect(keys("retail")).not.toContain("first-aid");
    expect(resolveProfile("progression").professions.find((p) => p.key === "mining")?.maxSkill).toBe(600);
  });
});

describe("WoW: Forever", () => {
  it("only has the nine original classes, with Classic specs", () => {
    const forever = resolveProfile("forever");
    expect(forever.classes.map((c) => c.key).sort()).toEqual(
      ["druid", "hunter", "mage", "paladin", "priest", "rogue", "shaman", "warlock", "warrior"],
    );
    // No Death Knight (6), Monk (10), Demon Hunter (12) or Evoker (13).
    expect(forever.classes.some((c) => [6, 10, 12, 13].includes(c.id))).toBe(false);
    expect(forever.classes.find((c) => c.key === "rogue")?.specs.map((s) => s.key)).toContain("combat");
  });
});

describe("details configuration", () => {
  it("references only stat panel entries and raids that exist in each version", () => {
    for (const id of ["forever", "classic-era", "anniversary", "progression", "retail"]) {
      const profile = resolveProfile(id);
      const entries = new Set(profile.statPanel.flatMap((s) => s.entries.map((e) => e.key)));
      const used = [
        ...profile.details.resistances,
        ...profile.classes.flatMap((c) => [...(c.summaryStats ?? []), ...c.specs.flatMap((s) => s.summaryStats ?? [])]),
      ];
      expect(used.filter((key) => !entries.has(key)), id).toEqual([]);
      const raids = new Set(profile.raids.map((r) => r.key));
      expect(profile.requirements.filter((r) => r.raid && !raids.has(r.raid)).map((r) => r.key), id).toEqual([]);
      // Raids split out of a shared Warcraft Logs zone need their zone; versions reading logs map every enabled raid.
      expect(profile.raids.filter((r) => r.warcraftLogsEncounters && !r.warcraftLogsZone).map((r) => r.key), id).toEqual([]);
      // Only versions that derive raid progress from Warcraft Logs (no /encounters, no statistics) must map every
      // enabled raid to a zone; versions that read logs only for the Logs history match raids by name instead.
      const raidProgressFromLogs =
        profile.api.warcraftLogs && !profile.api.characterEndpoints.includes("raids") && !profile.api.characterEndpoints.includes("encounterStatistics");
      if (raidProgressFromLogs) {
        expect(profile.raids.filter((r) => r.enabled && !r.warcraftLogsZone).map((r) => r.key), id).toEqual([]);
      }
    }
  });

  it("gives Classic Era per-class key stats, resistances, raid reputations and attunements", () => {
    const era = resolveProfile("classic-era");
    expect(era.classes.find((c) => c.key === "mage")?.summaryStats).toEqual(["spell-hit", "spell-crit", "spell-power"]);
    expect(era.classes.find((c) => c.key === "warrior")?.specs.find((s) => s.key === "protection")?.summaryStats).toContain("defense");
    expect(era.details.resistances).toContain("fire");
    expect(era.details.keyReputations).toContain(529);
    expect(era.requirements.map((r) => r.key)).toEqual(["onyxia", "blackwing-lair", "naxxramas"]);
  });

  it("tracks only the attunements TBC Anniversary still has in phase 3", () => {
    const tbc = resolveProfile("anniversary");
    expect(tbc.classes.find((c) => c.key === "rogue")?.summaryStats).toContain("expertise");
    expect(tbc.details.keyReputations).toEqual([967, 989, 990, 1012]);
    expect(tbc.requirements.map((r) => r.key)).toEqual(["mount-hyjal", "black-temple"]);
  });
});

describe("withApiStandIns", () => {
  const versions = () => loadGameVersions("retail");

  it("lets Forever read Classic Era characters while keeping its own rules", () => {
    const tested = withApiStandIns(versions(), "forever=classic-era");
    const forever = tested.byId.get("forever")!;
    const era = tested.byId.get("classic-era")!;
    expect(forever.api).toMatchObject({ available: true, profileNamespace: era.api.profileNamespace, standIn: "classic-era" });
    expect(forever.api.warcraftLogs).toEqual(era.api.warcraftLogs);
    expect(forever.wowheadDomain).toBe(era.wowheadDomain);
    // Forever's own raids stay; Era's log-mapped raids are only there to read kills.
    expect(forever.raids.filter((r) => r.enabled).map((r) => r.key)).toEqual(versions().byId.get("forever")!.raids.filter((r) => r.enabled).map((r) => r.key));
    expect(forever.raids.find((r) => r.key === "standin-naxxramas")).toMatchObject({ enabled: false, warcraftLogsZone: 2006 });
    expect(forever.classes).toEqual(versions().byId.get("forever")!.classes);
    expect(tested.list.map((v) => v.id)).toEqual(versions().list.map((v) => v.id));
  });

  it("does nothing without a setting, never replaces a real API and refuses sources without one", () => {
    expect(withApiStandIns(versions(), "")).toEqual(versions());
    expect(withApiStandIns(versions(), "retail=classic-era").byId.get("retail")!.api.standIn).toBeUndefined();
    expect(() => withApiStandIns(versions(), "forever=nope")).toThrow();
  });
});
