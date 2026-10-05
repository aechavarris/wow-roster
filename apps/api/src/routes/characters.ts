import { REGIONS, blizzardSlug } from "@wow/config";
import { gameVersion, getTalentTree, nameKey, syncCharacter } from "@wow/core";
import { Prisma } from "@wow/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
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
