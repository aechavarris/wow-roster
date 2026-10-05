import { SUPPORTED_LOCALES } from "@wow/config";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../deps";
import { notFound, unauthorized } from "../errors";
import { guildRole } from "../permissions";

export async function meRoutes(app: FastifyInstance, { prisma }: AppDeps) {
  app.get("/me", async (request) => {
    const user = request.user;
    if (!user) return { user: null };

    const characters = await prisma.character.findMany({
      where: { ownerId: user.id },
      orderBy: [{ level: "desc" }, { name: "asc" }],
      select: {
        id: true,
        region: true,
        realm: true,
        name: true,
        level: true,
        classId: true,
        specName: true,
        equippedItemLevel: true,
        isMain: true,
        avatarUrl: true,
        lastSyncedAt: true,
        guild: { select: { id: true, name: true } },
      },
    });

    // Guilds the user can open: explicit memberships plus registered guilds of their characters.
    const guildIds = new Set<string>([
      ...(await prisma.guildMembership.findMany({ where: { userId: user.id }, select: { guildId: true } })).map(
        (m) => m.guildId,
      ),
      ...characters.flatMap((c) => (c.guild ? [c.guild.id] : [])),
    ]);
    const guilds = await prisma.guild.findMany({ where: { id: { in: [...guildIds] } }, orderBy: { name: "asc" } });
    const guildsWithRole = await Promise.all(
      guilds.map(async (g) => ({
        id: g.id,
        kind: g.kind,
        name: g.name,
        realm: g.realm,
        region: g.region,
        role: await guildRole(prisma, g, user),
      })),
    );

    return {
      user: { id: user.id, battletag: user.battletag, locale: user.locale },
      characters,
      guilds: guildsWithRole,
    };
  });

  app.patch("/me", async (request) => {
    if (!request.user) throw unauthorized();
    const body = z.object({ locale: z.enum(SUPPORTED_LOCALES) }).parse(request.body);
    const user = await prisma.user.update({ where: { id: request.user.id }, data: { locale: body.locale } });
    return { user: { id: user.id, battletag: user.battletag, locale: user.locale } };
  });

  /** Marks one owned character as the user's main within its guild (or among guildless characters). */
  app.post("/me/characters/:id/main", async (request) => {
    if (!request.user) throw unauthorized();
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const character = await prisma.character.findFirst({ where: { id, ownerId: request.user.id } });
    if (!character) throw notFound("character_not_found");
    await prisma.$transaction([
      prisma.character.updateMany({
        where: { ownerId: request.user.id, guildId: character.guildId },
        data: { isMain: false },
      }),
      prisma.character.update({ where: { id }, data: { isMain: true } }),
    ]);
    return { ok: true };
  });
}
