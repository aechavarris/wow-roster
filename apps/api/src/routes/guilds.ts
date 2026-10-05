import { BlizzardApiError } from "@wow/blizzard";
import { REGIONS, blizzardSlug } from "@wow/config";
import { buildRoster, defaultStatusForRank, nameKey, syncCharacter } from "@wow/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../deps";
import { HttpError, notFound, unauthorized } from "../errors";
import { loadVisibleGuild, requireGuildRole } from "../permissions";

const idParams = z.object({ id: z.string() });

export async function guildRoutes(app: FastifyInstance, deps: AppDeps) {
  const { prisma, profile, core, queue, env } = deps;
  const statusKeys = profile.rosterStatuses.map((s) => s.key) as [string, ...string[]];
  const roleKeys = profile.roles.map((r) => r.key) as [string, ...string[]];

  const serializeGuild = (guild: Awaited<ReturnType<typeof loadVisibleGuild>>["guild"]) => ({
    id: guild.id,
    region: guild.region,
    realm: guild.realm,
    slug: guild.slug,
    name: guild.name,
    faction: guild.faction,
    public: guild.public,
    syncIntervalMinutes: guild.syncIntervalMinutes,
    minLevel: guild.minLevel,
    officerMaxRank: guild.officerMaxRank,
    lastSyncedAt: guild.lastSyncedAt,
    syncError: guild.syncError,
  });

  /**
   * Registers an in-game guild. The user must own a character at officer rank,
   * unless ALLOW_UNVERIFIED_GUILDS is enabled (local development).
   */
  app.post("/guilds", async (request, reply) => {
    const user = request.user;
    if (!user) throw unauthorized();
    const body = z
      .object({ region: z.enum(REGIONS), realm: z.string().min(1), name: z.string().min(1) })
      .parse(request.body);
    const realm = blizzardSlug(body.realm);
    const slug = blizzardSlug(body.name);

    const existing = await prisma.guild.findUnique({
      where: { region_realm_slug: { region: body.region, realm, slug } },
    });
    if (existing) throw new HttpError(409, "guild_already_registered", existing.id);

    const client = core.blizzard(body.region);
    let info, members;
    try {
      [info, members] = await Promise.all([client.getGuild(realm, slug), client.getGuildRoster(realm, slug)]);
    } catch (error) {
      if (error instanceof BlizzardApiError && error.notFound) throw notFound("guild_not_found_in_game");
      throw error;
    }

    const owned = await prisma.character.findMany({
      where: { ownerId: user.id, region: body.region },
      select: { blizzardId: true, realm: true, nameKey: true },
    });
    const officerMaxRank = 1;
    const isOfficer = members.some(
      (m) =>
        m.rank <= officerMaxRank &&
        owned.some((c) => c.blizzardId === m.blizzardId || (c.realm === m.realmSlug && c.nameKey === nameKey(m.name))),
    );
    if (!isOfficer && !env.ALLOW_UNVERIFIED_GUILDS) throw new HttpError(403, "not_guild_officer");

    const ranks = [...new Set(members.map((m) => m.rank))].sort((a, b) => a - b);
    const guild = await prisma.guild.create({
      data: {
        region: body.region,
        realm,
        slug,
        name: info.name || body.name,
        faction: info.faction,
        blizzardId: info.blizzardId,
        syncIntervalMinutes: profile.sync.defaultIntervalMinutes,
        minLevel: profile.sync.defaultMinLevel,
        officerMaxRank,
        ranks: { create: ranks.map((rank) => ({ rank, status: defaultStatusForRank(profile, rank) })) },
        memberships: { create: { userId: user.id, role: "OWNER" } },
      },
    });

    await queue.scheduleGuild(guild.id, guild.syncIntervalMinutes);
    await queue.syncGuildNow(guild.id);
    return reply.status(201).send({ guild: serializeGuild(guild) });
  });

  app.get("/guilds/:id", async (request) => {
    const { id } = idParams.parse(request.params);
    const { guild, role } = await loadVisibleGuild(prisma, id, request.user);
    const ranks = await prisma.guildRank.findMany({ where: { guildId: id }, orderBy: { rank: "asc" } });
    return { guild: serializeGuild(guild), ranks, viewerRole: role };
  });

  app.patch("/guilds/:id", async (request) => {
    const { id } = idParams.parse(request.params);
    const { guild } = await requireGuildRole(prisma, id, request.user, "OFFICER");
    const body = z
      .object({
        public: z.boolean().optional(),
        syncIntervalMinutes: z.number().int().min(profile.sync.minIntervalMinutes).max(24 * 60).optional(),
        minLevel: z.number().int().min(1).max(profile.maxLevel).optional(),
        officerMaxRank: z.number().int().min(0).max(9).optional(),
      })
      .parse(request.body);
    const updated = await prisma.guild.update({ where: { id }, data: body });
    if (body.syncIntervalMinutes && body.syncIntervalMinutes !== guild.syncIntervalMinutes) {
      await queue.scheduleGuild(id, body.syncIntervalMinutes);
    }
    return { guild: serializeGuild(updated) };
  });

  app.put("/guilds/:id/ranks", async (request) => {
    const { id } = idParams.parse(request.params);
    await requireGuildRole(prisma, id, request.user, "OFFICER");
    const body = z
      .array(z.object({ rank: z.number().int().min(0).max(9), label: z.string().max(40).nullable().optional(), status: z.enum(statusKeys) }))
      .parse(request.body);
    await prisma.$transaction(
      body.map((r) =>
        prisma.guildRank.upsert({
          where: { guildId_rank: { guildId: id, rank: r.rank } },
          create: { guildId: id, rank: r.rank, label: r.label ?? null, status: r.status },
          update: { label: r.label ?? null, status: r.status },
        }),
      ),
    );
    return { ranks: await prisma.guildRank.findMany({ where: { guildId: id }, orderBy: { rank: "asc" } }) };
  });

  app.get("/guilds/:id/roster", async (request) => {
    const { id } = idParams.parse(request.params);
    await loadVisibleGuild(prisma, id, request.user);
    const [ranks, entries] = await Promise.all([
      prisma.guildRank.findMany({ where: { guildId: id } }),
      prisma.rosterEntry.findMany({
        where: { guildId: id },
        include: {
          character: {
            select: {
              id: true,
              region: true,
              realm: true,
              name: true,
              level: true,
              classId: true,
              specId: true,
              specName: true,
              averageItemLevel: true,
              equippedItemLevel: true,
              guildRank: true,
              ownerId: true,
              isMain: true,
              lastSyncedAt: true,
              syncError: true,
              avatarUrl: true,
            },
          },
        },
      }),
    ]);
    const players = buildRoster(
      profile,
      ranks,
      entries.map((e) => ({ ...e, character: { ...e.character, avatar: e.character.avatarUrl } })),
    );
    return { players };
  });

  /** Adds a character that is not in the in-game guild (e.g. an alt in another guild). */
  app.post("/guilds/:id/roster", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const { guild } = await requireGuildRole(prisma, id, request.user, "OFFICER");
    const body = z.object({ realm: z.string().min(1), name: z.string().min(1) }).parse(request.body);
    const realm = blizzardSlug(body.realm);
    const key = nameKey(body.name);

    let character = await prisma.character.findUnique({
      where: { region_realm_nameKey: { region: guild.region, realm, nameKey: key } },
    });
    const created = !character;
    character ??= await prisma.character.create({
      data: { region: guild.region, realm, name: body.name.trim(), nameKey: key },
    });
    const result = await syncCharacter(core, character.id, true);
    if (result === "not_found") {
      if (created) await prisma.character.delete({ where: { id: character.id } });
      throw notFound("character_not_found_in_game");
    }

    const entry = await prisma.rosterEntry.upsert({
      where: { guildId_characterId: { guildId: id, characterId: character.id } },
      create: { guildId: id, characterId: character.id, source: "manual" },
      update: {},
    });
    return reply.status(201).send({ entry });
  });

  app.patch("/guilds/:id/roster/:entryId", async (request) => {
    const { id, entryId } = z.object({ id: z.string(), entryId: z.string() }).parse(request.params);
    await requireGuildRole(prisma, id, request.user, "OFFICER");
    const body = z
      .object({
        status: z.enum(statusKeys).nullable().optional(),
        role: z.enum(roleKeys).nullable().optional(),
        note: z.string().max(500).nullable().optional(),
        mainEntryId: z.string().nullable().optional(),
      })
      .parse(request.body);

    const entry = await prisma.rosterEntry.findFirst({ where: { id: entryId, guildId: id } });
    if (!entry) throw notFound("roster_entry_not_found");
    if (body.mainEntryId) {
      if (body.mainEntryId === entryId) throw new HttpError(400, "invalid_main");
      const main = await prisma.rosterEntry.findFirst({ where: { id: body.mainEntryId, guildId: id } });
      if (!main) throw new HttpError(400, "invalid_main");
      // Keep links one level deep: the main must not itself be an alt.
      if (main.mainEntryId) throw new HttpError(400, "main_is_alt");
      await prisma.rosterEntry.updateMany({ where: { mainEntryId: entryId }, data: { mainEntryId: body.mainEntryId } });
    }
    return { entry: await prisma.rosterEntry.update({ where: { id: entryId }, data: body }) };
  });

  /** Manual entries are removed; synced ones are hidden through the profile's hidden status. */
  app.delete("/guilds/:id/roster/:entryId", async (request) => {
    const { id, entryId } = z.object({ id: z.string(), entryId: z.string() }).parse(request.params);
    await requireGuildRole(prisma, id, request.user, "OFFICER");
    const entry = await prisma.rosterEntry.findFirst({ where: { id: entryId, guildId: id } });
    if (!entry) throw notFound("roster_entry_not_found");
    if (entry.source === "manual") {
      await prisma.rosterEntry.delete({ where: { id: entryId } });
      return { removed: true };
    }
    const hidden = profile.rosterStatuses.find((s) => s.hidden);
    if (!hidden) throw new HttpError(400, "no_hidden_status_configured");
    await prisma.rosterEntry.update({ where: { id: entryId }, data: { status: hidden.key } });
    return { removed: false, status: hidden.key };
  });

  app.post("/guilds/:id/sync", async (request) => {
    const { id } = idParams.parse(request.params);
    await requireGuildRole(prisma, id, request.user, "OFFICER");
    await queue.syncGuildNow(id);
    return { queued: true };
  });
}
