import { describe, expect, it } from "vitest";
import { armorTypeId, isArmorTypeSlot, itemTypeIds, slotTypeFilter } from "./items";
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
});
