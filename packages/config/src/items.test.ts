import { describe, expect, it } from "vitest";
import { SECONDARY_STATS, armorTypeId, isArmorTypeSlot, itemHasSecondary, itemPrimaryStats, itemTypeIds, slotTypeFilter } from "./items";
import { resolveProfile } from "./profile";

describe("item type filters", () => {
  it("offers armour types for armour slots and weapon types for weapon slots, nothing for the rest", () => {
    expect(slotTypeFilter("chest")?.itemClassId).toBe(4);
    expect(slotTypeFilter("chest")?.options.map((o) => o.key)).toContain("plate");
    expect(slotTypeFilter("mainHand")?.itemClassId).toBe(2);
    expect(slotTypeFilter("mainHand")?.options.map((o) => o.key)).toContain("sword1h");
    expect(slotTypeFilter("neck")).toBeNull();
    expect(slotTypeFilter("finger")).toBeNull();
  });

  it("resolves a type key to item_class/item_subclass ids for the slot", () => {
    expect(itemTypeIds("chest", "plate")).toEqual({ itemClassId: 4, itemSubclassId: 4 });
    expect(itemTypeIds("mainHand", "dagger")).toEqual({ itemClassId: 2, itemSubclassId: 15 });
    // A type that does not belong to the slot (weapon type on an armour slot) resolves to nothing.
    expect(itemTypeIds("chest", "dagger")).toBeNull();
    expect(itemTypeIds("chest", undefined)).toBeNull();
  });

  it("maps armour type keys to subclass ids and marks armour-type slots", () => {
    expect(armorTypeId("mail")).toBe(3);
    expect(armorTypeId(undefined)).toBeUndefined();
    expect(isArmorTypeSlot("legs")).toBe(true);
    expect(isArmorTypeSlot("mainHand")).toBe(false);
  });

  it("every retail class has an armour type, Classic classes do not", () => {
    expect(resolveProfile("retail").classes.every((c) => c.armorType)).toBe(true);
    expect(resolveProfile("classic-era").classes.some((c) => c.armorType)).toBe(false);
  });

  it("reads the primary stats an item grants from its stat codes, handling the flexible primary", () => {
    expect([...itemPrimaryStats(["INTELLECT", "HASTE_RATING"])]).toEqual(["intellect"]);
    expect([...itemPrimaryStats(["STRENGTH", "CRIT_RATING"])]).toEqual(["strength"]);
    // A ring with only secondary stats grants no primary, so it is never hidden by the class filter.
    expect(itemPrimaryStats(["CRIT_RATING", "HASTE_RATING"]).size).toBe(0);
    // A flexible primary (STR_AGI_INT) matches every class.
    expect([...itemPrimaryStats(["STR_AGI_INT"])].sort()).toEqual(["agility", "intellect", "strength"]);
  });

  it("matches a secondary stat by its code regardless of the exact spelling", () => {
    expect(itemHasSecondary(["INTELLECT", "HASTE_RATING"], "haste")).toBe(true);
    expect(itemHasSecondary(["INTELLECT", "HASTE_RATING"], "crit")).toBe(false);
    expect(itemHasSecondary([], "haste")).toBe(false);
  });

  it("every spec of every modelled version has a primary stat and only known secondary-stat keys", () => {
    const keys = new Set(SECONDARY_STATS.map((s) => s.key));
    for (const id of ["retail", "progression", "anniversary", "classic-era", "forever"]) {
      const profile = resolveProfile(id);
      expect(profile.classes.flatMap((c) => c.specs).every((s) => s.primaryStat), `${id} specs`).toBe(true);
      expect(profile.secondaryStats.every((k) => keys.has(k)), `${id} secondaryStats`).toBe(true);
    }
    // Retail and MoP model secondary stats; TBC a smaller set; Vanilla has no rating-based secondaries.
    expect(resolveProfile("retail").secondaryStats).toContain("versatility");
    expect(resolveProfile("progression").secondaryStats).toContain("mastery");
    expect(resolveProfile("classic-era").secondaryStats).toEqual([]);
  });
});
