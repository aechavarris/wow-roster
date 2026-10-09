import { z } from "zod";
import { localizedSchema } from "./schema";

/**
 * Best-in-slot (BiS) wishlists. A character (real or planned) keeps a list of items it wants, each pinned to an
 * equipment slot and, where known, the content it drops from. Items are picked from the version's Blizzard item
 * search, so we snapshot what we need to render them without the API (names/icons), which also lets Forever show a
 * list once its own data exists. The source zone is filled from the Blizzard journal when the item is raid/dungeon
 * loot, and can always be set by hand (quest, crafted, world drop…), matching the "hybrid" approach.
 */

/** One equipment slot a BiS item can occupy. Slots are the same across the versions we support (vanilla paper doll). */
export interface BisSlot {
  key: string;
  name: Record<string, string>;
  /** Paper-doll order, head to ranged. */
  order: number;
}

/** The equipment slots a BiS list groups by, in paper-doll order. */
export const BIS_SLOTS: BisSlot[] = [
  { key: "head", order: 1, name: { en: "Head", es: "Cabeza" } },
  { key: "neck", order: 2, name: { en: "Neck", es: "Cuello" } },
  { key: "shoulder", order: 3, name: { en: "Shoulder", es: "Hombros" } },
  { key: "back", order: 4, name: { en: "Back", es: "Espalda" } },
  { key: "chest", order: 5, name: { en: "Chest", es: "Pecho" } },
  { key: "wrist", order: 6, name: { en: "Wrist", es: "Muñecas" } },
  { key: "hands", order: 7, name: { en: "Hands", es: "Manos" } },
  { key: "waist", order: 8, name: { en: "Waist", es: "Cintura" } },
  { key: "legs", order: 9, name: { en: "Legs", es: "Piernas" } },
  { key: "feet", order: 10, name: { en: "Feet", es: "Pies" } },
  { key: "finger", order: 11, name: { en: "Ring", es: "Anillo" } },
  { key: "trinket", order: 12, name: { en: "Trinket", es: "Abalorio" } },
  { key: "mainHand", order: 13, name: { en: "Main hand", es: "Mano principal" } },
  { key: "offHand", order: 14, name: { en: "Off hand", es: "Mano secundaria" } },
  { key: "ranged", order: 15, name: { en: "Ranged / Relic", es: "A distancia / Reliquia" } },
  { key: "other", order: 16, name: { en: "Other", es: "Otros" } },
];

const SLOT_KEYS = new Set(BIS_SLOTS.map((s) => s.key));
export const bisSlotKeys = () => BIS_SLOTS.map((s) => s.key);
export const bisSlot = (key: string) => BIS_SLOTS.find((s) => s.key === key);

/**
 * Maps a Blizzard item `inventory_type` (the `type` enum from the item API) to one of our BiS slots.
 * Unknown or non-equippable types fall back to "other".
 */
export function slotForInventoryType(inventoryType: string | undefined | null): string {
  switch ((inventoryType ?? "").toUpperCase()) {
    case "HEAD":
      return "head";
    case "NECK":
      return "neck";
    case "SHOULDER":
      return "shoulder";
    case "CLOAK":
      return "back";
    case "CHEST":
    case "ROBE":
      return "chest";
    case "WRIST":
      return "wrist";
    case "HAND":
      return "hands";
    case "WAIST":
      return "waist";
    case "LEGS":
      return "legs";
    case "FEET":
      return "feet";
    case "FINGER":
      return "finger";
    case "TRINKET":
      return "trinket";
    case "WEAPON":
    case "TWOHWEAPON":
    case "WEAPONMAINHAND":
      return "mainHand";
    case "WEAPONOFFHAND":
    case "SHIELD":
    case "HOLDABLE":
      return "offHand";
    case "RANGED":
    case "RANGEDRIGHT":
    case "THROWN":
    case "RELIC":
      return "ranged";
    default:
      return "other";
  }
}

/** Where a BiS item is obtained. `type` groups it; `zoneKey` ties it to a version raid/dungeon when known. */
export const bisSourceSchema = z.object({
  type: z.enum(["raid", "dungeon", "quest", "vendor", "crafted", "pvp", "world", "other"]),
  /** Raid/dungeon key from the version's profile, when it maps to one. */
  zoneKey: z.string().optional(),
  /** Display name of the zone (journal instance or a hand-typed name), per locale. */
  zoneName: localizedSchema.optional(),
  /** Boss/encounter the item drops from, when auto-detected from the journal. */
  bossName: localizedSchema.optional(),
  /** True when set automatically from the Blizzard journal, false/absent when set by hand. */
  auto: z.boolean().optional(),
});
export type BisSource = z.infer<typeof bisSourceSchema>;

/** One wishlisted item. Display fields are snapshotted at add time so the list renders without the API. */
export const bisItemSchema = z.object({
  /** Equipment slot key from BIS_SLOTS. */
  slot: z.string().refine((v) => SLOT_KEYS.has(v), "unknown slot"),
  itemId: z.number().int().positive(),
  /** Name captured when the item was added (UI locale); the Wowhead tooltip localizes it on hover. */
  name: z.string().min(1).max(120),
  /** Item icon URL, when the version's media API had one. */
  icon: z.string().url().optional(),
  /** Blizzard quality (POOR…LEGENDARY), for the item name color. */
  quality: z.string().max(20).optional(),
  itemLevel: z.number().nonnegative().optional(),
  requiredLevel: z.number().int().nonnegative().optional(),
  source: bisSourceSchema.optional(),
  note: z.string().max(200).optional(),
});
export type BisItem = z.infer<typeof bisItemSchema>;

/** A full BiS list. Capped so a wishlist cannot grow without bound. */
export const bisListSchema = z.array(bisItemSchema).max(100);
export type BisList = z.infer<typeof bisListSchema>;

/**
 * Serializes a roster's BiS wishlists to the Gargul addon's CSV format, so officers can paste it into Gargul
 * (`/gl tmb`) and see everyone's wishes on item tooltips in game. One line per item — `itemId,player1,player2,…` —
 * where a player's position is their priority; Gargul detects the format because the first line starts with digits
 * and a comma. Players are listed per item in the order given, deduplicated, and items are sorted by id.
 */
export function bisToGargulCsv(players: { name: string; items: { itemId: number }[] }[]): string {
  const byItem = new Map<number, string[]>();
  for (const player of players) {
    const name = player.name.trim();
    if (!name) continue;
    for (const item of player.items) {
      if (!Number.isInteger(item.itemId) || item.itemId <= 0) continue;
      const names = byItem.get(item.itemId) ?? [];
      if (!names.includes(name)) names.push(name);
      byItem.set(item.itemId, names);
    }
  }
  return [...byItem.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([itemId, names]) => [itemId, ...names].join(","))
    .join("\n");
}
