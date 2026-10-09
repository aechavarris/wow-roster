import { ITEM_CLASS, REGIONS, armorTypeId, bisSlotKeys, blizzardSlug, isArmorTypeSlot, itemTypeIds, slotForInventoryType, slotTypeFilter } from "@wow/config";
import type { ItemResult } from "@wow/blizzard";
import { gameVersion, getBisSourceIndex, getIcons, getTalentTree, lookupBisSource, nameKey, syncCharacter, warmBisSourceIndex } from "@wow/core";
import { Prisma } from "@wow/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveBisList } from "../bis";
import type { AppDeps } from "../deps";
import { HttpError, forbidden, gameVersionSchema, notFound, unauthorized } from "../errors";

/** Minimum time between manual refreshes of the same character. */
const MANUAL_REFRESH_COOLDOWN_MS = 2 * 60_000;

export async function characterRoutes(app: FastifyInstance, { prisma, core, versions }: AppDeps) {
  const version = gameVersionSchema(versions);
  const detail = (id: string) =>
    prisma.character.findUnique({
      where: { id },
      include: { guild: { select: { id: true, name: true, public: true } } },
    });

  const serialize = (character: NonNullable<Awaited<ReturnType<typeof detail>>>) => {
    const { ownerId, guild, nameKey: _key, ...rest } = character;
    return {
      ...rest,
      claimed: ownerId !== null,
      // Private guilds are not revealed on public character pages.
      guild: guild?.public ? { id: guild.id, name: guild.name } : null,
    };
  };

  /**
   * Character page data. Unknown characters are looked up in the game version's API on demand
   * for signed-in users, so anyone can search a character.
   */
  app.get("/characters/:version/:region/:realm/:name", async (request) => {
    const params = z
      .object({ version, region: z.enum(REGIONS), realm: z.string(), name: z.string() })
      .parse(request.params);
    const key = { gameVersion: params.version, region: params.region, realm: blizzardSlug(params.realm), nameKey: nameKey(params.name) };
    let character = await prisma.character.findUnique({ where: { gameVersion_region_realm_nameKey: key } });

    if (!character) {
      if (!request.user) throw notFound("character_not_found");
      // Throws (409) for versions without an API before anything is stored.
      core.blizzard(params.version, params.region);
      character = await prisma.character.create({ data: { ...key, name: params.name.trim() } });
      if ((await syncCharacter(core, character.id, true)) === "not_found") {
        await prisma.character.delete({ where: { id: character.id } });
        throw notFound("character_not_found_in_game");
      }
    }
    return { character: serialize((await detail(character.id))!) };
  });

  /**
   * Static talent tree layout for a spec. Cached trees are public; building a missing one
   * costs ~150 API calls, so only signed-in users can trigger it.
   */
  app.get("/talent-trees/:version/:region/:treeId/:specId", async (request, reply) => {
    const params = z
      .object({ version, region: z.enum(REGIONS), treeId: z.coerce.number().int().positive(), specId: z.coerce.number().int().positive() })
      .parse(request.params);
    const layout = await getTalentTree(core, { version: params.version, region: params.region }, params.treeId, params.specId, {
      fetchIfMissing: request.user !== null,
    });
    if (!layout) throw notFound("talent_tree_not_found");
    reply.header("Cache-Control", "public, max-age=86400");
    return { layout };
  });

  /**
   * Item search for the BiS picker: matches `q` in the item name and bounds the required level to the
   * [minLevel, maxLevel] bracket the UI defaults to. Hits the version's Blizzard API, so it needs a login (like
   * building a talent tree). Each result carries its BiS slot, icon and, when the journal index is warm, its zone.
   */
  // Item quality order (worst to best) for the "by rarity" sort.
  const RARITY_ORDER: Record<string, number> = { POOR: 0, COMMON: 1, UNCOMMON: 2, RARE: 3, EPIC: 4, LEGENDARY: 5, ARTIFACT: 6, HEIRLOOM: 7 };
  const MAX_RESULTS = 48;

  app.get("/items/search", async (request) => {
    if (!request.user) throw unauthorized();
    const q = z
      .object({
        version,
        region: z.enum(REGIONS),
        q: z.string().trim().max(60).optional(),
        minLevel: z.coerce.number().int().min(0).max(999).optional(),
        maxLevel: z.coerce.number().int().min(0).max(999).optional(),
        slot: z.enum(bisSlotKeys() as [string, ...string[]]).optional(),
        sort: z.enum(["level", "rarity", "type"]).default("level"),
        /** Armour/weapon type key (plate, dagger…) to filter by, scoped to the slot. */
        type: z.string().max(20).optional(),
        /** The character's class; with restrictClass, hides armour of other types the class cannot wear. */
        classId: z.coerce.number().int().optional(),
        // A query string "false" must read as false (z.coerce.boolean turns any non-empty string into true).
        restrictClass: z.string().optional().transform((v) => v !== "false"),
      })
      .parse(request.query);
    // Throws (409) for versions without an API (Forever), so the UI can tell the picker is not available yet.
    const client = core.blizzard(q.version, q.region);

    // Resolve the Blizzard item_class/item_subclass filter: an explicit type wins; otherwise, for an armour slot,
    // restrict to the class's armour type (retail) so items the class cannot wear are hidden.
    let itemClassId: number | undefined;
    let itemSubclassId: number | undefined;
    const explicitType = q.slot ? itemTypeIds(q.slot, q.type) : null;
    if (explicitType) {
      itemClassId = explicitType.itemClassId;
      itemSubclassId = explicitType.itemSubclassId;
    } else if (q.restrictClass && q.slot && isArmorTypeSlot(q.slot) && q.classId !== undefined) {
      const armorType = gameVersion(core, q.version).classes.find((c) => c.id === q.classId)?.armorType;
      if (armorType) {
        itemClassId = ITEM_CLASS.armor;
        itemSubclassId = armorTypeId(armorType);
      }
    }
    // Still unrestricted but a slot is chosen: narrow to that slot's item class (weapon/armour) so the candidate
    // window is not dominated by higher-item-level gear of other classes, which would hide e.g. the best dagger.
    if (itemClassId === undefined && q.slot) itemClassId = slotTypeFilter(q.slot)?.itemClassId;

    // Gather a window of candidates (more pages when a slot filter will thin them out), then filter and sort here:
    // the Blizzard item search cannot filter by our grouped slots nor sort by rarity/subclass.
    const pages = q.slot ? 3 : 1;
    const candidates = new Map<number, ItemResult>();
    for (let page = 1; page <= pages; page++) {
      const result = await client.searchItems({ query: q.q, minLevel: q.minLevel, maxLevel: q.maxLevel, itemClassId, itemSubclassId, page, pageSize: 100 });
      for (const item of result.items) candidates.set(item.id, item);
      if (page >= result.pageCount) break;
    }

    let rows = [...candidates.values()].map((i) => ({ item: i, slot: slotForInventoryType(i.inventoryType) }));
    if (q.slot) rows = rows.filter((r) => r.slot === q.slot);
    rows.sort((a, b) => {
      if (q.sort === "rarity") return (RARITY_ORDER[b.item.quality ?? ""] ?? -1) - (RARITY_ORDER[a.item.quality ?? ""] ?? -1) || (b.item.itemLevel ?? 0) - (a.item.itemLevel ?? 0);
      if (q.sort === "type") return (a.item.subclass?.en ?? "").localeCompare(b.item.subclass?.en ?? "") || (b.item.itemLevel ?? 0) - (a.item.itemLevel ?? 0);
      return (b.item.itemLevel ?? 0) - (a.item.itemLevel ?? 0);
    });
    const truncated = rows.length > MAX_RESULTS;
    rows = rows.slice(0, MAX_RESULTS);

    const target = { version: q.version, region: q.region };
    const [icons, index] = await Promise.all([
      getIcons(core, target, "item", rows.map((r) => r.item.id)).catch(() => new Map<number, string>()),
      getBisSourceIndex(core, target, { fetchIfMissing: false }),
    ]);
    // Warm the zone index in the background so a second search returns sources.
    if (!index) warmBisSourceIndex(core, target);
    const items = rows.map(({ item, slot }) => ({
      id: item.id,
      name: item.name,
      slot,
      subclass: item.subclass ?? null,
      quality: item.quality ?? null,
      itemLevel: item.itemLevel ?? null,
      requiredLevel: item.requiredLevel ?? null,
      icon: icons.get(item.id) ?? null,
      source: lookupBisSource(index, item.id) ?? null,
    }));
    return { items, truncated };
  });

  /**
   * The owner keeps a best-in-slot wishlist on their character. The whole list is replaced; items without a
   * source get their drop zone filled from the cached journal index.
   */
  app.put("/characters/:id/bis", async (request) => {
    if (!request.user) throw unauthorized();
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ bis: z.unknown() }).parse(request.body);
    const character = await prisma.character.findUnique({ where: { id } });
    if (!character) throw notFound("character_not_found");
    if (character.ownerId !== request.user.id) throw forbidden();
    const list = await resolveBisList(core, { version: character.gameVersion, region: character.region }, body.bis);
    await prisma.character.update({ where: { id }, data: { bis: list.length > 0 ? list : Prisma.DbNull } });
    return { character: serialize((await detail(id))!) };
  });

  /**
   * The owner records their professions where the game version's API has none (Classic): ids from the
   * version's catalog, at most its number of primaries, skill up to the version's cap.
   */
  app.put("/characters/:id/professions", async (request) => {
    if (!request.user) throw unauthorized();
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        professions: z
          .array(z.object({ id: z.number().int().positive(), skill: z.number().int().min(1).nullable().optional() }))
          .max(10),
      })
      .parse(request.body);
    const character = await prisma.character.findUnique({ where: { id } });
    if (!character) throw notFound("character_not_found");
    if (character.ownerId !== request.user.id) throw forbidden();
    const profile = gameVersion(core, character.gameVersion);
    if (profile.api.available && profile.api.characterEndpoints.includes("professions")) {
      throw new HttpError(400, "professions_from_api");
    }

    const ids = new Set<number>();
    let primaries = 0;
    for (const entry of body.professions) {
      const known = profile.professions.find((p) => p.id === entry.id);
      if (!known || ids.has(entry.id)) throw new HttpError(400, "unknown_profession");
      if (entry.skill != null && known.maxSkill && entry.skill > known.maxSkill) throw new HttpError(400, "invalid_profession_skill");
      ids.add(entry.id);
      if (known.kind === "primary") primaries++;
    }
    if (primaries > profile.maxPrimaryProfessions) throw new HttpError(400, "too_many_primary_professions");

    const manualProfessions = body.professions.map((p) => ({ id: p.id, skill: p.skill ?? null }));
    await prisma.character.update({
      where: { id },
      data: { manualProfessions: manualProfessions.length > 0 ? manualProfessions : Prisma.DbNull },
    });
    return { character: serialize((await detail(id))!) };
  });

  /**
   * The owner ticks the requirements (attunements) the character has: keys of the game version's enabled
   * requirements. No API reports them, so they are entered by hand like Classic professions.
   */
  app.put("/characters/:id/requirements", async (request) => {
    if (!request.user) throw unauthorized();
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ requirements: z.array(z.string().min(1).max(64)).max(50) }).parse(request.body);
    const character = await prisma.character.findUnique({ where: { id } });
    if (!character) throw notFound("character_not_found");
    if (character.ownerId !== request.user.id) throw forbidden();
    const known = new Set(gameVersion(core, character.gameVersion).requirements.filter((r) => r.enabled).map((r) => r.key));
    if (body.requirements.some((key) => !known.has(key))) throw new HttpError(400, "unknown_requirement");

    const keys = [...new Set(body.requirements)];
    await prisma.character.update({ where: { id }, data: { manualRequirements: keys.length > 0 ? keys : Prisma.DbNull } });
    return { character: serialize((await detail(id))!) };
  });

  app.post("/characters/:id/sync", async (request) => {
    if (!request.user) throw unauthorized();
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const character = await prisma.character.findUnique({ where: { id } });
    if (!character) throw notFound("character_not_found");
    if (character.lastSyncedAt && Date.now() - character.lastSyncedAt.getTime() < MANUAL_REFRESH_COOLDOWN_MS) {
      throw new HttpError(429, "refresh_cooldown");
    }
    const result = await syncCharacter(core, id, true);
    return { result, character: serialize((await detail(id))!) };
  });
}
