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

/**
 * The item_class ids the Blizzard item search must query to cover a slot, when no explicit type or class-armour
 * restriction already pins one. Off hand and ranged span two classes — a weapon (one-hander, bow/gun/wand/thrown)
 * and armour (a shield or held-in-off-hand for the off hand; a relic for ranged) — so each needs both queries, or
 * the armour half (shields!) is dropped. Single-class slots return their one class; neck/back/finger/trinket have
 * no meaningful class filter and return an empty list so the search stays unfiltered and the slot filter selects.
 */
export function slotSearchClasses(slot: string): number[] {
  if (ARMOR_TYPE_SLOTS.has(slot)) return [ITEM_CLASS.armor];
  if (slot === "mainHand") return [ITEM_CLASS.weapon];
  if (slot === "offHand" || slot === "ranged") return [ITEM_CLASS.weapon, ITEM_CLASS.armor];
  return [];
}

/** Resolves a type key (armour or weapon) for a slot to the item_class/item_subclass ids the search filters by. */
export function itemTypeIds(slot: string, typeKey: string | undefined | null): { itemClassId: number; itemSubclassId: number } | null {
  if (!typeKey) return null;
  const filter = slotTypeFilter(slot);
  const match = filter?.options.find((o) => o.key === typeKey);
  return filter && match ? { itemClassId: filter.itemClassId, itemSubclassId: match.id } : null;
}

/**
 * Item stats, used to filter the BiS picker by what a class/spec actually wants. The Blizzard item document's
 * `preview_item.stats[].type.type` is an upper-case enum (e.g. INTELLECT, CRIT_RATING, STR_AGI_INT for the
 * flexible primary). We match by substring so the exact spelling of combined codes does not matter.
 */

export type PrimaryStat = "strength" | "agility" | "intellect";

/** Substring found in the stat code for each primary. A flexible "STR_AGI_INT" code matches several. */
const PRIMARY_TOKENS: Record<PrimaryStat, string> = { strength: "STR", agility: "AGI", intellect: "INT" };

/** The primary stats an item grants, read from its stat type codes (empty for rings, necks and most trinkets). */
export function itemPrimaryStats(statCodes: readonly string[]): Set<PrimaryStat> {
  const out = new Set<PrimaryStat>();
  for (const code of statCodes) {
    const upper = code.toUpperCase();
    for (const [stat, token] of Object.entries(PRIMARY_TOKENS)) if (upper.includes(token)) out.add(stat as PrimaryStat);
  }
  return out;
}

/** A secondary stat offered as an item-search filter; `token` is matched against the item's stat codes. */
export interface SecondaryStat {
  key: string;
  token: string;
  name: Localized;
}

/**
 * Secondary stats the picker can filter by; a profile's `secondaryStats` lists which keys apply to that version
 * (modern four for retail, the Cata/MoP set plus hit/expertise/spirit for MoP Classic, hit/crit/haste for TBC).
 * `token` is matched as a substring against the item's stat codes, so split codes (CRIT_MELEE_RATING…) still hit.
 */
export const SECONDARY_STATS: SecondaryStat[] = [
  { key: "crit", token: "CRIT", name: { en: "Critical Strike", es: "Golpe crítico" } },
  { key: "haste", token: "HASTE", name: { en: "Haste", es: "Celeridad" } },
  { key: "mastery", token: "MASTERY", name: { en: "Mastery", es: "Maestría" } },
  { key: "versatility", token: "VERSATILITY", name: { en: "Versatility", es: "Versatilidad" } },
  { key: "hit", token: "HIT", name: { en: "Hit", es: "Acierto" } },
  { key: "expertise", token: "EXPERTISE", name: { en: "Expertise", es: "Pericia" } },
  { key: "spirit", token: "SPIRIT", name: { en: "Spirit", es: "Espíritu" } },
];
const SECONDARY_BY_KEY = new Map(SECONDARY_STATS.map((s) => [s.key, s]));

/** Whether an item's stat codes include the given secondary stat. Unknown or statless items read as false. */
export function itemHasSecondary(statCodes: readonly string[], secondaryKey: string): boolean {
  const token = SECONDARY_BY_KEY.get(secondaryKey)?.token;
  return token ? statCodes.some((c) => c.toUpperCase().includes(token)) : false;
}

/**
 * Blizzard inventory-type ids to our BiS slot keys. These ids are the stable game enum (shared by Blizzard and
 * Wowhead), so they map the numeric `slot` on a Wowhead item row the same way slotForInventoryType maps the string
 * enum. Shirt, tabard and bags fall through to "other".
 */
const SLOT_BY_ID: Record<number, string> = {
  1: "head",
  2: "neck",
  3: "shoulder",
  5: "chest",
  20: "chest", // robe
  6: "waist",
  7: "legs",
  8: "feet",
  9: "wrist",
  10: "hands",
  11: "finger",
  12: "trinket",
  16: "back",
  13: "mainHand", // one-hand
  17: "mainHand", // two-hand
  21: "mainHand",
  14: "offHand", // shield
  22: "offHand",
  23: "offHand", // held in off-hand
  15: "ranged",
  25: "ranged", // thrown
  26: "ranged", // ranged right (gun/wand)
  28: "ranged", // relic
};
export const slotForInventoryTypeId = (id: number | undefined | null): string => (id != null ? SLOT_BY_ID[id] : undefined) ?? "other";

/** Item quality id (0 poor … 5 legendary, 6 artifact, 7 heirloom) to our quality name, as the Blizzard API gives. */
const QUALITY_BY_ID: Record<number, string> = {
  0: "POOR",
  1: "COMMON",
  2: "UNCOMMON",
  3: "RARE",
  4: "EPIC",
  5: "LEGENDARY",
  6: "ARTIFACT",
  7: "HEIRLOOM",
};
export const wowheadQualityName = (id: number | undefined | null): string | undefined => (id != null ? QUALITY_BY_ID[id] : undefined);

/**
 * Our BiS source type for a Wowhead `source` code list (1 crafted, 2 drop, 3 pvp, 4/6 quest, 5/16 vendor…); the
 * first code that maps wins. A bare "drop" (2) has no named boss/zone in the list, so it reads as "world" until the
 * item page refines it.
 */
const SOURCE_TYPE_BY_CODE: Record<number, "quest" | "vendor" | "crafted" | "pvp" | "world"> = {
  1: "crafted",
  2: "world",
  3: "pvp",
  4: "quest",
  5: "vendor",
  6: "quest",
  16: "vendor",
};
export function wowheadSourceType(codes: readonly number[]): "quest" | "vendor" | "crafted" | "pvp" | "world" | "other" {
  for (const code of codes) {
    const type = SOURCE_TYPE_BY_CODE[code];
    if (type) return type;
  }
  return "other";
}

const ARMOR_BY_ID = new Map(ARMOR_TYPES.map((t) => [t.id, t.name]));
const WEAPON_BY_ID = new Map(WEAPON_TYPES.map((t) => [t.id, t.name]));

/** The localized armour/weapon type label for a Wowhead item row's class/subclass ids, or null for slots with none. */
export function wowheadSubclassLabel(classId: number | undefined | null, subclassId: number | undefined | null): Localized | null {
  if (subclassId == null) return null;
  if (classId === ITEM_CLASS.armor) return ARMOR_BY_ID.get(subclassId) ?? null;
  if (classId === ITEM_CLASS.weapon) return WEAPON_BY_ID.get(subclassId) ?? null;
  return null;
}

/** The icon CDN URL (shared by Wowhead and Blizzard tooltips) for an icon name like "inv_sword_39". */
export const wowheadIconUrl = (name: string | undefined | null): string | undefined =>
  name ? `https://wow.zamimg.com/images/wow/icons/large/${name.toLowerCase()}.jpg` : undefined;
