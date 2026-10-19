import {
  ITEM_CLASS,
  armorTypeId,
  isArmorTypeSlot,
  itemTypeIds,
  slotForInventoryTypeId,
  wowheadIconUrl,
  wowheadQualityName,
  wowheadSourceType,
  wowheadSubclassLabel,
  type GameProfile,
} from "@wow/config";
import type { CoreContext } from "@wow/core";

const MAX_RESULTS = 48;
const RARITY_ORDER: Record<string, number> = { POOR: 0, COMMON: 1, UNCOMMON: 2, RARE: 3, EPIC: 4, LEGENDARY: 5, ARTIFACT: 6, HEIRLOOM: 7 };

/** The subset of the item-search query this path reads. */
export interface WowheadSearchQuery {
  q?: string;
  minLevel?: number;
  maxLevel?: number;
  slot?: string;
  type?: string;
  classId?: number;
  /** Minimum item quality id (2 uncommon, 3 rare, 4 epic…); rows below it are dropped, unknown quality kept. */
  minQuality?: number;
  restrictClass: boolean;
  sort: "level" | "rarity" | "type";
}

/**
 * BiS item search backed by Wowhead's item finder, for the versions where Blizzard's item API falls short
 * (Classic and Forever). The finder is queried by name and required-level range (the filter keys it exposes); slot,
 * item class and armour type are then matched on the parsed rows by their numeric ids, which are the same stable
 * Blizzard enums the profile uses. Each row carries its source codes, so the result shows at least the source type
 * (quest/vendor/drop…); the exact boss or quest name comes from the item page and is a later refinement.
 */
export async function wowheadBisSearch(core: CoreContext, game: GameProfile, q: WowheadSearchQuery) {
  if (!core.wowhead) throw new Error("wowhead client unavailable");

  // Required-level range goes to Wowhead as path facets (its current filter format); everything else — name, slot,
  // item class/type, quality — is matched on the returned rows. `group-by:slot` makes the finder emit one listview
  // per slot tab instead of a single popularity-capped list, so off-hand frills (shields, held-in-off-hand) that the
  // flat page drops are present; the parser reads every array (see parseWowheadListview).
  const facets: string[] = [];
  if (q.minLevel !== undefined) facets.push(`min-req-level:${q.minLevel}`);
  facets.push(`max-req-level:${q.maxLevel ?? game.maxLevel}`);
  facets.push("group-by:slot");

  const rows = await core.wowhead.itemsByFacets(facets, game.wowheadDomain, { limit: 1000 });

  // Resolve the class/type restriction as numeric ids to match on the rows. A user-picked type wins; otherwise, only
  // restrict a real armour slot to the class's armour type. Mixed-class slots (off hand = weapon|shield|held, ranged
  // = weapon|relic) are NOT class-narrowed, so the slot filter alone keeps shields and off-hand frills.
  const explicitType = q.slot ? itemTypeIds(q.slot, q.type) : null;
  let restrictClassId: number | undefined;
  let restrictSubclassId: number | undefined;
  if (explicitType) {
    restrictClassId = explicitType.itemClassId;
    restrictSubclassId = explicitType.itemSubclassId;
  } else if (q.restrictClass && q.slot && isArmorTypeSlot(q.slot) && q.classId !== undefined) {
    const armorType = game.classes.find((c) => c.id === q.classId)?.armorType;
    if (armorType) {
      restrictClassId = ITEM_CLASS.armor;
      restrictSubclassId = armorTypeId(armorType);
    }
  }

  const needle = q.q?.trim().toLowerCase();
  let items = rows
    .map((r) => ({ row: r, slot: slotForInventoryTypeId(r.slotId) }))
    // Drop non-gear rows (recipes, consumables, quest items map to "other").
    .filter((e) => e.slot !== "other")
    .filter((e) => (q.slot ? e.slot === q.slot : true))
    .filter((e) => (needle ? e.row.name.toLowerCase().includes(needle) : true))
    .filter((e) => (restrictClassId === undefined ? true : e.row.classId === restrictClassId))
    .filter((e) => (restrictSubclassId === undefined ? true : e.row.subclassId === restrictSubclassId))
    // Minimum quality: drop items below it, but keep rows whose quality the finder did not report.
    .filter((e) => (q.minQuality === undefined || e.row.quality === undefined ? true : e.row.quality >= q.minQuality))
    // Required level within the bracket (the finder filter is a coarse pre-narrowing; this is authoritative).
    .filter((e) => {
      const rl = e.row.reqLevel;
      if (rl === undefined) return true; // no level requirement: usable at any level in the bracket
      if (q.minLevel !== undefined && rl < q.minLevel) return false;
      if (q.maxLevel !== undefined && rl > q.maxLevel) return false;
      return true;
    });

  const qualityRank = (id: number | undefined) => (id === undefined ? -1 : id);
  items.sort((a, b) => {
    if (q.sort === "rarity") return qualityRank(b.row.quality) - qualityRank(a.row.quality) || (b.row.itemLevel ?? 0) - (a.row.itemLevel ?? 0);
    if (q.sort === "type") return (a.row.subclassId ?? 0) - (b.row.subclassId ?? 0) || (b.row.itemLevel ?? 0) - (a.row.itemLevel ?? 0);
    return (b.row.itemLevel ?? 0) - (a.row.itemLevel ?? 0);
  });

  const truncated = items.length > MAX_RESULTS;
  items = items.slice(0, MAX_RESULTS);

  return {
    items: items.map(({ row, slot }) => ({
      id: row.id,
      name: { en: row.name },
      slot,
      subclass: wowheadSubclassLabel(row.classId, row.subclassId),
      quality: wowheadQualityName(row.quality) ?? null,
      itemLevel: row.itemLevel ?? null,
      requiredLevel: row.reqLevel ?? null,
      icon: wowheadIconUrl(row.icon) ?? null,
      // Source type from the finder's codes; the zone/boss/quest detail is added later from the item page.
      source: row.sourceCodes.length > 0 ? { type: wowheadSourceType(row.sourceCodes) } : null,
    })),
    truncated,
  };
}

export { RARITY_ORDER };
