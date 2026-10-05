import { describe, expect, it } from "vitest";
import { blizzardSlug, enabledRaidSizes, loadGameVersions, resolveProfile, resolveSpec, versionOf } from "./index";

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
