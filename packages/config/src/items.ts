import type { Localized } from "./schema";

/**
 * Item class/subclass constants and the per-slot type filters for the BiS item picker. IDs are Blizzard's stable
 * item_class / item_subclass ids (verified against Wowpedia/TrinityCore): the Blizzard item search filters by
 * `item_class.id` and `item_subclass.id`, so these drive both the "by armour/weapon type" filter and hiding items
 * a class cannot wear (its armour type).
 */

export const ITEM_CLASS = { weapon: 2, armor: 4 } as const;

/** Armour subclasses a class can be restricted to, and that armour slots filter by. */
export interface ItemSubtype {
  key: string;
  /** Blizzard item_subclass id. */
  id: number;
  name: Localized;
}

export const ARMOR_TYPES: ItemSubtype[] = [
  { key: "cloth", id: 1, name: { en: "Cloth", es: "Tela" } },
  { key: "leather", id: 2, name: { en: "Leather", es: "Cuero" } },
  { key: "mail", id: 3, name: { en: "Mail", es: "Malla" } },
  { key: "plate", id: 4, name: { en: "Plate", es: "Placas" } },
];
const ARMOR_BY_KEY = new Map(ARMOR_TYPES.map((t) => [t.key, t]));
/** The armour subclass id for an armour type key (cloth/leather/mail/plate), for the item search filter. */
export const armorTypeId = (key: string | undefined | null) => (key ? ARMOR_BY_KEY.get(key)?.id : undefined);

/** Weapon subclasses offered for weapon slots. */
export const WEAPON_TYPES: ItemSubtype[] = [
  { key: "axe1h", id: 0, name: { en: "One-Handed Axe", es: "Hacha de una mano" } },
  { key: "axe2h", id: 1, name: { en: "Two-Handed Axe", es: "Hacha de dos manos" } },
  { key: "mace1h", id: 4, name: { en: "One-Handed Mace", es: "Maza de una mano" } },
  { key: "mace2h", id: 5, name: { en: "Two-Handed Mace", es: "Maza de dos manos" } },
  { key: "sword1h", id: 7, name: { en: "One-Handed Sword", es: "Espada de una mano" } },
  { key: "sword2h", id: 8, name: { en: "Two-Handed Sword", es: "Espada de dos manos" } },
  { key: "dagger", id: 15, name: { en: "Dagger", es: "Daga" } },
  { key: "fist", id: 13, name: { en: "Fist Weapon", es: "Arma de puño" } },
  { key: "polearm", id: 6, name: { en: "Polearm", es: "Arma de asta" } },
  { key: "staff", id: 10, name: { en: "Staff", es: "Bastón" } },
  { key: "bow", id: 2, name: { en: "Bow", es: "Arco" } },
  { key: "crossbow", id: 18, name: { en: "Crossbow", es: "Ballesta" } },
  { key: "gun", id: 3, name: { en: "Gun", es: "Arma de fuego" } },
  { key: "wand", id: 19, name: { en: "Wand", es: "Varita" } },
  { key: "thrown", id: 16, name: { en: "Thrown", es: "Arrojadiza" } },
];

/** Slots whose items are "real" armour (filterable by armour type and restricted to a class's type). */
const ARMOR_TYPE_SLOTS = new Set(["head", "shoulder", "chest", "wrist", "hands", "waist", "legs", "feet"]);
const WEAPON_SLOTS = new Set(["mainHand", "offHand", "ranged"]);

export const isArmorTypeSlot = (slot: string) => ARMOR_TYPE_SLOTS.has(slot);

/**
 * The type filter a slot offers: armour types for armour slots, weapon types for weapon slots, or null for slots
 * with no meaningful type (neck, back, finger, trinket). `itemClassId` is passed to the item search alongside the
 * chosen subtype id.
 */
export function slotTypeFilter(slot: string): { itemClassId: number; options: ItemSubtype[] } | null {
  if (ARMOR_TYPE_SLOTS.has(slot)) return { itemClassId: ITEM_CLASS.armor, options: ARMOR_TYPES };
  if (WEAPON_SLOTS.has(slot)) return { itemClassId: ITEM_CLASS.weapon, options: WEAPON_TYPES };
  return null;
}

/** Resolves a type key (armour or weapon) for a slot to the item_class/item_subclass ids the search filters by. */
export function itemTypeIds(slot: string, typeKey: string | undefined | null): { itemClassId: number; itemSubclassId: number } | null {
  if (!typeKey) return null;
  const filter = slotTypeFilter(slot);
  const match = filter?.options.find((o) => o.key === typeKey);
  return filter && match ? { itemClassId: filter.itemClassId, itemSubclassId: match.id } : null;
}
