import { describe, expect, it } from "vitest";
import { blizzardSlug, enabledRaidSizes, resolveProfile, resolveSpec } from "./index";

describe("resolveProfile", () => {
  it("loads the forever profile with only 10 and 20 player raids enabled", () => {
    const profile = resolveProfile("forever");
    expect(profile.api.hasRealms).toBe(false);
    expect(enabledRaidSizes(profile).map((r) => r.size)).toEqual([10, 20]);
    expect(profile.classes).toHaveLength(9);
  });

  it("merges retail-dev over forever by entry key", () => {
    const profile = resolveProfile("retail-dev");
    expect(profile.api.profileNamespace).toBe("profile-{region}");
    expect(profile.classes.map((c) => c.id).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(profile.raids.find((r) => r.key === "hyjal-summit")?.size).toBe(20);
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

describe("resolveSpec", () => {
  const profile = resolveProfile("retail-dev");

  it("matches by Blizzard id", () => {
    expect(resolveSpec(profile, 1, { id: 73 })?.key).toBe("protection");
  });

  it("falls back to the API name", () => {
    expect(resolveSpec(profile, 11, { name: "Feral Combat" })?.key).toBe("feral");
  });
});

describe("blizzardSlug", () => {
  it("normalizes realm names", () => {
    expect(blizzardSlug("Los Errantes")).toBe("los-errantes");
    expect(blizzardSlug("Zul'jin")).toBe("zuljin");
  });
});
