import { REGIONS, blizzardSlug } from "@wow/config";
import { getTalentTree, nameKey, syncCharacter } from "@wow/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../deps";
import { HttpError, notFound, unauthorized } from "../errors";

/** Minimum time between manual refreshes of the same character. */
const MANUAL_REFRESH_COOLDOWN_MS = 2 * 60_000;

export async function characterRoutes(app: FastifyInstance, { prisma, core }: AppDeps) {
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
   * Character page data. Unknown characters are looked up in the game on demand
   * for signed-in users, so anyone can search a character.
   */
  app.get("/characters/:region/:realm/:name", async (request) => {
    const params = z
      .object({ region: z.enum(REGIONS), realm: z.string(), name: z.string() })
      .parse(request.params);
    const where = {
      region_realm_nameKey: { region: params.region, realm: blizzardSlug(params.realm), nameKey: nameKey(params.name) },
    };
    let character = await prisma.character.findUnique({ where });

    if (!character) {
      if (!request.user) throw notFound("character_not_found");
      character = await prisma.character.create({
        data: { region: params.region, realm: blizzardSlug(params.realm), name: params.name.trim(), nameKey: nameKey(params.name) },
      });
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
  app.get("/talent-trees/:region/:treeId/:specId", async (request, reply) => {
    const params = z
      .object({ region: z.enum(REGIONS), treeId: z.coerce.number().int().positive(), specId: z.coerce.number().int().positive() })
      .parse(request.params);
    const layout = await getTalentTree(core, params.region, params.treeId, params.specId, {
      fetchIfMissing: request.user !== null,
    });
    if (!layout) throw notFound("talent_tree_not_found");
    reply.header("Cache-Control", "public, max-age=86400");
    return { layout };
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
